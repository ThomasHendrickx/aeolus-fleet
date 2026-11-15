import { paletteListSchema, PALETTE_LIST_PATH, type FleetId, type PaletteList } from '@aeolus-fleet/common';
import { otherAppsPaletteOf, paletteOriginsOf, type AppPaletteGroup, type ReadPaletteList } from '@aeolus-fleet/common/rules';

import { appsListOfThisPageLoad } from './apps-list-read';
import type { PluginAnswer } from './plugin-answer';

/**
 * The other apps' palette entries for the console (docs/design/header-across-apps.md,
 * A2): the web app's server reads the palette list of each app the signed-in
 * account may open (the apps list the header's read took, lib/apps-list-read.ts)
 * from the fleet in view, and outside any fleet, and keeps it
 * for a while by its origin (header design H4), never another fleet's apps.
 * The shared rule keeps each list with the origin it was read from and only
 * the entries the account may open. An app that does not answer shows by its
 * name alone.
 */

/** How long a list read is kept: an app's pages and actions change with its releases. */
const LIST_KEPT_MS = 5 * 60 * 1000;
/** How long the console waits for an app's list before showing the app by name. */
const LIST_TIMEOUT_MS = 1500;

const kept = new Map<string, { list: PaletteList | undefined; readAt: number }>();

async function paletteListAt(origin: string, now: number): Promise<PaletteList | undefined> {
  const held = kept.get(origin);
  if (held !== undefined && now - held.readAt < LIST_KEPT_MS) {
    return held.list;
  }
  let list: PaletteList | undefined;
  try {
    const response = await fetch(new URL(PALETTE_LIST_PATH, origin), { cache: 'no-store', signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    const parsed = response.ok ? paletteListSchema.safeParse(await response.json()) : undefined;
    list = parsed?.success === true ? parsed.data : undefined;
  } catch {
    list = undefined;
  }
  kept.set(origin, { list, readAt: now });
  return list;
}

export async function readPaletteAcrossApps({ fleetId }: { fleetId: FleetId }): Promise<PluginAnswer<AppPaletteGroup[]>> {
  const list = await appsListOfThisPageLoad();
  if (list === null) {
    return { kind: 'answered', data: [] };
  }
  const now = Date.now();
  const origins = paletteOriginsOf({ list, fleetId, openApp: 'console' });
  const paletteLists = (await Promise.all(origins.map(async (origin): Promise<ReadPaletteList | undefined> => {
    const read = await paletteListAt(origin, now);
    return read === undefined ? undefined : { origin, list: read };
  }))).filter((read) => read !== undefined);
  return { kind: 'answered', data: otherAppsPaletteOf({ list, fleetId, openApp: 'console', paletteLists }) };
}
