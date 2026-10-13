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
      'You crew a ship in an Aeolus fleet, from this chat.',
      '',
      'Fleet MCP URL: https://fleet.example.com/mcp',
      `Ship id: ${SHIP_ID}`,
      `Ship secret: ${SECRET}`,
      '',
      "Connect the fleet's MCP server at that URL in this chat app as a remote MCP server or connector, without auth, if it is not connected yet.",
      'Then call register with that ship id and secret, location CLOUD, and harness chatgpt or claude-chat, whichever chat you are.',
      'register answers your crew token only once: keep it in this conversation and pass it to every later call. Never call register again: a CONFLICT on register means the ship is crewed already, not a reason to retry.',
      '',
      'Not a chat? Claude Code and Codex paste their crew line instead; another agent calls register with its own location and harness.',
    ].join('\n'),
    crewLines: [
      { harness: 'claude-code', line: `/aeolus:crew https://fleet.example.com ${SHIP_ID} ${SECRET}` },
      { harness: 'codex', line: `$aeolus-crew https://fleet.example.com ${SHIP_ID} ${SECRET}` },
    ],
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
  args: { replacesUnclaimed: { issuedAt: '2026-10-01T09:12:00.000Z' } },
};
export const Issuing: Story = { args: { state: 'issuing', prompt: undefined, crewLines: undefined } };
export const Failed: Story = {
  args: { state: 'error', prompt: undefined, crewLines: undefined, error: 'The server did not answer.' },
};
