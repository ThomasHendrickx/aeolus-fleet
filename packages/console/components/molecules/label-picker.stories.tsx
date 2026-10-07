import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import type { FilterGroup } from '../../lib/labels';
import { LabelPicker } from './label-picker';

const values = (key: string, counts: Record<string, number>) => Object.entries(counts).map(([value, shipCount]) => ({ valueId: `lbv_${key}_${value}`, value, shipCount }));

const GROUPS: FilterGroup[] = [
  {
    title: 'Yours',
    keys: [
      { labelId: 'lbl_area', key: 'area', mark: 'none', values: values('area', { backend: 4, infra: 2, review: 2, docs: 1, frontend: 1 }) },
      { labelId: 'lbl_cost', key: 'cost', mark: 'none', values: values('cost', { low: 1, high: 0 }) },
      { labelId: 'lbl_project', key: 'project', mark: 'none', values: values('project', { aeolus: 7, hemma: 4, website: 1, personal: 0 }) },
    ],
  },
  { title: 'By squadrons', keys: [{ labelId: 'lbl_blueprint', key: 'blueprint', mark: 'squadrons', values: values('blueprint', { 'hemma-feature': 3, 'aeolus-review': 1 }) }] },
  { title: 'By trierarch-plugin', keys: [{ labelId: 'lbl_os', key: 'os', mark: 'trierarch-plugin', values: values('os', { macos: 5, linux: 4 }) }] },
];

const meta = {
  title: 'Molecules/LabelPicker',
  component: LabelPicker,
  args: { groups: GROUPS, pickedValueIds: [], onPick: fn() },
  decorators: [
    (Story) => (
      <div className="w-80 rounded-xl border border-border bg-popover p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LabelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The keys, yours first, then by owner, each with how many values it has. Pick one to see its values. */
export const Keys: Story = {};
/** A value already picked shows as picked when its key opens. */
export const WithPicked: Story = { args: { pickedValueIds: ['lbv_project_hemma'] } };
/** The fleet has no labels yet. */
export const NoLabels: Story = { args: { groups: [] } };
/** On phone, in the filters Sheet: touch-sized rows. */
export const Touch: Story = { args: { size: 'touch' }, globals: { viewport: { value: 'mobile1' } } };
