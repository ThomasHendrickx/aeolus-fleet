import { accountIdSchema, idSchema, inboxFilterSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { readAccountName, readAccountNames } from './account-name-read';
import { readAppsList } from './apps-list-read';
import { consoleRead } from './console-read';
import { parseCrewSettings } from './crew-settings-read';
import { readGatewayConnection } from './gateway-reads';
import { readInbox, readInboxEntry, readThread } from './inbox-reads';
import { listRepositories, listSquadrons, readBlueprintCrew, readCatalogue, readKeptMessages, readSquadronsConnection } from './squadrons-reads';
import { checkCrewSettings, listEnabledModels, listMachines, readTrierarchPluginConnection, readTrierarchPluginVersion, readUsageTokens, readUsageValues, readUsageWindows } from './trierarch-plugin-reads';
import { usageTokensRequestSchema, usageValuesRequestSchema, usageWindowsRequestSchema } from './trierarch-plugin-schemas';

/**
 * Every console read by name, as /api/reads/<name> answers it
 * (lib/console-read.ts) and the browser asks it (lib/fetch-console-read.ts).
 * What changes something stays a server function.
 */

/** The most accounts one read names: a ship's timeline shows at most 200 events, each naming at most one. */
const ACCOUNT_NAMES_MAX = 200;

const blueprintSchema = z.object({ repository: z.string(), name: z.string(), version: z.number() });

export const CONSOLE_READS = {
  'squadrons-connection': consoleRead(z.undefined(), readSquadronsConnection),
  squadrons: consoleRead(z.undefined(), listSquadrons),
  'kept-messages': consoleRead(z.object({ squadronId: z.string() }), ({ squadronId }) => readKeptMessages(squadronId)),
  catalogue: consoleRead(z.undefined(), readCatalogue),
  'blueprint-crew': consoleRead(blueprintSchema, readBlueprintCrew),
  repositories: consoleRead(z.undefined(), listRepositories),
  'gateway-connection': consoleRead(z.undefined(), readGatewayConnection),
  'trierarch-plugin-connection': consoleRead(z.undefined(), readTrierarchPluginConnection),
  'trierarch-plugin-version': consoleRead(z.undefined(), async () => ({ kind: 'answered', data: (await readTrierarchPluginVersion()) ?? null })),
  machines: consoleRead(z.undefined(), listMachines),
  'enabled-models': consoleRead(z.undefined(), listEnabledModels),
  'usage-tokens': consoleRead(usageTokensRequestSchema, readUsageTokens),
  'usage-values': consoleRead(usageValuesRequestSchema, readUsageValues),
  'usage-windows': consoleRead(usageWindowsRequestSchema, readUsageWindows),
  inbox: consoleRead(z.object({ filter: inboxFilterSchema, size: z.int().positive() }), readInbox),
  'inbox-entry': consoleRead(z.object({ deliveryId: idSchema('delivery') }), ({ deliveryId }) => readInboxEntry(deliveryId)),
  'inbox-thread': consoleRead(z.object({ messageId: idSchema('message') }), ({ messageId }) => readThread(messageId)),
  'crew-settings-check': consoleRead(z.object({ settings: z.unknown() }), ({ settings }) => checkCrewSettings(settings)),
  'account-name': consoleRead(z.undefined(), readAccountName),
  'apps-list': consoleRead(z.undefined(), readAppsList),
  'account-names': consoleRead(z.object({ accountIds: z.array(accountIdSchema).max(ACCOUNT_NAMES_MAX) }), ({ accountIds }) => readAccountNames(accountIds)),
  'crew-settings': consoleRead(z.object({ settings: z.array(z.unknown()) }), async ({ settings }) => ({ kind: 'answered', data: await parseCrewSettings(settings) })),
};
