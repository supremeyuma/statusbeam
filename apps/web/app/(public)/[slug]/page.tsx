import { notFound } from 'next/navigation';

import { fetchPublicStatus } from '@/lib/api';
import { StatusLive } from './status-live';

export const dynamic = 'force-dynamic';

export default async function PublicStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const status = await fetchPublicStatus(slug);

  if (!status) {
    notFound();
  }

  return <StatusLive slug={slug} initial={status} />;
}
