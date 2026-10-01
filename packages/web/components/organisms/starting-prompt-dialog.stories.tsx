import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { StartingPromptDialog } from './starting-prompt-dialog';

const SHIP_ID = 'shp_01j8xk4t9qf3m2n9xw5r6ryb4c';
const SECRET = 'aeolus_sk_v1_3Vn8Qe1Rt6Yu9Io2Pa5Sd7Fg';

const meta = {
  title: 'Organisms/StartingPromptDialog',
  component: StartingPromptDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'reviewer-01',
    state: 'shown',
    prompt: [
      'You crew a ship in an Aeolus fleet.',
      '',
      'Fleet MCP URL: https://fleet.example.com/mcp',
      `Ship id: ${SHIP_ID}`,
      `Ship secret: ${SECRET}`,
      '',
      'Call register.',
    ].join('\n'),
    crewLine: `/aeolus:crew https://fleet.example.com ${SHIP_ID} ${SECRET}`,
    isOpen: true,
    onOpenChange: () => undefined,
    onConfirm: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="min-h-176">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StartingPromptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shown: Story = {};
export const ReplacesUnclaimed: Story = {
  args: { state: 'confirm', prompt: undefined, crewLine: undefined, replacesUnclaimed: { issuedAt: '2026-10-01T09:12:00.000Z' } },
};
export const Issuing: Story = { args: { state: 'issuing', prompt: undefined, crewLine: undefined } };
export const Failed: Story = {
  args: { state: 'error', prompt: undefined, crewLine: undefined, error: 'The server did not answer.' },
};
