import type { LabelId, LabelValueId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetListing } from './ports.js';

export type FindLabelValue = (
  caller: Caller,
  input: { key: string; value: string },
) => Promise<Result<{ labelId: LabelId; valueId: LabelValueId }, DomainError<'LABEL_VALUE_NOT_FOUND'>>>;

/**
 * Use case: the ids of a label and one of its values, by the texts people
 * write, so a caller that knows `os=macos` can assign and select by id
 * (decision 0031). Keys and values are lowercase, so both texts are
 * lowercased, then matched exactly. The caller's scope (fleet:read) is
 * checked before this runs.
 */
export function createFindLabelValue(deps: { listing: Pick<FleetListing, 'labels'> }): FindLabelValue {
  return async (caller, input) => {
    const key = input.key.toLowerCase();
    const value = input.value.toLowerCase();
    const label = (await deps.listing.labels(caller.fleetId)).find((listed) => listed.key === key);
    const found = label?.values.find((held) => held.value === value);
    return label && found ? ok({ labelId: label.id, valueId: found.id }) : refuse('LABEL_VALUE_NOT_FOUND', `The fleet has no label value ${input.key}=${input.value}`);
  };
}
