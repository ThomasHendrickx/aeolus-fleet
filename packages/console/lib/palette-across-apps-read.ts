import { paletteListSchema, PALETTE_LIST_PATH, type FleetId, type PaletteList } from '@aeolus-fleet/common';
import { otherAppsPaletteOf, type AppPaletteGroup } from '@aeolus-fleet/common/rules';
import { cookies } from 'next/headers';

import { appsListFor } from './apps-list';
import type { PluginAnswer } from './plugin-answer';

/**
 * The other apps' palette entries for the console (docs/design/header-across-apps.md,
 * A2): the web app's server reads the palette list of each app the signed-in
 * account may open and keeps it for a while (header design H4), then keeps
 * only those apps, linked into the fleet in view. An app that does not answer
 * shows by its name alone.
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
  const list = await appsListFor({ environment: process.env, cookieHeader: (await cookies()).toString() });
  if (list === null) {
    return { kind: 'answered', data: [] };
  }
  const now = Date.now();
  const origins = [...new Set([...list.apps, ...list.fleets.flatMap((fleet) => fleet.apps)].filter((link) => link.app !== 'console').map((link) => new URL(link.url).origin))];
  const paletteLists = (await Promise.all(origins.map((origin) => paletteListAt(origin, now)))).filter((held) => held !== undefined);
  return { kind: 'answered', data: otherAppsPaletteOf({ list, fleetId, openApp: 'console', paletteLists }) };
}
