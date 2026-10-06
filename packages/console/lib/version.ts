import { z } from 'zod';

import webPackage from '../package.json';

/** What the server's /api/version answers: the versions its process runs and the latest applied migration. */
const serverVersionSchema = z.object({
  server: z.string(),
  common: z.string(),
  migration: z.string().nullable(),
});

/**
 * What squadrons' /api/version answers: the version its process runs, its
 * latest migration, how many fleets it holds a crew token for, and whether its
 * installation token is set.
 */
const squadronsVersionSchema = z.object({
  squadrons: z.string(),
  migration: z.string().nullable(),
  connectedFleets: z.int().min(0),
  installation: z.enum(['enabled', 'open']),
});

export interface WebVersion {
  /** The version of the web app this process runs. */
  web: string;
  /** What the server process answers for itself; null when it does not answer. */
  server: z.infer<typeof serverVersionSchema> | null;
  /** What squadrons answers for itself, only when the console has squadrons; null when it does not answer. */
  squadrons?: z.infer<typeof squadronsVersionSchema> | null;
}

async function answerOf<T>(fetchVersion: () => Promise<Response>, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const response = await fetchVersion();
    const parsed = schema.safeParse(await response.json());
    return response.ok && parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The live versions, for whoever operates the installation (issue #49): this
 * web process's own, plus the server process's own answer and, when the
 * console has squadrons, squadrons' own. Each process reports what it runs,
 * so a deploy that failed halfway shows. No authentication and no fleet data.
 */
export async function webVersion(sources: {
  fetchServerVersion: () => Promise<Response>;
  /** Squadrons' /api/version; none when the console has no squadrons. */
  fetchSquadronsVersion?: () => Promise<Response>;
  web?: string;
}): Promise<WebVersion> {
  const { fetchServerVersion, fetchSquadronsVersion, web = webPackage.version } = sources;
  const server = await answerOf(fetchServerVersion, serverVersionSchema);
  if (fetchSquadronsVersion === undefined) {
    return { web, server };
  }
  return { web, server, squadrons: await answerOf(fetchSquadronsVersion, squadronsVersionSchema) };
}
