import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, userEvent, waitFor } from 'storybook/test';

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
      'Not a chat? Claude Code, Codex and Copilot paste their crew line instead; another agent calls register with its own location and harness.',
    ].join('\n'),
    crewLines: [
      { harness: 'claude-code', line: `/aeolus-fleet:crew https://fleet.example.com ${SHIP_ID} ${SECRET}` },
      { harness: 'codex', line: `$aeolus-fleet-crew https://fleet.example.com ${SHIP_ID} ${SECRET}` },
      { harness: 'copilot', line: `/aeolus-fleet:crew https://fleet.example.com ${SHIP_ID} ${SECRET}` },
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

/** Copilot's crew line after Codex's, and beside the crew lines where to install the Aeolus Fleet plugin they need, for Claude Code, Codex and Copilot (#1235). */
export const Shown: Story = {
  play: async () => {
    await expect(await screen.findByTestId('starting-prompt-crew-line-copilot')).toHaveTextContent(`/aeolus-fleet:crew https://fleet.example.com ${SHIP_ID} ${SECRET}`);
    await expect(await screen.findByTestId('plugin-install-claude-code')).toHaveAttribute(
      'href',
      'https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/guides/claude-code.md#1-install-the-plugin-once-per-machine',
    );
    await expect(screen.getByTestId('plugin-install-codex')).toHaveAttribute(
      'href',
      'https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/plugins/aeolus-fleet/README.md#install-for-codex-desktop-or-cli',
    );
    await expect(screen.getByTestId('plugin-install-copilot')).toHaveAttribute(
      'href',
      'https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/plugins/aeolus-fleet/README.md#install-for-the-github-copilot-cli',
    );
  },
};
/** The Copilot crew line copied with its own copy button. */
export const CopilotCopied: Story = {
  play: async () => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = () => Promise.resolve();
    try {
      await userEvent.click(await screen.findByTestId('starting-prompt-crew-line-copilot-copy'));
      await waitFor(() => expect(screen.getByTestId('starting-prompt-crew-line-copilot-copy')).toHaveTextContent('Copied'));
    } finally {
      navigator.clipboard.writeText = writeText;
    }
  },
};
/** The clipboard refused: the same message under the install line, saying to copy by hand. */
export const CopyFailed: Story = {
  play: async () => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = () => Promise.reject(new Error('The clipboard refused.'));
    try {
      await userEvent.click(await screen.findByTestId('starting-prompt-crew-line-copilot-copy'));
      await expect(await screen.findByText('Could not copy: select the text and copy it by hand.')).toBeVisible();
    } finally {
      navigator.clipboard.writeText = writeText;
    }
  },
};
export const ReplacesUnclaimed: Story = {
  args: { replacesUnclaimed: { issuedAt: '2026-10-01T09:12:00.000Z' } },
};
export const Issuing: Story = { args: { state: 'issuing', prompt: undefined, crewLines: undefined } };
export const Failed: Story = {
  args: { state: 'error', prompt: undefined, crewLines: undefined, error: 'The server did not answer.' },
};
