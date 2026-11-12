import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output is for the Linux container image; Windows cannot create the
  // symlinks Next needs for local standalone builds without developer mode.
  ...(process.platform === 'win32' ? {} : { output: 'standalone' as const }),
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  poweredByHeader: false,
  transpilePackages: ['@statusbeam/contracts'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
