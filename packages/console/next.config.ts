import type { NextConfig } from 'next';

// The browser calls the server at AEOLUS_SERVER_URL, which the web app reads
// when it runs (lib/server-url.ts), so one build serves any fleet.
const nextConfig: NextConfig = {
  // next dev would write AGENTS.md and CLAUDE.md here; the advice lives in the web-frontend skill instead.
  agentRules: false,
  experimental: {
    // CI and release build from a clean checkout and never read .next/cache
    // again, so writing Turbopack's build cache there only costs time and disk.
    turbopackFileSystemCacheForBuild: process.env.CI === undefined,
  },
};

export default nextConfig;
