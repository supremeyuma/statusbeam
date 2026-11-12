import { CONTRACTS_VERSION } from '@statusbeam/contracts';

export default function HomePage() {
  return (
    <main style={{ padding: '4rem 2rem', maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>StatusBeam</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Uptime monitoring, incident lifecycle, and a public status page with live updates.
      </p>
      <p>
        Dashboard and public status pages arrive in later phases. Contracts package:{' '}
        <code>v{CONTRACTS_VERSION}</code>
      </p>
    </main>
  );
}
