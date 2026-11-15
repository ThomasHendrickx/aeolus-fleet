import type { FleetId } from '../ids/index.js';
import type { AppsList, HeaderApp } from '../schemas/apps-list.js';
import type { PaletteList } from '../schemas/palette-list.js';
import { APP_LABELS } from './app-switcher.js';

/*
 * The palette across apps (docs/design/header-across-apps.md, A1 to A3, M2):
 * each app serves a list of its pages and actions (header design H4), and the
 * open app's server keeps of the other apps' lists only the apps the account
 * may open (H1), each under its name, linked into the fleet in view. Each app
 * runs this on its server and hands the palette what to show (0033).
 */

/** The icons a palette list may name; the palette shows the app icon for any other. */
export const PALETTE_ICONS = ['app', 'plus', 'send', 'users', 'ship', 'inbox', 'activity', 'home', 'shield', 'mail', 'lock', 'copy', 'settings', 'network'] as const;
export type PaletteIcon = (typeof PALETTE_ICONS)[number];

/** An entry of another app, as the palette shows it: a link into that app, or a value to copy. */
export interface AppPaletteEntry {
  key: string;
  label: string;
  keywords: readonly string[];
  icon: PaletteIcon;
  href?: string;
  copyText?: string;
}

/** Another app's entries, under its name (M2). */
export interface AppPaletteGroup {
  app: HeaderApp;
  label: string;
  entries: readonly AppPaletteEntry[];
}

/** A palette list as the open app's server read it, from the origin it asked. */
export interface ReadPaletteList {
  origin: string;
  list: PaletteList;
}

/** The apps the account may open from the fleet in view, with where each opens: the fleet's own apps in it, then those outside any fleet. */
function openableAppsOf({ list, fleetId, openApp }: { list: AppsList; fleetId: FleetId; openApp: HeaderApp }): { app: HeaderApp; url: URL }[] {
  const inFleet = (list.fleets.find((fleet) => fleet.id === fleetId)?.apps ?? []).map((link) => {
    const url = new URL(link.url);
    url.searchParams.set('fleet', fleetId);
    return { app: link.app, url };
  });
  return [...inFleet, ...list.apps.map((link) => ({ app: link.app, url: new URL(link.url) }))].filter(({ app }) => app !== openApp);
}

/**
 * The origins whose lists the open app's server reads: those of the other
 * apps the account may open from the fleet in view and outside any fleet,
 * never another fleet's.
 */
export function paletteOriginsOf(input: { list: AppsList; fleetId: FleetId; openApp: HeaderApp }): string[] {
  return [...new Set(openableAppsOf(input).map(({ url }) => url.origin))];
}

/**
 * The rights the apps list shows the account holds in the fleet in view:
 * fleet:read where it lists the console (H1). An account holds no right the
 * list does not show, so an entry needing one is never offered to it.
 */
function rightsHeldOf(list: AppsList, fleetId: FleetId): readonly string[] {
  const fleet = list.fleets.find((held) => held.id === fleetId);
  return fleet?.apps.some((link) => link.app === 'console') === true ? ['fleet:read'] : [];
}

/** Where an entry's path opens in its app, keeping the app's fleet; none when it would leave the app's origin. */
function hrefOf(appUrl: URL, path: string): string | undefined {
  let url: URL;
  try {
    url = new URL(path, appUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== appUrl.origin) {
    return undefined;
  }
  for (const [name, value] of appUrl.searchParams) {
    if (!url.searchParams.has(name)) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

/** An entry as the palette shows it, or none when it leads off its app. */
function shownEntryOf({ app, url: appUrl }: { app: HeaderApp; url: URL }, entry: PaletteList['entries'][number]): AppPaletteEntry | undefined {
  const shown = { key: `${app}:${entry.key}`, label: entry.label, keywords: entry.keywords, icon: entry.icon };
  if (entry.kind === 'copy') {
    return { ...shown, copyText: entry.value };
  }
  const href = hrefOf(appUrl, entry.path);
  return href === undefined ? undefined : { ...shown, href };
}

/**
 * The other apps' groups for the open app: one per app the account may open
 * from the fleet in view, in the header's order, from the list read at that
 * app's own origin, keeping only the entries whose rights the account holds
 * and whose destination stays on the app; an app whose list could not be
 * read shows by its name alone. Nothing without an apps list (argo's sign-in,
 * the viewer, self-hosted).
 */
export function otherAppsPaletteOf(input: { list: AppsList | undefined; fleetId: FleetId; openApp: HeaderApp; paletteLists: readonly ReadPaletteList[] }): AppPaletteGroup[] {
  const { list, fleetId, openApp, paletteLists } = input;
  if (list === undefined) {
    return [];
  }
  const held = rightsHeldOf(list, fleetId);
  return openableAppsOf({ list, fleetId, openApp }).map(({ app, url }): AppPaletteGroup => {
    const label = APP_LABELS[app];
    const paletteList = paletteLists.find((read) => read.origin === url.origin && read.list.app === app)?.list;
    if (paletteList === undefined) {
      return { app, label, entries: [{ key: `${app}:app`, label, keywords: [], icon: 'app', href: url.toString() }] };
    }
    return {
      app,
      label,
      entries: paletteList.entries
        .filter((entry) => entry.rights.every((right) => held.includes(right)))
        .map((entry) => shownEntryOf({ app, url }, entry))
        .filter((entry) => entry !== undefined),
    };
  });
}

/** Whether an entry matches what is typed: its label or a keyword holds it, in any case. */
export function paletteEntryMatches(entry: { label: string; keywords: readonly string[] }, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return [entry.label, ...entry.keywords].some((word) => word.toLowerCase().includes(wanted));
}
