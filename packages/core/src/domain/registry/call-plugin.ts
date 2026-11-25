/** Admit one immediate plugin operation using the actor's current fleet and send reach. */
import type { CallPluginInput, IdGenerator, PluginCallContext, PluginCallData, ScopeName } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { actorAsItIs, keepingReachRefusal, reaching, rulesInForceOf, shipAsItIs, type CheckReadTx, type NotReachable } from './check-reach.js';
import { allowsReach } from './network-settings.js';
import { effectiveScopes, type ScopeCatalogue } from './effective-scopes.js';
import type { PluginCalls, PluginCallRefusal } from './plugin-calls.js';

type CallPluginTx = CheckReadTx & ScopeCatalogue;

type AdmissionRefusal = { kind: 'PLUGIN_NOT_FOUND'; message: string } | NotReachable;
export type CallPlugin = (caller: Caller, input: CallPluginInput) => Promise<Result<PluginCallData, AdmissionRefusal | PluginCallRefusal>>;
const DISPATCH_LIFETIME_MS = 30_000;

export function createCallPlugin(deps: { uow: UnitOfWork<CallPluginTx>; clock: Clock; ids: IdGenerator; requestId: () => string; transport: PluginCalls }): CallPlugin {
  return async (caller, input) => {
    const authenticatedAt = deps.clock.now();
    const admitted = await keepingReachRefusal(deps.uow, async (tx): Promise<Result<readonly ScopeName[], AdmissionRefusal>> => {
      const plugin = await tx.ships.find(caller.fleetId, input.pluginShipId);
      if (plugin?.kind !== 'plugin' || plugin.retiredAt !== null) {
        return { isOk: false, error: { kind: 'PLUGIN_NOT_FOUND', message: 'Target is not a connected plugin in this fleet' } };
      }
      const settings = await tx.networkSettings.findForShare(caller.fleetId);
      const inForce = await rulesInForceOf(tx, settings);
      const sender = await actorAsItIs(tx, caller);
      const recipient = await shipAsItIs(tx, plugin);
      if (sender && allowsReach(inForce, { verb: 'send', sender: sender.reaching, recipient: reaching(recipient), isAnswerToSender: false })) {
        return ok(await effectiveScopes(tx, caller));
      }
      if (sender) {
        await tx.reachRefusals.record({ id: deps.ids('reachRefusal'), fleetId: caller.fleetId, at: authenticatedAt, sender: sender.refused, askedBy: null, verb: 'send', settingsVersion: settings.version, recipient: { kind: 'ship', ship: { id: plugin.id, name: plugin.name, labels: recipient.labels, owner: recipient.owner } } });
      }
      return { isOk: false, error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' } };
    });
    if (!admitted.isOk) {
      return admitted;
    }
    const credentialEndsAt = caller.kind === 'installation' ? undefined : caller.tokenEndsAt?.getTime();
    const expiresAt = new Date(Math.min(authenticatedAt.getTime() + DISPATCH_LIFETIME_MS, credentialEndsAt ?? Infinity));
    const actor = actorOf(caller);
    // actorOf a Caller never produces system; keep that invariant explicit at the boundary.
    if (actor.kind === 'system') {
      return { isOk: false, error: { kind: 'PLUGIN_REFUSED', code: 'UNAUTHORIZED', message: 'No actor for plugin dispatch' } };
    }
    const context: PluginCallContext = { ...input, requestId: deps.requestId(), fleetId: caller.fleetId, actor, scopes: [...admitted.value], expiresAt: expiresAt.toISOString() };
    return deps.transport.dispatch(context);
  };
}
