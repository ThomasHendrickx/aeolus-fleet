import { initTRPC } from '@trpc/server';

import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;

/** A procedure anyone can call. Auth arrives with slice 1. */
export const publicProcedure = t.procedure;
