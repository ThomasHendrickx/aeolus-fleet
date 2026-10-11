import { LABEL_VALUES_MAX, type LabelId, type LabelValueId, type NetworkRule, type ShipId } from '@aeolus-fleet/common';

import type { LabelledShip, ListedLabel, NetworkDoor } from '../../src/core/network/ports.js';
import { err, ok } from '../../src/core/shared/result.js';
import { SHIP_ID } from './management-fakes.js';

/** The ship that owns labels squadrons does not: another plugin, or argo. */
export const OTHER_OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h9z';

/**
 * A fleet's labels and network rules as squadrons' management ship reaches
 * them: labels with their owners, the values each ship carries, and each list
 * of rules it declared. Its crew tokens work while they are live (share the
 * management fake's set), and it refuses what the fleet refuses: a key taken,
 * a carried value removed, more than 50 values, a value of a label it does
 * not own.
 */
export function fakeNetworkFleet(liveTokens: Set<string>) {
  const state = {
    isAnswering: true,
    liveTokens,
    labels: new Array<ListedLabel>(),
    /** The fleet's ships that are not retired, with the values they carry. */
    ships: new Array<LabelledShip>(),
    /** Label writes squadrons made, in order, as `define`, `values`, `assign` and `unassign` lines. */
    labelWrites: new Array<string>(),
    /** Each list of network rules squadrons declared, in order; an empty one withdraws them. */
    declarations: new Array<NetworkRule[]>(),
  };
  let next = 0;
  const labelId = (): LabelId => `lbl_01m3tbfspe96yf1rnr4ank9${String(next++).padStart(3, '0')}`;
  const valueId = (): LabelValueId => `lbv_01m3tbfspe96yf1rnr4ank9${String(next++).padStart(3, '0')}`;
  const unavailable = () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  const released = () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }));
  const refusalOf = (crewToken: string) => (!state.isAnswering ? unavailable() : !state.liveTokens.has(crewToken) ? released() : undefined);
  const textOf = (picked: LabelValueId): string => {
    const label = state.labels.find((each) => each.values.some((value) => value.valueId === picked));
    return `${label?.key ?? '?'}=${label?.values.find((value) => value.valueId === picked)?.value ?? '?'}`;
  };
  const ownedValue = (picked: LabelValueId) => state.labels.find((each) => each.ownerShipId === SHIP_ID && each.values.some((value) => value.valueId === picked));

  const door: NetworkDoor = {
    listLabels: (crewToken) => refusalOf(crewToken) ?? Promise.resolve(ok(state.labels.map((label) => ({ ...label, values: label.values.map((value) => ({ ...value })) })))),
    defineLabel: (crewToken, { key, values }) => {
      const refused = refusalOf(crewToken);
      if (refused) {
        return refused;
      }
      if (state.labels.some((label) => label.key === key)) {
        return Promise.resolve(err({ code: 'CONFLICT', message: `The fleet has the label ${key} already` }));
      }
      const label = { labelId: labelId(), key, values: values.map((value) => ({ valueId: valueId(), value })), ownerShipId: SHIP_ID };
      state.labels.push(label);
      state.labelWrites.push(`define ${key}=${values.join(',')}`);
      return Promise.resolve(ok({ labelId: label.labelId, values: label.values.map((value) => ({ ...value })) }));
    },
    changeLabelValues: (crewToken, { labelId: changed, values }) => {
      const refused = refusalOf(crewToken);
      if (refused) {
        return refused;
      }
      const label = state.labels.find((each) => each.labelId === changed);
      if (label?.ownerShipId !== SHIP_ID) {
        return Promise.resolve(err({ code: 'NOT_FOUND', message: 'No such label of yours' }));
      }
      if (values.length > LABEL_VALUES_MAX) {
        return Promise.resolve(err({ code: 'BAD_REQUEST', message: `At most ${String(LABEL_VALUES_MAX)} values` }));
      }
      const removed = label.values.filter((value) => !values.includes(value.value));
      if (removed.some((value) => state.ships.some((ship) => ship.labels.some((each) => each.valueId === value.valueId)))) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'A ship carries a value removed' }));
      }
      label.values = values.map((value) => label.values.find((each) => each.value === value) ?? { valueId: valueId(), value });
      state.labelWrites.push(`values ${label.key}=${values.join(',')}`);
      return Promise.resolve(ok({ values: label.values.map((value) => ({ ...value })) }));
    },
    listLabelledShips: (crewToken) => refusalOf(crewToken) ?? Promise.resolve(ok(state.ships.map((ship) => ({ ...ship, labels: ship.labels.map((each) => ({ ...each })) })))),
    assignLabel: (crewToken, { shipId, valueId: picked }) => {
      const refused = refusalOf(crewToken);
      if (refused) {
        return refused;
      }
      const ship = state.ships.find((each) => each.shipId === shipId);
      const label = ownedValue(picked);
      if (ship === undefined || label === undefined) {
        return Promise.resolve(err({ code: 'NOT_FOUND', message: 'No such ship or label value' }));
      }
      if (!ship.labels.some((each) => each.valueId === picked)) {
        ship.labels = [...ship.labels, { labelId: label.labelId, valueId: picked }];
      }
      state.labelWrites.push(`assign ${ship.shipId} ${textOf(picked)}`);
      return Promise.resolve(ok(undefined));
    },
    unassignLabel: (crewToken, { shipId, valueId: dropped }) => {
      const refused = refusalOf(crewToken);
      if (refused) {
        return refused;
      }
      const ship = state.ships.find((each) => each.shipId === shipId);
      if (ship === undefined || ownedValue(dropped) === undefined) {
        return Promise.resolve(err({ code: 'NOT_FOUND', message: 'No such ship or label value' }));
      }
      ship.labels = ship.labels.filter((each) => each.valueId !== dropped);
      state.labelWrites.push(`unassign ${ship.shipId} ${textOf(dropped)}`);
      return Promise.resolve(ok(undefined));
    },
    declareNetworkRules: (crewToken, { rules }) => {
      const refused = refusalOf(crewToken);
      if (refused) {
        return refused;
      }
      state.declarations.push(rules.map((rule) => ({ from: [...rule.from], to: [...rule.to] })));
      return Promise.resolve(ok({ rules: rules.length }));
    },
  };
  return { state, door };
}
