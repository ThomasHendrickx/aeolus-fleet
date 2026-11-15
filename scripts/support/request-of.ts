import type { Read } from './read.ts';
import type { Target } from './target.ts';

/** The GET of a read on tRPC's plain JSON wire: its input in the query (placeholders filled), its credential in the headers. */
export function requestOf(read: Read, target: Target, found: Readonly<Record<string, string>> = {}): { url: string; headers: Record<string, string> } {
  const base = `${target.url.replace(/\/+$/, '')}/trpc/${read.procedure}`;
  const values: Record<string, string> = { ...found, '<fleet id>': target.fleetId };
  const input = read.input === undefined ? undefined : Object.entries(values).reduce((json, [placeholder, value]) => json.replaceAll(placeholder, value), JSON.stringify(read.input));
  const headers: Record<string, string> =
    read.credential === 'fleet'
      ? { authorization: `Bearer ${target.fleetToken}` }
      : read.credential === 'installation'
        ? { 'x-aeolus-installation-token': target.installationToken, 'aeolus-fleet': target.fleetId }
        : { cookie: `aeolus_session=${target.consoleSession}` };
  return { url: input === undefined ? base : `${base}?input=${encodeURIComponent(input)}`, headers };
}
