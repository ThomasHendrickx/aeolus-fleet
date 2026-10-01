import { z } from 'zod';

import webPackage from '../package.json';

/** What the server's /api/version answers: the versions its process runs and the latest applied migration. */
const serverVersionSchema = z.object({
  server: z.string(),
  common: z.string(),
  migration: z.string().nullable(),
});

export interface WebVersion {
  /** The version of the web app this process runs. */
  web: string;
  /** What the server process answers for itself; null when it does not answer. */
  server: z.infer<typeof serverVersionSchema> | null;
}

/**
 * The live versions, for whoever operates the installation (issue #49): this
 * web process's own, plus the server process's own answer. Each process
 * reports what it runs, so a deploy that failed halfway shows. No
 * authentication and no fleet data.
 */
export async function webVersion(fetchServerVersion: () => Promise<Response>, web: string = webPackage.version): Promise<WebVersion> {
  try {
    const response = await fetchServerVersion();
    const parsed = serverVersionSchema.safeParse(await response.json());
    return { web, server: response.ok && parsed.success ? parsed.data : null };
  } catch {
    return { web, server: null };
  }
}
