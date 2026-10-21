import { z } from 'zod';

import { idSchema } from '../ids/index.js';
import { accountIdSchema } from './account-token.js';

/*
 * The apps and fleets an account may open, as pagasae answers an Aeolus app's
 * server at GET /api/apps (header design H1): Account always and Admin for
 * the App admin, outside any fleet; then each fleet where the account holds
 * any scope, with the console where it holds fleet:read and the gateway where
 * it is on, and whether it may sign in as argo there.
 */

/** The Aeolus web apps the header switches between (H12: plugin pages are not apps yet). */
export const HEADER_APPS = ['console', 'gateway', 'account', 'admin'] as const;
export const headerAppSchema = z.enum(HEADER_APPS);
export type HeaderApp = z.infer<typeof headerAppSchema>;

/** An app the header links to, and where: an http(s) address only, since the browser follows it. */
export const appLinkSchema = z.object({ app: headerAppSchema, url: z.httpUrl() });
export type AppLink = z.infer<typeof appLinkSchema>;

export const appsListSchema = z.object({
  account: z.object({ id: accountIdSchema, email: z.string() }),
  apps: z.array(appLinkSchema),
  fleets: z.array(z.object({ id: idSchema('fleet'), name: z.string(), argo: z.boolean(), apps: z.array(appLinkSchema) })),
});
export type AppsList = z.infer<typeof appsListSchema>;
