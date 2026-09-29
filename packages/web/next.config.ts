import type { NextConfig } from 'next';

// The browser calls /trpc on the web app's own origin. In production a reverse
// proxy routes /trpc to the server (docs/architecture.md, "Deployment"); without
// one, as in development, Next forwards it to AEOLUS_SERVER_URL.
const serverUrl = process.env.AEOLUS_SERVER_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  // next dev would write AGENTS.md and CLAUDE.md here; the advice lives in the web-frontend skill instead.
  agentRules: false,
  rewrites: () => Promise.resolve([{ source: '/trpc/:path*', destination: `${serverUrl}/trpc/:path*` }]),
};

export default nextConfig;
