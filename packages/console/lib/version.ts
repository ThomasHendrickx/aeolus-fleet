import { z } from 'zod';

import webPackage from '../package.json';
import { serverInternalUrlFrom } from './server-url';

const TIMEOUT_MS = 3_000;

/** The versions the server's /api/version answers for its process; anything else it says is dropped. */
const serverVersionSchema = z.object({
  server: z.string(),
  common: z.string(),
});

/** The version the trierarch plugin's own /api/version answers for its process. */
const trierarchPluginVersionSchema = z.object({ trierarchPlugin: z.string() });

/**
 * The trierarch plugin's version from its own /api/version, for the
 * Trierarchs header (#332); undefined when the answer is something else.
 */
export function trierarchPluginVersionOf(body: unknown): string | undefined {
  const parsed = trierarchPluginVersionSchema.safeParse(body);
  return parsed.success ? parsed.data.trierarchPlugin : undefined;
}

export interface WebVersion {
  /** The version of the web app this process runs. */
  web: string;
  /** The versions the server process runs; null when it does not answer. */
  server: z.infer<typeof serverVersionSchema> | null;
}

async function serverVersionAt(url: string): Promise<WebVersion['server']> {
  try {
    const response = await fetch(`${url}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const parsed = serverVersionSchema.safeParse(await response.json());
    return response.ok && parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The live versions, for whoever operates the installation (issue #49), asked
 * without a session: this web process's own and the server process's own
 * answer, so a deploy that failed halfway shows. Only the versions of the
 * components running (#432): nothing about plugins, migrations, configuration
 * or fleets.
 */
export async function webVersion(environment: Readonly<Record<string, string | undefined>>, web: string = webPackage.version): Promise<WebVersion> {
  return { web, server: await serverVersionAt(serverInternalUrlFrom(environment)) };
}
