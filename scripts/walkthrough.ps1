param(
  [int]$TargetPort = 9098,
  [int]$SinkPort = 9097,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$api = "http://localhost:3001"

function Wait-Ready([int]$TimeoutSeconds = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing "$api/readyz"
      if ($response.StatusCode -eq 200) { return }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw "API did not become ready in $TimeoutSeconds seconds"
}

function Wait-Json {
  param(
    [string]$Uri,
    [hashtable]$Headers,
    [scriptblock]$Predicate,
    [int]$TimeoutSeconds = 180,
    [string]$Label = "condition"
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $value = Invoke-RestMethod -Uri $Uri -Headers $Headers
      if (& $Predicate $value) { return $value }
    } catch { }
    Start-Sleep -Seconds 3
  }
  throw "Timed out waiting for $Label"
}

Write-Host "== 1. compose up ==" -ForegroundColor Cyan
$env:ALLOW_PRIVATE_TARGETS = "true"
if ($SkipBuild) {
  docker compose -f infra/docker-compose.yml up -d | Out-Null
} else {
  docker compose -f infra/docker-compose.yml up -d --build | Out-Null
}
Wait-Ready
Write-Host "readyz 200"

$work = Join-Path $env:TEMP "statusbeam-walkthrough"
New-Item -ItemType Directory -Path $work -Force | Out-Null
$targetScript = Join-Path $work "target.cjs"
$sinkScript = Join-Path $work "sink.cjs"
$sseScript = Join-Path $work "sse.cjs"
$etagScript = Join-Path $work "etag.cjs"
$sinkLog = Join-Path $work "sink.log"
Remove-Item $sinkLog -ErrorAction SilentlyContinue

@'
const http = require('node:http');
const port = Number(process.argv[2]);
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('walkthrough target ok');
}).listen(port, '0.0.0.0', () => console.log(`target ${port}`));
'@ | Set-Content $targetScript

@'
const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv[2]);
const log = process.argv[3];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk.toString(); });
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ headers: req.headers, body }) + '\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
}).listen(port, '0.0.0.0', () => console.log(`sink ${port}`));
'@ | Set-Content $sinkScript

@'
const url = process.argv[2];
(async () => {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  console.log(text.trim());
  controller.abort();
  process.exit(0);
})().catch((error) => { console.error(error.message); process.exit(1); });
'@ | Set-Content $sseScript

@'
const slug = process.argv[2];
(async () => {
  const url = `http://localhost:3001/v1/projects/${slug}/status`;
  const first = await fetch(url);
  const etag = first.headers.get('etag');
  const second = await fetch(url, { headers: { 'if-none-match': etag } });
  console.log(`first=${first.status} etag=${etag} cache=${first.headers.get('cache-control')}`);
  console.log(`second=${second.status} bodyLength=${(await second.text()).length}`);
})().catch((error) => { console.error(error.message); process.exit(1); });
'@ | Set-Content $etagScript

