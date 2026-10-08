import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { FilterGroup, LabelChip } from '../../lib/labels';
import { MachineLabelsField } from './machine-labels-field';

const values = (key: string, counts: Record<string, number>) => Object.entries(counts).map(([value, shipCount]) => ({ valueId: `lbv_${key}_${value}`, value, shipCount }));

const GROUPS: FilterGroup[] = [
  {
    title: 'On machines',
    keys: [
      { labelId: 'lbl_arch', key: 'arch', mark: 'trierarch-plugin', values: values('arch', { arm64: 2, amd64: 1 }) },
      { labelId: 'lbl_os', key: 'os', mark: 'trierarch-plugin', values: values('os', { macos: 2, linux: 1, windows: 0 }) },
      { labelId: 'lbl_site', key: 'site', mark: 'none', values: values('site', { home: 2, hetzner: 1 }) },
    ],
  },
  { title: 'On no machine yet', keys: [{ labelId: 'lbl_project', key: 'project', mark: 'none', values: values('project', { aeolus: 0, hemma: 0 }) }] },
];

const chip = (key: string, value: string): LabelChip => ({ labelId: `lbl_${key}`, valueId: `lbv_${key}_${value}`, key, value, mark: 'trierarch-plugin', ownerName: 'trierarch-plugin' });

const meta = {
  title: 'Molecules/MachineLabelsField',
  component: MachineLabelsField,
  args: { shipName: 'triage-bot', groups: GROUPS, picked: [], match: { matching: ['trierarch-mac', 'trierarch-macbook', 'trierarch-hetzner'], total: 3 }, onAdd: fn(), onRemove: fn() },
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MachineLabelsField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** None picked: any machine (canvas LbRequest). */
export const AnyMachine: Story = {};
/** One label, and which machines carry it (canvas LbRequestPicking). */
export const One: Story = { args: { picked: [chip('os', 'linux')], match: { matching: ['trierarch-hetzner'], total: 3 } } };
/** Two labels, both carried by two machines (canvas LbRequestTwo). */
export const Two: Story = { args: { picked: [chip('os', 'macos'), chip('arch', 'arm64')], match: { matching: ['trierarch-mac', 'trierarch-macbook'], total: 3 } } };
/** No machine carries both: the request still goes, and waits (canvas LbRequestNoMatch). */
export const NoMatch: Story = { args: { picked: [chip('os', 'linux'), chip('arch', 'arm64')], match: { matching: [], total: 3 } } };
/** While the request is being sent: no ×, and Add label is off. */
export const Disabled: Story = { args: { picked: [chip('os', 'macos')], match: { matching: ['trierarch-mac', 'trierarch-macbook'], total: 3 }, isDisabled: true } };
/** A squadron file names labels the fleet does not have: warnings, removable, and forming refuses them (#343). */
export const UnknownFromFiles: Story = { args: { picked: [chip('os', 'linux')], match: { matching: ['trierarch-hetzner'], total: 3 }, unknown: ['site=home'], onRemoveUnknown: fn() } };
