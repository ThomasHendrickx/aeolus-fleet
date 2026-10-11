/**
 * The fleet's label and network rule calls over its REST API (`/api/v1`), as
 * squadrons makes them for its management ship (decisions 0031, 0037). A
 * refusal reads as the fleet's code and message; a busy fleet is asked again,
 * as the fleet door does.
 */
import { changeLabelValuesOutputSchema, declareNetworkRulesOutputSchema, defineLabelOutputSchema, fleetListOutputSchema, labelsOutputSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { NetworkDoor } from '../../core/network/ports.js';
import { ok } from '../../core/shared/result.js';
import { call, type DoorOptions, restDoor } from './rest-fleet-door.js';

export function createRestNetworkDoor(fleetUrl: string, options: DoorOptions = {}): NetworkDoor {
  const door = restDoor(fleetUrl, options);
  return {
    listLabels: async (crewToken) => {
      const listed = await call(door, { path: '/fleet/labels', method: 'GET', crewToken, answers: labelsOutputSchema });
      return listed.isOk
        ? ok(listed.value.map(({ id, key, values, owner }) => ({ labelId: id, key, values: values.map((value) => ({ valueId: value.id, value: value.value })), ownerShipId: owner.id })))
        : listed;
    },
    defineLabel: async (crewToken, label) => {
      const defined = await call(door, { path: '/fleet/defineLabel', method: 'POST', crewToken, body: label, answers: defineLabelOutputSchema });
      return defined.isOk ? ok({ labelId: defined.value.labelId, values: defined.value.values.map((value) => ({ valueId: value.id, value: value.value })) }) : defined;
    },
    changeLabelValues: async (crewToken, change) => {
      const changed = await call(door, { path: '/fleet/changeLabelValues', method: 'POST', crewToken, body: change, answers: changeLabelValuesOutputSchema });
      return changed.isOk ? ok({ values: changed.value.values.map((value) => ({ valueId: value.id, value: value.value })) }) : changed;
    },
    listLabelledShips: async (crewToken) => {
      const listed = await call(door, { path: '/fleet/list', method: 'POST', crewToken, body: {}, answers: fleetListOutputSchema });
      return listed.isOk
        ? ok(listed.value.filter((ship) => ship.status !== 'retired').map(({ id, labels }) => ({ shipId: id, labels: labels.map(({ labelId, valueId }) => ({ labelId, valueId })) })))
        : listed;
    },
    assignLabel: async (crewToken, assignment) => {
      const assigned = await call(door, { path: '/fleet/assignLabel', method: 'POST', crewToken, body: assignment, answers: z.unknown() });
      return assigned.isOk ? ok(undefined) : assigned;
    },
    unassignLabel: async (crewToken, assignment) => {
      const unassigned = await call(door, { path: '/fleet/unassignLabel', method: 'POST', crewToken, body: assignment, answers: z.unknown() });
      return unassigned.isOk ? ok(undefined) : unassigned;
    },
    declareNetworkRules: (crewToken, declaration) =>
      call(door, { path: '/fleet/declareNetworkRules', method: 'POST', crewToken, body: declaration, answers: declareNetworkRulesOutputSchema }),
  };
}
