import { idSchema, SHIP_LABELS_MAX, type ListedShip } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { assignKeysOf, chipsOf, labelLimitOf } from '../../lib/labels';
import { ShipLabelsEdit } from './ship-labels-edit';
import { AREA, BLUEPRINT, carried, COST, labelContext, labelledFleet, OS, PROJECT } from './labels.fixtures';

const FLEET = labelledFleet();
const CONTEXT = labelContext(FLEET);

function argsFor(labels: ListedShip['labels']) {
  const ship = { labels };
  return { chips: chipsOf(ship, CONTEXT), keys: assignKeysOf(ship, CONTEXT), limit: labelLimitOf(ship, SHIP_LABELS_MAX) };
}

const DIGITS = '0123456789abcdefghjkmnpqrstvwxyz';

/** Twenty label values on one ship, each its own (the limit counts value ids). */
const TWENTY: ListedShip['labels'] = Array.from({ length: 20 }, (_, index) => ({
  labelId: PROJECT.id,
  key: `topic-${String(index + 1)}`,
  valueId: idSchema('labelValue').parse(`lbv_01m3tbfspe96yf1rnr4anktq${DIGITS.charAt(Math.floor(index / 32))}${DIGITS.charAt(index % 32)}`),
  value: 'on',
}));

const meta = {
  title: 'Organisms/ShipLabelsEdit',
  component: ShipLabelsEdit,
  args: { ...argsFor([carried(PROJECT, 'hemma'), carried(AREA, 'backend'), carried(BLUEPRINT, 'hemma-feature')]), onAssign: fn(), onUnassign: fn(), onChange: fn() },
} satisfies Meta<typeof ShipLabelsEdit>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Yours, each a menu to change or remove (canvas LbShipFew, LbShipChange), then "+1", and Add label (canvas LbShipAddKey). */
export const Few: Story = {};
/** Yours and others' all shown: squadrons' after "by squadrons" (canvas LbShipExpanded). */
export const Two: Story = { args: argsFor([carried(PROJECT, 'hemma'), carried(OS, 'linux')]) };
/** No labels yet: Add label offers yours (canvas LbShipNone). */
export const None: Story = { args: argsFor([]) };
/** A key carried twice: point 13 lets a ship carry several values of one key. */
export const SeveralOfOneKey: Story = { args: argsFor([carried(PROJECT, 'hemma'), carried(PROJECT, 'aeolus'), carried(COST, 'low')]) };
/** At the limit (canvas LbShipLimit): no Add label, the limit named, "20 of 20". */
export const AtLimit: Story = { args: argsFor(TWENTY) };
/** Refused (canvas LbShipRefused): what and why, nothing changed. */
export const Refused: Story = {
  args: { ...argsFor(TWENTY.slice(0, 19)), error: { title: 'Couldn’t add cost=high', message: 'hemma-api carries 20 labels, the most a ship carries (decision 0031)' } },
};
/** While a change is on its way. */
export const Busy: Story = { args: { isBusy: true } };
/** argo owns no labels yet: Add label says so and links to Define a label. */
export const NoKeysOfYours: Story = { args: { ...argsFor([carried(OS, 'macos')]), keys: [] } };
