import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'StatusBeam',
  description: 'Uptime monitoring, incident lifecycle, and a public status page with live updates.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
