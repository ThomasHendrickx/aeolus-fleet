/**
 * The minimum core version check (decision 0049, docs/compatibility.md): a
 * package of another release train reads core's version at start and refuses
 * to run against an older core, saying both versions.
 */
import { z } from 'zod';

/** Where core says its version, without authentication. */
export const CORE_VERSION_PATH = '/api/version';

/** How long a package waits for core's version before it counts the fleet as not answering. */
const CORE_VERSION_TIMEOUT_MS = 10_000;

/** The HTTP statuses that answer a version. */
const HTTP_OK_FIRST = 200;
const HTTP_OK_LAST = 299;

/** A plain release version; core `0.0.0` is a build from main. */
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Core's version as `/api/version` answers it. */
const coreVersionAnswerSchema = z.object({ server: z.string() });

/** The part of `fetch` the check uses, so a test hands in its own core. */
export type VersionFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

type Version = readonly [number, number, number];

function versionOf(text: string): Version | undefined {
  const match = VERSION_PATTERN.exec(text);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isOlder(version: Version, than: Version): boolean {
  const differing = version.findIndex((part, index) => part !== than[index]);
  return differing !== -1 && (version[differing] ?? 0) < (than[differing] ?? 0);
}

/** Core's version, or why it could not be read. */
async function readCoreVersion(fleetUrl: string, fetch: VersionFetch): Promise<{ core: string; parsed: Version } | { unread: string }> {
  try {
    const response = await fetch(`${fleetUrl.replace(/\/+$/, '')}${CORE_VERSION_PATH}`, { signal: AbortSignal.timeout(CORE_VERSION_TIMEOUT_MS) });
    if (response.status < HTTP_OK_FIRST || response.status > HTTP_OK_LAST) {
      return { unread: `HTTP ${String(response.status)}` };
    }
    const answer = coreVersionAnswerSchema.safeParse(await response.json());
    const parsed = answer.success ? versionOf(answer.data.server) : undefined;
    return answer.success && parsed !== undefined ? { core: answer.data.server, parsed } : { unread: `its ${CORE_VERSION_PATH} answered no core version` };
  } catch (error) {
    return { unread: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Why the package may not start against the fleet's core, or none when it
 * may: core is at least `minimum`, or is `0.0.0`.
 */
export async function coreVersionRefusal(input: { packageName: string; version: string; minimum: string; fleetUrl: string; fetch: VersionFetch }): Promise<string | undefined> {
  const { packageName, version, minimum, fleetUrl, fetch } = input;
  const needs = `${packageName} ${version} needs core ${minimum} or later`;
  const minimumVersion = versionOf(minimum);
  if (minimumVersion === undefined) {
    throw new Error(`${packageName}'s minimum core version ${minimum} is not MAJOR.MINOR.PATCH`);
  }
  const read = await readCoreVersion(fleetUrl, fetch);
  if ('unread' in read) {
    return `${needs}, and could not read the version of the fleet at ${fleetUrl}: ${read.unread}`;
  }
  const isMainBuild = read.parsed.every((part) => part === 0);
  return isMainBuild || !isOlder(read.parsed, minimumVersion) ? undefined : `${needs}; the fleet at ${fleetUrl} runs core ${read.core}: upgrade core first`;
}