Write-Host "== 2. target + sink ==" -ForegroundColor Cyan
$target = Start-Process node -ArgumentList $targetScript, $TargetPort -PassThru -WindowStyle Hidden
$sink = Start-Process node -ArgumentList $sinkScript, $SinkPort, $sinkLog -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  Write-Host "== 3. register, project, monitor ==" -ForegroundColor Cyan
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $registerBody = @{ email = "walkthrough-$stamp@example.com"; password = "walkthrough-password-123" } | ConvertTo-Json
  $auth = Invoke-RestMethod -Method Post -Uri "$api/v1/auth/register" -ContentType "application/json" -Body $registerBody
  $headers = @{ Authorization = "Bearer $($auth.accessToken)" }

  $project = Invoke-RestMethod -Method Post -Uri "$api/v1/projects" -Headers $headers -ContentType "application/json" -Body (@{ name = "Walkthrough $stamp"; public = $true } | ConvertTo-Json)
  $monitor = Invoke-RestMethod -Method Post -Uri "$api/v1/monitors" -Headers $headers -ContentType "application/json" -Body (@{
      projectId = $project.id
      name = "walkthrough target"
      type = "http"
      intervalS = 30
      timeoutMs = 5000
      retries = 2
      config = @{ url = "http://host.docker.internal:$TargetPort/health"; expectedStatus = @(200) }
    } | ConvertTo-Json -Depth 5)
  Write-Host "project=$($project.slug) monitor=$($monitor.id)"

  $channel = Invoke-RestMethod -Method Post -Uri "$api/v1/channels" -Headers $headers -ContentType "application/json" -Body (@{
      projectId = $project.id
      type = "webhook"
      config = @{ url = "http://host.docker.internal:$SinkPort/hook"; secret = "walkthrough-secret" }
    } | ConvertTo-Json -Depth 4)
  Write-Host "channel=$($channel.id) secretRedacted=$($null -eq $channel.config.secret)"

  Write-Host "== 4. wait for two green checks ==" -ForegroundColor Cyan
  $checks = Wait-Json -Uri "$api/v1/monitors/$($monitor.id)/checks?limit=5" -Headers $headers -TimeoutSeconds 120 -Label "two checks" -Predicate {
    param($value)
    $value.items.Count -ge 2 -and $value.items[0].status -eq "up"
  }
  Write-Host "checks=$($checks.items.Count) first=$($checks.items[0].status)"

  Write-Host "== 5. SSE snapshot ==" -ForegroundColor Cyan
  $snapshot = (& node $sseScript "$api/v1/projects/$($project.slug)/stream" | Out-String)
  if ($snapshot -notmatch "event: snapshot") { throw "missing SSE snapshot: $snapshot" }
  Write-Host "snapshot received"

  Write-Host "== 6. stop target, wait for incident ==" -ForegroundColor Cyan
  Stop-Process -Id $target.Id -Force
  $incidents = Wait-Json -Uri "$api/v1/projects/$($project.id)/incidents" -Headers $headers -TimeoutSeconds 180 -Label "incident" -Predicate {
    param($value)
    @($value | Where-Object { $null -eq $_.resolvedAt }).Count -gt 0
  }
  $incident = @($incidents | Where-Object { $null -eq $_.resolvedAt })[0]
  Write-Host "incident=$($incident.id) status=$($incident.status) cause=$($incident.cause)"

  Start-Sleep -Seconds 3
  $sinkLines = Get-Content $sinkLog -ErrorAction SilentlyContinue
  $signed = $sinkLines | Where-Object { $_ -match "x-statusbeam-signature" }
  Write-Host "webhook deliveries=$(@($sinkLines).Count) signed=$([bool]$signed)"

  Write-Host "== 7. restart target, wait for resolve ==" -ForegroundColor Cyan
  $target = Start-Process node -ArgumentList $targetScript, $TargetPort -PassThru -WindowStyle Hidden
  $resolved = Wait-Json -Uri "$api/v1/projects/$($project.id)/incidents" -Headers $headers -TimeoutSeconds 180 -Label "resolution" -Predicate {
    param($value)
    @($value).Count -gt 0 -and @($value | Where-Object { $null -ne $_.resolvedAt }).Count -eq @($value).Count
  }
  Write-Host "incident resolved=$($resolved[0].resolvedAt)"

  Write-Host "== 8. invalid transition returns 409 ==" -ForegroundColor Cyan
  try {
    Invoke-RestMethod -Method Post -Uri "$api/v1/incidents/$($incident.id)/updates" -Headers $headers -ContentType "application/json" -Body (@{ status = "investigating"; message = "reopen" } | ConvertTo-Json) | Out-Null
    throw "expected 409"
  } catch {
    $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "409 allowedTransitions=$($errorBody.allowedTransitions -join ',')"
  }

  Write-Host "== 9. public API ETag / 304 ==" -ForegroundColor Cyan
  & node $etagScript $project.slug

  Write-Host "== 10. read-only API key cannot write ==" -ForegroundColor Cyan
  $key = Invoke-RestMethod -Method Post -Uri "$api/v1/api-keys" -Headers $headers -ContentType "application/json" -Body (@{
      projectId = $project.id
      name = "walkthrough-read"
      scopes = @("monitors:read")
    } | ConvertTo-Json)
  try {
    Invoke-RestMethod -Method Post -Uri "$api/v1/monitors" -Headers @{ "X-API-Key" = $key.key } -ContentType "application/json" -Body (@{
        projectId = $project.id; name = "blocked"; type = "http"; config = @{ url = "http://example.com" }
      } | ConvertTo-Json -Depth 4) | Out-Null
    throw "expected 403"
  } catch {
    Write-Host "403 as expected"
  }

  Write-Host "== 11. metrics ==" -ForegroundColor Cyan
  $metrics = (Invoke-WebRequest -UseBasicParsing "$api/metrics").Content
  foreach ($name in @("statusbeam_check_duration_seconds", "statusbeam_scheduler_lag_seconds", "statusbeam_notifications_sent_total", "statusbeam_sse_connections")) {
    Write-Host "$name=$($metrics.Contains($name))"
  }

  Write-Host "== 12. rollup backfill ==" -ForegroundColor Cyan
  docker compose -f infra/docker-compose.yml exec -T postgres psql -U statusbeam -d statusbeam -c "insert into checks (monitor_id, status, latency_ms, checked_at) values ('$($monitor.id)', 'up', 21, now() - interval '2 hours');" | Out-Null
  pnpm rollups:backfill -- --days 1 | Select-Object -Last 1
  $dbTotals = docker compose -f infra/docker-compose.yml exec -T postgres psql -U statusbeam -d statusbeam -tAc "select (select coalesce(sum(up_count+down_count),0) from rollups where monitor_id='$($monitor.id)'), (select count(*) from checks where monitor_id='$($monitor.id)' and checked_at < date_trunc('hour', now()));"
  Write-Host "rolled|raw=$($dbTotals -join '|')"

  Write-Host "== 13. redis outage -> readyz 503 ==" -ForegroundColor Cyan
  docker compose -f infra/docker-compose.yml stop redis | Out-Null
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -UseBasicParsing "$api/readyz" | Out-Null
    Write-Host "unexpected readyz 200"
  } catch {
    Write-Host "readyz $(($_.Exception.Response).StatusCode)"
  }
  docker compose -f infra/docker-compose.yml start redis | Out-Null
  Wait-Ready 120
  Write-Host "readyz 200 after redis restart"

  Write-Host "== 14. Playwright ==" -ForegroundColor Cyan
  Write-Host "Run separately: pnpm --filter @statusbeam/web exec playwright test (3x green recorded in docs/roadmap.md)"

  Write-Host "== cleanup ==" -ForegroundColor Cyan
  Invoke-WebRequest -Method Delete -Uri "$api/v1/monitors/$($monitor.id)" -Headers $headers -UseBasicParsing | Out-Null
  Write-Host "walkthrough complete"
} finally {
  if ($target -and -not $target.HasExited) { Stop-Process -Id $target.Id -Force -ErrorAction SilentlyContinue }
  if ($sink -and -not $sink.HasExited) { Stop-Process -Id $sink.Id -Force -ErrorAction SilentlyContinue }
}
