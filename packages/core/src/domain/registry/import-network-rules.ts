import type { IdGenerator, ImportNetworkRulesInput, ShipId } from '@aeolus-fleet/common';

import { actorOf, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type Actor, type EventLog, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkManage, keepingReachRefusal, type CheckManageTx, type NotReachable } from './check-reach.js';
import { fleetAsTheFileSeesIt } from './check-network-rules-file.js';
import { defineLabel, type DefineLabelRefusal, type Label } from './label.js';
import { saveNetworkRulesDraft } from './network-rules-draft.js';
import { differencesOf, readNetworkRulesFile, resolvedRules, rulesByIds, type InvalidNetworkRulesFile, type LabelDifferences } from './network-rules-file.js';
import type { InvalidNetworkRules } from './network-settings.js';
import type { LabelRepository, NetworkRulesDraftRepository, NetworkSettingsRepository, ShipRepository } from './ports.js';

export interface ImportNetworkRulesTx extends Omit<CheckManageTx, 'ships' | 'labels' | 'networkSettings'> {
  ships: Pick<ShipRepository, 'find' | 'findActiveByName' | 'findForShare' | 'findOperatorShip'>;
  labels: Pick<LabelRepository, 'carriedBy' | 'find' | 'findByKey' | 'lockKey' | 'save'>;
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  networkRulesDrafts: Pick<NetworkRulesDraftRepository, 'save'>;
  events: EventLog;
}

export type ImportNetworkRulesRefusal = InvalidNetworkRulesFile | LabelDifferences | InvalidNetworkRules | DefineLabelRefusal | NotReachable | DomainError<'SHIP_NOT_FOUND'>;

export type ImportNetworkRules = (caller: Caller, input: ImportNetworkRulesInput) => Promise<Result<{ savedAgainstVersion: number; definedLabels: string[] }, ImportNetworkRulesRefusal>>;

/**
 * Use case: any actor holding fleet:network and labels:define imports a
 * network rules file (design network-io, section 5, step 4), the scopes
 * checked before this runs. In one unit of work, holding every key's lock,
 * so the fleet is checked again as it is: the definer is argo or an active
 * ship within the caller's manage reach (Q10), checked first so a refusal
 * keeps only its record; every difference must have a resolution it offers,
 * else nothing is written; the labels the fleet lacks are defined for the
 * definer, each with LabelDefined; the rules, by ids, are the draft, with
 * NetworkRulesDraftSaved. Nothing is applied: apply does that (Q11).
 */
export function createImportNetworkRules(deps: { uow: UnitOfWork<ImportNetworkRulesTx>; clock: Clock; ids: IdGenerator }): ImportNetworkRules {
  return (caller, input) =>
    keepingReachRefusal(deps.uow, async (tx): Promise<Result<{ savedAgainstVersion: number; definedLabels: string[] }, ImportNetworkRulesRefusal>> => {
      const { fleetId } = caller;
      const read = readNetworkRulesFile(input.file);
      if (!read.isOk) {
        return read;
      }
      const file = read.value;
      const at = deps.clock.now();
      const actor = actorOf(caller);
      const definer = input.definerShipId === undefined ? await tx.ships.findOperatorShip(fleetId) : await tx.ships.findForShare(fleetId, input.definerShipId);
      if (definer?.retiredAt !== null) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.definerShipId ?? 'argo'} is no active ship to define the labels`);
      }
      if (definer.kind !== 'operator') {
        const managed = await checkManage({ tx, ids: deps.ids }, { manager: caller, shipId: definer.id, at });
        if (!managed.isOk) {
          return managed;
        }
      }
      // In key order, so two imports naming the same keys never wait on each other.
      for (const key of file.labels.map((label) => label.key).sort()) {
        await tx.labels.lockKey(fleetId, key);
      }
      const fleet = await fleetAsTheFileSeesIt(tx, { fleetId, file });
      const { newLabels, differences } = differencesOf(file, fleet);
      const resolved = resolvedRules(file, { differences, resolutions: input.resolutions });
      if (!resolved.isOk) {
        return resolved;
      }
      const ships = new Map(fleet.ships);
      for (const resolution of input.resolutions) {
        if (resolution.kind === 'ship' && resolution.way === 'pickShip' && differences.some((difference) => difference.kind === 'ship' && difference.name === resolution.name)) {
          const picked = await tx.ships.find(fleetId, resolution.shipId);
          if (picked?.retiredAt !== null) {
            return refuse('SHIP_NOT_FOUND', `Ship ${resolution.shipId}, picked for ${resolution.name}, is no active ship`);
          }
          ships.set(resolution.name, picked.id);
        }
      }
      const defined = defineNewLabels({ ids: deps.ids }, { file, newLabels, definer: definer.id, fleetId, at, actor });
      if (!defined.isOk) {
        return defined;
      }
      const rules = resolved.value === null ? null : rulesByIds(resolved.value, { labels: [...fleet.found, ...defined.value.labels], ships });
      if (rules !== null && !rules.isOk) {
        return rules;
      }
      const settings = await tx.networkSettings.findForShare(fleetId);
      const saved = saveNetworkRulesDraft(settings, { rules: rules === null ? null : rules.value, at, actor });
      if (!saved.isOk) {
        return saved;
      }
      for (const label of defined.value.labels) {
        await tx.labels.save(label);
      }
      await tx.networkRulesDrafts.save(saved.value.draft);
      for (const event of [...defined.value.events, ...saved.value.events]) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ savedAgainstVersion: saved.value.draft.savedAgainstVersion, definedLabels: newLabels });
    });
}

/** Each label the fleet lacks, as the file gives it, defined for the definer (Q6), with its LabelDefined. */
function defineNewLabels(
  deps: { ids: IdGenerator },
  define: { file: { labels: readonly { key: string; values: readonly string[] }[] }; newLabels: readonly string[]; definer: ShipId; fleetId: Label['fleetId']; at: Date; actor: Actor },
): Result<{ labels: Label[]; events: NewEvent[] }, DefineLabelRefusal> {
  const labels: Label[] = [];
  const events: NewEvent[] = [];
  for (const label of define.file.labels.filter(({ key }) => define.newLabels.includes(key))) {
    const defined = defineLabel(
      { fleetId: define.fleetId, owner: { kind: 'ship', shipId: define.definer }, existing: undefined },
      { id: deps.ids('label'), key: label.key, values: label.values.map((value) => ({ value, newId: deps.ids('labelValue') })), at: define.at, actor: define.actor },
    );
    if (!defined.isOk) {
      return defined;
    }
    labels.push(defined.value.label);
    events.push(...defined.value.events);
  }
  return ok({ labels, events });
}
