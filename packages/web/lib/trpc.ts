import type { AppRouter } from '@aeolus-fleet/server';
import { createTRPCContext } from '@trpc/tanstack-react-query';

// The web app reaches the server only through the tRPC router, and imports only
// its type (docs/architecture.md, "Boundary rules").
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
