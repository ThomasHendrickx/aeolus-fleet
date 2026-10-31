import type { FleetId } from '../ids/index.js';
import type { AppsList, HeaderApp } from '../schemas/apps-list.js';

/*
 * What the switcher in the title offers (header design H1, H8, H9): the fleets
 * of the account and the apps of the fleet in view, from the list pagasae
 * answers. Without a list (argo's sign-in, the viewer, self-hosted) it offers
 * the fleet in view and the app open alone, and switches nothing. Every app
 * takes the fleet in view from its address, `?fleet=<fleet id>`; Account
 * and Admin stand outside any fleet.
 */

/** How the header names each app. */
export const APP_LABELS: Record<HeaderApp, string> = { console: 'Console', gateway: 'Gateway', account: 'Account', admin: 'Admin' };

/** Where an app of a fleet opens for that fleet. */
function inFleet(url: string, fleetId: FleetId): string {
  const address = new URL(url);
  address.searchParams.set('fleet', fleetId);
  return address.toString();
}

/** A fleet the switcher offers, and where choosing it goes. */
export interface SwitcherFleet {
  id: FleetId;
  name: string;
  url: string;
  isCurrent: boolean;
}

/** An app the switcher offers, and where it opens. */
export interface SwitcherApp {
  app: HeaderApp;
  label: string;
  url: string;
  isCurrent: boolean;
}

export interface AppSwitcherModel {
  fleet: { id: FleetId; name: string };
  appLabel: string;
  fleets: SwitcherFleet[];
  apps: SwitcherApp[];
  /** Whether there is anywhere else to go: a second fleet or a second app. */
  canSwitch: boolean;
}

/**
 * The switcher for the app open in the fleet in view. Choosing another fleet
 * opens the same app there when the account may open it, else the first app
 * it may open there, else Account (H9).
 */
export function appSwitcherOf(input: { list: AppsList | undefined; fleet: { id: FleetId; name: string }; app: HeaderApp }): AppSwitcherModel {
  const { list, fleet, app } = input;
  const appLabel = APP_LABELS[app];
  if (list === undefined) {
    return { fleet, appLabel, fleets: [{ ...fleet, url: '', isCurrent: true }], apps: [{ app, label: appLabel, url: '', isCurrent: true }], canSwitch: false };
  }
  const accountUrl = list.apps.find((link) => link.app === 'account')?.url;
  // A fleet with no app to open and no Account to go to instead has nowhere to link: it is left out, never a link to nowhere.
  const fleets = list.fleets.flatMap((listed) => {
    const opened = listed.apps.find((link) => link.app === app) ?? listed.apps[0];
    const url = opened === undefined ? accountUrl : inFleet(opened.url, listed.id);
    return url === undefined ? [] : [{ id: listed.id, name: listed.name, url, isCurrent: listed.id === fleet.id }];
  });
  const inView = (list.fleets.find((listed) => listed.id === fleet.id)?.apps ?? []).map((link) => ({ ...link, url: inFleet(link.url, fleet.id) }));
  const apps = [...inView, ...list.apps].map((link) => ({ app: link.app, label: APP_LABELS[link.app], url: link.url, isCurrent: link.app === app }));
  return { fleet, appLabel, fleets, apps, canSwitch: fleets.length > 1 || apps.length > 1 };
}
