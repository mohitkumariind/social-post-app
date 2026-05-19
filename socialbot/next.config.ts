import type { NextConfig } from 'next';
import path from 'path';

const socialbotRoot = path.resolve(__dirname);
const monorepoRoot = path.resolve(__dirname, '..');

/**
 * Vercel / monorepo: never set turbopack.root to the repo root — it contains Expo's `app/`
 * and can prevent App Router from registering socialbot API routes in production.
 * Shared code lives under socialbot/lib (not ../../lib) for deterministic discovery.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: socialbotRoot,
  },
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
