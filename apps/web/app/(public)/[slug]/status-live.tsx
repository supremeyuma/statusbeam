'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PublicStatusResponse } from '@statusbeam/contracts';

import { publicApiBaseUrl, streamUrl } from '@/lib/api';
import styles from './status.module.css';

interface StatusLiveProps {
  slug: string;
  initial: PublicStatusResponse;
}

function overallFor(status: PublicStatusResponse): PublicStatusResponse['overallStatus'] {
  const activeIncident = status.incidents.some((incident) => incident.resolvedAt === null);
  const monitorDown = status.monitors.some((monitor) => monitor.status === 'down');
  return activeIncident || monitorDown ? 'down' : 'up';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function barClass(uptimePct: number | null): string {
  if (uptimePct === null) {
    return styles.barEmpty ?? '';
  }
  if (uptimePct >= 99.5) {
    return styles.barUp ?? '';
  }
  if (uptimePct >= 95) {
    return styles.barWarn ?? '';
  }
  return styles.barDown ?? '';
}

function parseEventData<T>(event: Event): T {
  const data: unknown = (event as MessageEvent<unknown>).data;
  if (typeof data !== 'string') {
    throw new Error('expected string SSE payload');
  }
  return JSON.parse(data) as T;
}

export function StatusLive({ slug, initial }: StatusLiveProps) {
  const [status, setStatus] = useState<PublicStatusResponse>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(streamUrl(slug));

    source.addEventListener('open', () => setConnected(true));

    source.addEventListener('snapshot', (event) => {
      setStatus(parseEventData<PublicStatusResponse>(event));
    });

    source.addEventListener('incident', (event) => {
      const payload = parseEventData<{ status?: string }>(event);
      setStatus((previous) => ({
        ...previous,
        overallStatus: payload.status === 'resolved' ? overallFor(previous) : 'down',
      }));

      // The API invalidates its 10s cache when an incident changes, so this is fresh.
      void fetch(`${publicApiBaseUrl}/v1/projects/${slug}/status`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((fresh: PublicStatusResponse | null) => {
          if (fresh) {
            setStatus(fresh);
          }
        })
        .catch(() => undefined);
    });

    source.addEventListener('check', (event) => {
      const payload = parseEventData<{
        monitorId: string;
        status: 'up' | 'down';
        checkedAt: string;
      }>(event);
      setStatus((previous) => {
        const monitors = previous.monitors.map((monitor) =>
          monitor.id === payload.monitorId
            ? { ...monitor, status: payload.status, lastCheckedAt: payload.checkedAt }
            : monitor,
        );
        const next = { ...previous, monitors };
        return { ...next, overallStatus: overallFor(next) };
      });
    });

    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      source.close();
    };
  }, [slug]);

  const activeIncidents = useMemo(
    () => status.incidents.filter((incident) => incident.resolvedAt === null),
    [status.incidents],
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Status page</p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{status.project.name}</h1>
          <span className={styles.live} data-connected={connected}>
            {connected ? 'live' : 'reconnecting'}
          </span>
        </div>
      </header>

      <section
        className={`${styles.banner} ${styles[`banner_${status.overallStatus}`]}`}
        aria-live="polite"
      >
        <strong>
          {status.overallStatus === 'up'
            ? 'All systems operational'
            : status.overallStatus === 'degraded'
              ? 'Degraded performance'
              : 'Major outage'}
        </strong>
        <span>
          {activeIncidents.length > 0
            ? `${activeIncidents.length} active incident${activeIncidents.length === 1 ? '' : 's'}`
            : `Updated ${formatDate(status.updatedAt)} UTC`}
        </span>
      </section>

      <section className={styles.monitors} aria-label="Monitors">
        {status.monitors.map((monitor) => (
          <article key={monitor.id} className={styles.monitor}>
            <div className={styles.monitorHead}>
              <div>
                <h2 className={styles.monitorName}>{monitor.name}</h2>
                <p className={styles.monitorMeta}>
                  {monitor.type.toUpperCase()} ·{' '}
                  {monitor.uptime90d === null ? 'no data' : `${monitor.uptime90d}% uptime`}
                </p>
              </div>
              <span className={`${styles.pill} ${styles[`pill_${monitor.status}`]}`}>
                {monitor.status}
              </span>
            </div>

            <div
              className={styles.bars}
              role="img"
              aria-label={`90 day history for ${monitor.name}`}
            >
              {monitor.days.map((day) => (
                <span
                  key={day.date}
                  className={`${styles.bar} ${barClass(day.uptimePct)}`}
                  title={`${day.date}: ${day.uptimePct === null ? 'no data' : `${day.uptimePct}%`}`}
                  aria-label={`${day.date} ${day.uptimePct === null ? 'no data' : `${day.uptimePct} percent uptime`}`}
                />
              ))}
            </div>
            <div className={styles.barLegend}>
              <span>90 days ago</span>
              <span>today</span>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.incidents} aria-label="Incident history">
        <h2 className={styles.sectionTitle}>Incident timeline</h2>
        {status.incidents.length === 0 ? (
          <p className={styles.empty}>No incidents recorded.</p>
        ) : (
          <ol className={styles.timeline}>
            {status.incidents.map((incident) => (
              <li key={incident.id} className={styles.timelineItem}>
                <div className={styles.timelineDot} data-status={incident.status} />
                <div>
                  <p className={styles.timelineTitle}>
                    {incident.monitorName} · {incident.status}
                  </p>
                  <p className={styles.timelineMeta}>
                    {formatDate(incident.startedAt)} UTC
                    {incident.resolvedAt
                      ? ` · resolved ${formatDate(incident.resolvedAt)} UTC`
                      : ''}
                  </p>
                  {incident.cause ? <p className={styles.timelineCause}>{incident.cause}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className={styles.footer}>
        Powered by StatusBeam · updates stream live over SSE
      </footer>
    </main>
  );
}
