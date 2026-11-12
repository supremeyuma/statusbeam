import 'reflect-metadata';

import { cpus, totalmem } from 'node:os';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPool } from '../src/db/client';
import { loadEnvFiles } from '../src/common/load-env';
import { loadConfig } from '../src/common/config';

interface HistogramSample {
  count: number;
  sum: number;
  buckets: Array<{ le: number; count: number }>;
}

function readArg(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(`--${name}`);
  return (index === -1 ? undefined : argv[index + 1]) ?? fallback;
}

function parseHistogram(text: string, metric: string): HistogramSample {
  const bucketTotals = new Map<number, number>();
  let count = 0;
  let sum = 0;

  for (const line of text.split('\n')) {
    if (line.startsWith('#')) {
      continue;
    }
    if (line.startsWith(`${metric}_bucket`)) {
      const le = Number(line.match(/le="([^"]+)"/)?.[1]);
      const value = Number(line.trim().split(' ').at(-1));
      if (Number.isFinite(le) && Number.isFinite(value)) {
        bucketTotals.set(le, (bucketTotals.get(le) ?? 0) + value);
      }
      continue;
    }
    if (line.startsWith(`${metric}_count`)) {
      count += Number(line.trim().split(' ').at(-1)) || 0;
    }
    if (line.startsWith(`${metric}_sum`)) {
      sum += Number(line.trim().split(' ').at(-1)) || 0;
    }
  }

  const buckets = [...bucketTotals.entries()]
    .map(([le, bucketCount]) => ({ le, count: bucketCount }))
    .sort((a, b) => a.le - b.le);
  return { count, sum, buckets };
}

function quantile(sample: HistogramSample, q: number): number | null {
  if (sample.count === 0 || sample.buckets.length === 0) {
    return null;
  }
  const target = q * sample.count;
  let previousCount = 0;
  let previousLe = 0;

  for (const bucket of sample.buckets) {
    if (bucket.count >= target) {
      if (!Number.isFinite(bucket.le)) {
        return previousLe;
      }
      const span = bucket.count - previousCount;
      const fraction = span === 0 ? 0 : (target - previousCount) / span;
      return previousLe + (bucket.le - previousLe) * fraction;
    }
    previousCount = bucket.count;
    previousLe = bucket.le;
  }
  return previousLe;
}

async function scrape(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/metrics`);
  if (!response.ok) {
    throw new Error(`metrics returned ${response.status}`);
  }
  return response.text();
}

async function main(): Promise<void> {
  loadEnvFiles();
  const argv = process.argv.slice(2);
  const minutes = Number(readArg(argv, 'minutes', '3'));
  const baseUrl = readArg(argv, 'url', 'http://localhost:3001');
  const label = readArg(argv, 'label', 'run');

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const durationMs = minutes * 60 * 1000;
  await scrape(baseUrl);
  const startedAt = Date.now();

  while (Date.now() - startedAt < durationMs) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
    await scrape(baseUrl);
    // Exercise the HTTP path so the API histogram has samples under check load.
    await fetch(`${baseUrl}/v1/projects/load-probe/status`).catch(() => undefined);
  }

  const finalMetrics = await scrape(baseUrl);
  const checkDuration = parseHistogram(finalMetrics, 'statusbeam_check_duration_seconds');
  const schedulerLag = parseHistogram(finalMetrics, 'statusbeam_scheduler_lag_seconds');
  const httpDuration = parseHistogram(finalMetrics, 'statusbeam_http_request_duration_seconds');
  const skipped = Number(
    finalMetrics.match(/statusbeam_check_skipped_total\{[^}]*\} (\d+(?:\.\d+)?)/)?.[1] ?? 0,
  );

  const [monitorCount] = (
    await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM monitors')
  ).rows;
  const [checkStats] = (
    await pool.query<{ count: string; avg_latency: string | null }>(
      "SELECT count(*)::text AS count, avg(latency_ms)::text AS avg_latency FROM checks WHERE checked_at >= now() - interval '1 day'",
    )
  ).rows;

  await pool.end();

  let containers: Record<string, string> = {};
  try {
    const stats = execSync(
      'docker stats --no-stream --format "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"',
      { encoding: 'utf8' },
    );
    for (const line of stats.trim().split(/\r?\n/)) {
      const [name, cpu, memory] = line.split('|');
      if (name && name.includes('statusbeam')) {
        containers[name] = `cpu ${cpu ?? '?'} ? mem ${memory ?? '?'}`;
      }
    }
  } catch {
    containers = { note: 'docker stats unavailable' };
  }

  const result = {
    label,
    startedAt: new Date(startedAt).toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    hardware: {
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    },
    monitors: Number(monitorCount?.count ?? 0),
    checks: {
      count: Number(checkStats?.count ?? 0),
      avgLatencyMs: checkStats?.avg_latency ? Number(checkStats.avg_latency) : null,
      skipped,
    },
    schedulerLagSeconds: {
      p50: quantile(schedulerLag, 0.5),
      p95: quantile(schedulerLag, 0.95),
      p99: quantile(schedulerLag, 0.99),
      count: schedulerLag.count,
    },
    checkDurationSeconds: {
      p50: quantile(checkDuration, 0.5),
      p95: quantile(checkDuration, 0.95),
      p99: quantile(checkDuration, 0.99),
      count: checkDuration.count,
    },
    containers,
    httpRequestDurationSeconds: {
      p50: quantile(httpDuration, 0.5),
      p95: quantile(httpDuration, 0.95),
      p99: quantile(httpDuration, 0.99),
      count: httpDuration.count,
    },
  };

  const outDir = resolve(__dirname, '../../../load/results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = resolve(outDir, `${label}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

  console.log(JSON.stringify(result, null, 2));
  console.log(`\nWrote ${file}`);
}

main().catch((error: unknown) => {
  console.error('Load measurement failed:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
