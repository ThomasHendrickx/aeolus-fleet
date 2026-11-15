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

/** The apps the account may open from the fleet in view, with where each opens: the fleet's own apps in it, then those outside any fleet. */
function openableAppsOf(list: AppsList, fleetId: FleetId): { app: HeaderApp; url: URL }[] {
  const inFleet = (list.fleets.find((fleet) => fleet.id === fleetId)?.apps ?? []).map((link) => {
    const url = new URL(link.url);
    url.searchParams.set('fleet', fleetId);
    return { app: link.app, url };
  });
  return [...inFleet, ...list.apps.map((link) => ({ app: link.app, url: new URL(link.url) }))];
}

/** Where an entry's path opens in its app, keeping the app's fleet. */
function hrefOf(appUrl: URL, path: string): string {
  const url = new URL(path, appUrl);
  for (const [name, value] of appUrl.searchParams) {
    if (!url.searchParams.has(name)) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

/**
 * The other apps' groups for the open app: one per app the account may open,
 * in the header's order, from its list; an app whose list could not be read
 * shows by its name alone. Nothing without an apps list (argo's sign-in, the
 * viewer, self-hosted).
 */
export function otherAppsPaletteOf(input: { list: AppsList | undefined; fleetId: FleetId; openApp: HeaderApp; paletteLists: readonly PaletteList[] }): AppPaletteGroup[] {
  const { list, fleetId, openApp, paletteLists } = input;
  if (list === undefined) {
    return [];
  }
  return openableAppsOf(list, fleetId)
    .filter(({ app }) => app !== openApp)
    .map(({ app, url }): AppPaletteGroup => {
      const label = APP_LABELS[app];
      const paletteList = paletteLists.find((held) => held.app === app);
      if (paletteList === undefined) {
        return { app, label, entries: [{ key: `${app}:app`, label, keywords: [], icon: 'app', href: url.toString() }] };
      }
      return {
        app,
        label,
        entries: paletteList.entries.map((entry) => {
          const shown = { key: `${app}:${entry.key}`, label: entry.label, keywords: entry.keywords, icon: entry.icon };
          return entry.kind === 'copy' ? { ...shown, copyText: entry.value } : { ...shown, href: hrefOf(url, entry.path) };
        }),
      };
    });
}

/** Whether an entry matches what is typed: its label or a keyword holds it, in any case. */
export function paletteEntryMatches(entry: { label: string; keywords: readonly string[] }, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return [entry.label, ...entry.keywords].some((word) => word.toLowerCase().includes(wanted));
}
