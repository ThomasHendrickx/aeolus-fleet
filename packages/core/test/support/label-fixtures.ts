import type { LabelId, LabelValueId } from '@aeolus-fleet/common';

import type { InMemoryCore } from './in-memory.js';

/** The id of the fleet's label with this key, as the state holds it. */
export function labelIdOf(core: InMemoryCore, key: string): LabelId {
  const label = core.state.labels.find((held) => held.key === key);
  if (!label) {
    throw new Error(`no label ${key} in the state`);
  }
  return label.id;
}

/** The id of the value of the fleet's label with this key, as the state holds it. */
export function valueIdOf(core: InMemoryCore, { key, value }: { key: string; value: string }): LabelValueId {
  const found = core.state.labels.find((held) => held.key === key)?.values.find((held) => held.value === value);
  if (!found) {
    throw new Error(`no value ${value} of the label ${key} in the state`);
  }
  return found.id;
}

/** What a ship carries, as key=value text, by key then value. */
export function carriedText(core: InMemoryCore, shipId: string): string[] {
  return core.state.shipLabels
    .filter((carried) => carried.shipId === shipId)
    .map((carried) => {
      const label = core.state.labels.find((held) => held.id === carried.labelId);
      return `${label?.key ?? '?'}=${label?.values.find((held) => held.id === carried.valueId)?.value ?? '?'}`;
    })
    .sort();
}
