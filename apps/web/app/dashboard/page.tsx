'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type {
  ApiScope,
  ChannelResponse,
  IncidentResponse,
  MonitorResponse,
  ProjectResponse,
} from '@statusbeam/contracts';
import { API_SCOPES } from '@statusbeam/contracts';

import { api, refreshAccessToken, setAccessToken } from '@/lib/client';
import styles from './dashboard.module.css';

interface ApiErrorBody {
  message?: string | string[];
  allowedTransitions?: string[];
}

async function readApiError(result: { response: Response }): Promise<ApiErrorBody> {
  try {
    return (await result.response.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

const NEXT_STATUSES: Record<string, string[]> = {
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['monitoring', 'resolved'],
  monitoring: ['resolved'],
  resolved: [],
};

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [monitors, setMonitors] = useState<MonitorResponse[]>([]);
  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);
  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [selectedMonitor, setSelectedMonitor] = useState<string>('');
  const [checks, setChecks] = useState<
    Array<{ id: number; status: string; latencyMs: number; checkedAt: string }>
  >([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [projectName, setProjectName] = useState('');
  const [monitorName, setMonitorName] = useState('');
  const [monitorType, setMonitorType] = useState<'http' | 'tcp'>('http');
  const [monitorUrl, setMonitorUrl] = useState('https://example.com/health');
  const [monitorHost, setMonitorHost] = useState('example.com');
  const [monitorPort, setMonitorPort] = useState('443');
  const [monitorInterval, setMonitorInterval] = useState('60');
  const [monitorRetries, setMonitorRetries] = useState('3');

  const [channelType, setChannelType] = useState<'webhook' | 'slack' | 'email'>('webhook');
  const [channelTarget, setChannelTarget] = useState('');
  const [channelSecret, setChannelSecret] = useState('');

  const [keyScopes, setKeyScopes] = useState<ApiScope[]>(['monitors:read', 'monitors:write']);
  const [keyName, setKeyName] = useState('automation');

  const [incidentId, setIncidentId] = useState('');
  const [incidentStatus, setIncidentStatus] = useState('identified');
  const [incidentMessage, setIncidentMessage] = useState('');

  const loadProjects = useCallback(async () => {
    const result = await api.GET('/v1/projects');
    if (result.response.status === 401) {
      router.replace('/login');
      return;
    }
    if (result.data) {
      setProjects(result.data);
      setProjectId((current) => current || result.data[0]?.id || '');
    }
  }, [router]);

  const loadProjectData = useCallback(async (id: string) => {
    if (!id) {
      return;
    }
    const [monitorResult, incidentResult, channelResult] = await Promise.all([
      api.GET('/v1/monitors', { params: { query: { projectId: id } } }),
      api.GET('/v1/projects/{projectId}/incidents', { params: { path: { projectId: id } } }),
      api.GET('/v1/channels', { params: { query: { projectId: id } } }),
    ]);
    if (monitorResult.data) {
      setMonitors(monitorResult.data);
      setSelectedMonitor((current) => current || monitorResult.data?.[0]?.id || '');
    }
    if (incidentResult.data) {
      setIncidents(incidentResult.data);
    }
    if (channelResult.data) {
      setChannels(channelResult.data);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const token = await refreshAccessToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      setAccessToken(token);
      const me = await api.GET('/v1/projects');
      if (me.response.status === 401) {
        router.replace('/login');
        return;
      }
      await loadProjects();
      setReady(true);
    })();
  }, [loadProjects, router]);

  useEffect(() => {
    if (projectId) {
      void loadProjectData(projectId);
    }
  }, [loadProjectData, projectId]);

  useEffect(() => {
    if (!selectedMonitor) {
      setChecks([]);
      return;
    }
    void api
      .GET('/v1/monitors/{id}/checks', {
        params: { path: { id: selectedMonitor }, query: { limit: 60 } },
      })
      .then((result) => {
        if (result.data) {
          setChecks(result.data.items);
        }
      });
  }, [selectedMonitor]);

  async function createProject(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const result = await api.POST('/v1/projects', { body: { name: projectName } });
    if (!result.data) {
      setError(`Could not create project (${result.response.status})`);
      return;
    }
    setProjectName('');
    await loadProjects();
    setProjectId(result.data.id);
  }

  async function createMonitor(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!projectId) {
      return;
    }
    const base = {
      projectId,
      name: monitorName,
      intervalS: Number(monitorInterval),
      retries: Number(monitorRetries),
    };
    const result =
      monitorType === 'http'
        ? await api.POST('/v1/monitors', {
            body: { ...base, type: 'http', config: { url: monitorUrl } },
          })
        : await api.POST('/v1/monitors', {
            body: {
              ...base,
              type: 'tcp',
              config: { host: monitorHost, port: Number(monitorPort) },
            },
          });

    if (!result.data) {
      const body = await readApiError(result);
      setError(
        Array.isArray(body.message)
          ? body.message.join(', ')
          : (body.message ?? 'Monitor rejected'),
      );
      return;
    }
    setMonitorName('');
    await loadProjectData(projectId);
  }

  async function toggleMonitor(monitor: MonitorResponse): Promise<void> {
    await api.PATCH('/v1/monitors/{id}', {
      params: { path: { id: monitor.id } },
      body: { active: !monitor.active },
    });
    await loadProjectData(projectId);
  }

  async function deleteMonitor(monitor: MonitorResponse): Promise<void> {
    await api.DELETE('/v1/monitors/{id}', { params: { path: { id: monitor.id } } });
    await loadProjectData(projectId);
  }

  async function createChannel(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const config =
      channelType === 'webhook'
        ? {
            url: channelTarget,
            ...(channelSecret ? { secret: channelSecret } : {}),
          }
        : channelType === 'slack'
          ? { webhookUrl: channelTarget }
          : { to: channelTarget };

    const result = await api.POST('/v1/channels', {
      body: { projectId, type: channelType, config } as never,
    });
    if (!result.data) {
      setError(`Channel rejected (${result.response.status})`);
      return;
    }
    setChannelTarget('');
    setChannelSecret('');
    await loadProjectData(projectId);
  }

  async function createApiKey(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const result = await api.POST('/v1/api-keys', {
      body: { projectId, name: keyName, scopes: keyScopes },
    });
    if (!result.data) {
      const body = await readApiError(result);
      setError(
        Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? 'Key rejected'),
      );
      return;
    }
    setNewKey(result.data.key ?? null);
  }

  async function submitIncident(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const result = await api.POST('/v1/incidents/{id}/updates', {
      params: { path: { id: incidentId } },
      body: { status: incidentStatus as never, message: incidentMessage },
    });
    if (!result.data) {
      const body = await readApiError(result);
      setError(
        body.allowedTransitions
          ? `Invalid transition. Allowed: ${body.allowedTransitions.join(', ') || 'none'}`
          : ((Array.isArray(body.message) ? body.message.join(', ') : body.message) ??
              `Update rejected (${result.response.status})`),
      );
      return;
    }
    setIncidentMessage('');
    await loadProjectData(projectId);
  }

  if (!ready) {
    return <main className={styles.page}>Loading dashboard…</main>;
  }

  const selected = monitors.find((monitor) => monitor.id === selectedMonitor);
  const activeIncident = incidents.find((incident) => incident.resolvedAt === null);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>StatusBeam dashboard</p>
          <h1 className={styles.title}>
            {projects.find((p) => p.id === projectId)?.name ?? 'Projects'}
          </h1>
        </div>
        <div className={styles.headerActions}>
          <select
            className={styles.select}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            aria-label="Project"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            className={styles.ghost}
            type="button"
            onClick={() => {
              setAccessToken(null);
              router.replace('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Projects</h2>
          <form onSubmit={(event) => void createProject(event)} className={styles.form}>
            <input
              className={styles.input}
              placeholder="New project name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              required
            />
            <button className={styles.primary} type="submit">
              Create project
            </button>
          </form>
          {projects[0] ? (
            <p className={styles.muted}>
              Public slug: {projects.find((p) => p.id === projectId)?.slug}
            </p>
          ) : null}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Monitors</h2>
          {monitors.length === 0 ? <p className={styles.muted}>No monitors yet.</p> : null}
          <ul className={styles.list}>
            {monitors.map((monitor) => (
              <li key={monitor.id} className={styles.listItem}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setSelectedMonitor(monitor.id)}
                >
                  <strong>{monitor.name}</strong>
                  <span
                    className={`${styles.pill} ${styles[`pill_${monitor.lastStatus ?? 'unknown'}`]}`}
                  >
                    {monitor.lastStatus ?? 'pending'}
                  </span>
                </button>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => void toggleMonitor(monitor)}
                  >
                    {monitor.active ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => void deleteMonitor(monitor)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>New monitor</h2>
          <form onSubmit={(event) => void createMonitor(event)} className={styles.form}>
            <input
              className={styles.input}
              placeholder="Monitor name"
              value={monitorName}
              onChange={(event) => setMonitorName(event.target.value)}
              required
            />
            <select
              className={styles.select}
              value={monitorType}
              onChange={(event) => setMonitorType(event.target.value as 'http' | 'tcp')}
            >
              <option value="http">HTTP</option>
              <option value="tcp">TCP</option>
            </select>
            {monitorType === 'http' ? (
              <input
                className={styles.input}
                placeholder="https://example.com/health"
                value={monitorUrl}
                onChange={(event) => setMonitorUrl(event.target.value)}
                required
              />
            ) : (
              <div className={styles.inline}>
                <input
                  className={styles.input}
                  value={monitorHost}
                  onChange={(event) => setMonitorHost(event.target.value)}
                  required
                />
                <input
                  className={styles.input}
                  type="number"
                  value={monitorPort}
                  onChange={(event) => setMonitorPort(event.target.value)}
                  required
                />
              </div>
            )}
            <div className={styles.inline}>
              <label className={styles.field}>
                Interval (s)
                <input
                  className={styles.input}
                  type="number"
                  min={30}
                  max={3600}
                  value={monitorInterval}
                  onChange={(event) => setMonitorInterval(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                Retries
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={10}
                  value={monitorRetries}
                  onChange={(event) => setMonitorRetries(event.target.value)}
                />
              </label>
            </div>
            <button className={styles.primary} type="submit">
              Add monitor
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Check history</h2>
          {selected ? (
            <>
              <p className={styles.muted}>
                {selected.name} · {selected.type.toUpperCase()} · last {checks.length} checks
              </p>
              <div className={styles.sparkline} aria-label="Latency history">
                {checks
                  .slice()
                  .reverse()
                  .map((check) => (
                    <span
                      key={check.id}
                      className={check.status === 'up' ? styles.sparkUp : styles.sparkDown}
                      style={{ height: `${Math.min(100, Math.max(8, check.latencyMs / 5))}%` }}
                      title={`${check.status} ${check.latencyMs}ms`}
                    />
                  ))}
              </div>
            </>
          ) : (
            <p className={styles.muted}>Select a monitor.</p>
          )}
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Incidents</h2>
          {activeIncident ? (
            <p className={styles.muted}>
              Active: {activeIncident.status} since{' '}
              {new Date(activeIncident.startedAt).toLocaleString()}
            </p>
          ) : (
            <p className={styles.muted}>No active incident.</p>
          )}
          <ul className={styles.list}>
            {incidents.slice(0, 5).map((incident) => (
              <li key={incident.id} className={styles.listItem}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setIncidentId(incident.id)}
                >
                  <strong>{incident.status}</strong>
                  <span className={styles.muted}>
                    {new Date(incident.startedAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={(event) => void submitIncident(event)} className={styles.form}>
            <select
              className={styles.select}
              value={incidentId}
              onChange={(event) => {
                setIncidentId(event.target.value);
                const incident = incidents.find((item) => item.id === event.target.value);
                setIncidentStatus(NEXT_STATUSES[incident?.status ?? '']?.[0] ?? 'resolved');
              }}
              required
            >
              <option value="">Select incident</option>
              {incidents.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.status} · {new Date(incident.startedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={incidentStatus}
              onChange={(event) => setIncidentStatus(event.target.value)}
            >
              {(
                NEXT_STATUSES[incidents.find((item) => item.id === incidentId)?.status ?? ''] ?? []
              ).map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <textarea
              className={styles.textarea}
              placeholder="Update message"
              value={incidentMessage}
              onChange={(event) => setIncidentMessage(event.target.value)}
              required
            />
            <button className={styles.primary} type="submit" disabled={!incidentId}>
              Post update
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Notification channels</h2>
          <ul className={styles.list}>
            {channels.map((channel) => (
              <li key={channel.id} className={styles.listItem}>
                <strong>{channel.type}</strong>
                <span className={styles.muted}>{channel.active ? 'active' : 'paused'}</span>
              </li>
            ))}
          </ul>
          <form onSubmit={(event) => void createChannel(event)} className={styles.form}>
            <select
              className={styles.select}
              value={channelType}
              onChange={(event) => setChannelType(event.target.value as typeof channelType)}
            >
              <option value="webhook">Webhook</option>
              <option value="slack">Slack</option>
              <option value="email">Email</option>
            </select>
            <input
              className={styles.input}
              placeholder={channelType === 'email' ? 'ops@example.com' : 'https://hooks…'}
              value={channelTarget}
              onChange={(event) => setChannelTarget(event.target.value)}
              required
            />
            {channelType === 'webhook' ? (
              <input
                className={styles.input}
                placeholder="HMAC secret (optional)"
                value={channelSecret}
                onChange={(event) => setChannelSecret(event.target.value)}
              />
            ) : null}
            <button className={styles.primary} type="submit">
              Add channel
            </button>
          </form>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>API keys</h2>
          <form onSubmit={(event) => void createApiKey(event)} className={styles.form}>
            <input
              className={styles.input}
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              required
            />
            <div className={styles.scopes}>
              {API_SCOPES.map((scope) => (
                <label key={scope} className={styles.scope}>
                  <input
                    type="checkbox"
                    checked={keyScopes.includes(scope)}
                    onChange={(event) =>
                      setKeyScopes((current) =>
                        event.target.checked
                          ? [...current, scope]
                          : current.filter((value) => value !== scope),
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
            <button className={styles.primary} type="submit">
              Create key
            </button>
          </form>
          {newKey ? (
            <p className={styles.secret}>
              Copy this key now: <code>{newKey}</code>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
