import { crewSettingsSchema, type CrewSettings } from '@aeolus-fleet/common';

/**
 * A crew request's settings as the console reads them (decisions 0027,
 * 0029, 0033): the fleet stores them without meaning, so the web app's server
 * parses them (a console read, lib/console-reads.ts), and the browser gets
 * crew settings, or null for settings that are none (a request made without
 * the trierarch plugin).
 */
export async function parseCrewSettings(settings: readonly unknown[]): Promise<(CrewSettings | null)[]> {
  return Promise.resolve(settings.map((each) => crewSettingsSchema.safeParse(each).data ?? null));
}
