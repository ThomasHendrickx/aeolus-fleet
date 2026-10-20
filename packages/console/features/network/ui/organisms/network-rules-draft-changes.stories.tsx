import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import type { VerbChanges } from '../../services/draft-changes';
import { NetworkRulesDraftChanges } from './network-rules-draft-changes';

const CHANGES: VerbChanges[] = [
  {
    verb: 'send',
    gained: [
      { key: 'planner>vault', from: 'planner', to: 'vault', rule: 'Rule 1' },
      { key: 'scout>vault', from: 'scout', to: 'vault', rule: 'Rule 1' },
    ],
    lost: [{ key: 'planner>scout', from: 'planner', to: 'scout', rule: 'Built-in: Open' }],
  },
  { verb: 'read', gained: [], lost: [{ key: 'scout>planner', from: 'scout', to: 'planner', rule: 'Declared by squadrons, rule 2' }] },
  { verb: 'manage', gained: [], lost: [] },
];

const meta = {
  title: 'Organisms/NetworkRulesDraftChanges',
  component: NetworkRulesDraftChanges,
  args: { changes: CHANGES },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NetworkRulesDraftChanges>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Gains and losses per verb, each pair with its rule; a verb without a change is left out. */
export const Changes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('network-draft-changes-verb')).toHaveLength(2);
    await expect(canvas.getAllByTestId('network-draft-gained').map((row) => row.textContent)).toEqual(['plannervaultRule 1', 'scoutvaultRule 1']);
  },
};
/** A draft the same as the applied rules. */
export const NoChange: Story = { args: { changes: CHANGES.map(({ verb }) => ({ verb, gained: [], lost: [] })) } };
export const Loading: Story = { args: { changes: undefined } };
export const ReadFailed: Story = { args: { changes: undefined, error: 'The fleet does not answer', onRetry: fn() } };
