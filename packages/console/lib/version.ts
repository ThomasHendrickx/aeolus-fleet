import { z } from 'zod';

import webPackage from '../package.json';
import { SESSION_COOKIE } from './console-gate';
import { networkingPluginUrlFrom } from './networking-plugin-url';
import { serverInternalUrlFrom } from './server-url';
import { squadronsUrlFrom } from './squadrons-url';
import { trierarchPluginUrlFrom } from './trierarch-plugin-url';

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

/** What `system.version` answers the operator: the server's versions and its database's latest migration. */
const systemVersionSchema = z.object({ result: z.object({ data: serverVersionSchema.extend({ migration: z.string().nullable() }) }) });

/** The answer to a signed-in operator: every running component's version, each plugin the console has with null when it does not answer. */
export interface OperatorVersion {
  web: string;
  server: z.infer<typeof systemVersionSchema>['result']['data'];
  squadrons?: string | null;
  trierarchPlugin?: string | null;
  networkingPlugin?: string | null;
}

async function answerAt(url: string, cookie?: string): Promise<{ isOk: boolean; body: unknown } | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', headers: cookie === undefined ? {} : { cookie }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { isOk: response.ok, body: await response.json() };
  } catch {
    return null;
  }
}

async function serverVersionAt(url: string): Promise<WebVersion['server']> {
  const answer = await answerAt(`${url}/api/version`);
  const parsed = serverVersionSchema.safeParse(answer?.body);
  return answer?.isOk === true && parsed.success ? parsed.data : null;
}

/** The server's `system.version` for the session the cookie names; undefined unless the server answers it, as it does the operator's session only. */
async function systemVersionAt(url: string, cookie: string): Promise<OperatorVersion['server'] | undefined> {
  const answer = await answerAt(`${url}/trpc/system.version`, cookie);
  const parsed = systemVersionSchema.safeParse(answer?.body);
  return answer?.isOk === true && parsed.success ? parsed.data.result.data : undefined;
}

/** A plugin's own version, from its /api/version; null when it does not answer, or answers something else. */
async function pluginVersionAt(url: string, key: string): Promise<string | null> {
  const answer = await answerAt(`${url}/api/version`);
  const parsed = z.object({ [key]: z.string() }).safeParse(answer?.body);
  return answer?.isOk === true && parsed.success ? (parsed.data[key] ?? null) : null;
}

const PLUGINS = [
  { key: 'squadrons', urlFrom: squadronsUrlFrom },
  { key: 'trierarchPlugin', urlFrom: trierarchPluginUrlFrom },
  { key: 'networkingPlugin', urlFrom: networkingPluginUrlFrom },
] as const;

/** Each plugin the console has, by its own version; a plugin it does not have is left out. */
async function pluginVersions(environment: Readonly<Record<string, string | undefined>>): Promise<Pick<OperatorVersion, (typeof PLUGINS)[number]['key']>> {
  const answered = await Promise.all(
    PLUGINS.map(async ({ key, urlFrom }) => {
      const url = urlFrom(environment);
      return url === undefined ? [] : [[key, await pluginVersionAt(url, key)] as const];
    }),
  );
  return Object.fromEntries(answered.flat());
}

function hasSessionCookie(cookie: string): boolean {
  return cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

/**
 * The live versions, for whoever operates the installation (issue #49): this
 * web process's own and the server process's own answer, so a deploy that
 * failed halfway shows. Without a signed-in operator only those versions
 * (#432): nothing about plugins, migrations, configuration or fleets. To the
 * operator's session, which the server's `system.version` takes and a
 * viewer's it does not, every running component's version: the server's
 * latest migration and each plugin the console has (#478). Never
 * configuration metadata: no URLs, connected fleets or installation state.
 */
export async function webVersion(
  environment: Readonly<Record<string, string | undefined>>,
  request: { cookie?: string; web?: string } = {},
): Promise<WebVersion | OperatorVersion> {
  const web = request.web ?? webPackage.version;
  const serverUrl = serverInternalUrlFrom(environment);
  const cookie = request.cookie ?? '';
  const operatorServer = hasSessionCookie(cookie) ? await systemVersionAt(serverUrl, cookie) : undefined;
  if (operatorServer === undefined) {
    return { web, server: await serverVersionAt(serverUrl) };
  }
  return { web, server: operatorServer, ...(await pluginVersions(environment)) };
}
