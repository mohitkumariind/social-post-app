import type { NextConfig } from 'next';
import path from 'path';

/**
 * Monorepo: socialbot imports shared modules from repo root (e.g. `lib/pushChannel.ts`).
 * Pin Turbopack + file tracing to the repo root so production builds match local resolution.
 */
const monorepoRoot = path.resolve(__dirname, '..');

const nextConfig: NextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
