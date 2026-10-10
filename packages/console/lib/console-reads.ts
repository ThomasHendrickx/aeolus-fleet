import { z } from 'zod';

import { consoleRead } from './console-read';
import { parseCrewSettings } from './crew-settings-read';
import { readNetwork, readNetworkingPluginConnection } from './networking-plugin-reads';
import { listRepositories, listSquadrons, readBlueprintCrew, readCatalogue, readKeptMessages, readSquadronsConnection } from './squadrons-reads';
import { checkCrewSettings, listMachines, readTrierarchPluginConnection, readTrierarchPluginVersion } from './trierarch-plugin-reads';

/**
 * Every console read by name, as /api/reads/<name> answers it
 * (lib/console-read.ts) and the browser asks it (lib/fetch-console-read.ts).
 * What changes something stays a server function.
 */

const blueprintSchema = z.object({ repository: z.string(), name: z.string(), version: z.number() });

export const CONSOLE_READS = {
  'squadrons-connection': consoleRead(z.undefined(), readSquadronsConnection),
  squadrons: consoleRead(z.undefined(), listSquadrons),
  'kept-messages': consoleRead(z.object({ squadronId: z.string() }), ({ squadronId }) => readKeptMessages(squadronId)),
  catalogue: consoleRead(z.undefined(), readCatalogue),
  'blueprint-crew': consoleRead(blueprintSchema, readBlueprintCrew),
  repositories: consoleRead(z.undefined(), listRepositories),
  'networking-plugin-connection': consoleRead(z.undefined(), readNetworkingPluginConnection),
  network: consoleRead(z.undefined(), readNetwork),
  'trierarch-plugin-connection': consoleRead(z.undefined(), readTrierarchPluginConnection),
  'trierarch-plugin-version': consoleRead(z.undefined(), async () => ({ kind: 'answered', data: (await readTrierarchPluginVersion()) ?? null })),
  machines: consoleRead(z.undefined(), listMachines),
  'crew-settings-check': consoleRead(z.object({ settings: z.unknown() }), ({ settings }) => checkCrewSettings(settings)),
  'crew-settings': consoleRead(z.object({ settings: z.array(z.unknown()) }), async ({ settings }) => ({ kind: 'answered', data: await parseCrewSettings(settings) })),
};
