import type { FleetId, LabelValueId } from '@aeolus-fleet/common';

import type { HistoryLabelValue } from '../shared/history.js';
import type { LabelRepository } from './ports.js';

/** The ports naming label values reads, inside the caller's unit of work. */
export interface LabelValueTextsTx {
  labels: Pick<LabelRepository, 'listNamedBy'>;
}

/**
 * Each of these label values by its key and value texts, in the order given,
 * each once, read in one query (decision 0065, R10). A value its label no
 * longer has keeps its id, its texts null.
 */
export async function labelValueTexts(tx: LabelValueTextsTx, input: { fleetId: FleetId; valueIds: readonly LabelValueId[] }): Promise<HistoryLabelValue[]> {
  const valueIds = [...new Set(input.valueIds)];
  if (valueIds.length === 0) {
    return [];
  }
  const labels = await tx.labels.listNamedBy(input.fleetId, { labelIds: [], valueIds });
  const texts = new Map(labels.flatMap((label) => label.values.map((value) => [value.id, { key: label.key, value: value.value }] as const)));
  return valueIds.map((valueId) => ({ valueId, key: null, value: null, ...texts.get(valueId) }));
}
