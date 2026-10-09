import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

// The browser calls the server at AEOLUS_SERVER_URL, which the web app reads
// when it runs (lib/server-url.ts), so one build serves any fleet.
const nextConfig: NextConfig = {
  // next dev would write AGENTS.md and CLAUDE.md here; the advice lives in the web-frontend skill instead.
  agentRules: false,
  // The package ships .next/standalone: the server and only the files it
  // needs, so installing it pulls no Next.js, React or build tooling.
  output: 'standalone',
  // Trace from the repository root: the console bundles @aeolus-fleet/common from its workspace.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // The console shows no next/image, so it optimizes no image and never
  // loads sharp (scripts/standalone.js leaves it out of the package).
  images: { unoptimized: true },
  experimental: {
    // CI and release build from a clean checkout and never read .next/cache
    // again, so writing Turbopack's build cache there only costs time and disk.
    turbopackFileSystemCacheForBuild: process.env.CI === undefined,
  },
};

export default nextConfig;
