# 0009. Stack

Status: accepted, 2026-09-29

## Context

Thomas maintains this alongside other projects built on the same stack.

## Decision

Node.js 26 and TypeScript with npm workspaces; Fastify with the tRPC adapter and WebSockets; Next.js App Router with shadcn/ui on Base UI and TanStack Query; Prisma with typed raw SQL for locking and notify; Zod in common; Argon2id operator password with a server-side session; pino; Vitest, Testcontainers Postgres and Playwright. The server is a long-running process, not serverless.

## Rejected

Vite SPA, Hono, Drizzle and server-sent events (proposed, rejected in favour of the known stack).

## Amendment, 2026-09-29

No Argon2id and no operator password: the operator signs in with the secret of the ship `argo` (decision 0012).
