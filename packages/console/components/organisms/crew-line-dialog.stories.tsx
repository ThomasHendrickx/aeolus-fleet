import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen, waitFor } from 'storybook/test';

import { CrewLineDialog } from './crew-line-dialog';

const meta = {
  title: 'Organisms/CrewLineDialog',
  component: CrewLineDialog,
  args: {
    memberName: 'implementer-q8r2',
    template: 'implementer@3',
    launchNote: 'Start Claude Code in a fresh git worktree of aeolus-fleet. Needs gh signed in and Node 26.',
    crewLines: [
      { harness: 'claude-code', line: '/aeolus-fleet:crew https://fleet.example.dev shp_01m3tbfspe96yf1rnr4ank0002 aeolus_sk_v1_example aeolus-a1b2c3' },
      { harness: 'codex', line: '$aeolus-fleet-crew https://fleet.example.dev shp_01m3tbfspe96yf1rnr4ank0002 aeolus_sk_v1_example aeolus-a1b2c3' },
      {
        harness: 'chat',
        line: 'You crew a ship in an Aeolus fleet, from this chat.\n\nFleet MCP URL: https://fleet.example.dev/mcp\nShip id: shp_01m3tbfspe96yf1rnr4ank0002\nShip secret: aeolus_sk_v1_example\n\nConnect the fleet\'s MCP server at that URL in this chat app as a remote MCP server or connector, without auth, if it is not connected yet.\nThen call register with that ship id and secret, location CLOUD, and harness chatgpt or claude-chat, whichever chat you are.\nregister answers your crew token only once: keep it in this conversation and pass it to every later call. Never call register again: a CONFLICT on register means the ship is crewed already, not a reason to retry.\n\nNot a chat? Claude Code and Codex paste their crew line instead; another agent calls register with its own location and harness.\n\nOnce registered, check in: send the ship aeolus-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"aeolus-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"aeolus-a1b2c3","role":"implementer"}, and take up the charter.',
      },
    ],
    model: 'claude-opus-5-5',
    state: 'shown',
    isOpen: true,
    onOpenChange: () => undefined,
  },
} satisfies Meta<typeof CrewLineDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Under the crew line, where to install the Aeolus Fleet plugin it needs, for Claude Code and for Codex (#1235). */
export const Shown: Story = {
  play: async () => {
    // The dialog fades in: wait until it shows rather than check it at once.
    await waitFor(async () => {
      await expect(await screen.findByTestId('plugin-install-claude-code')).toBeVisible();
    });
    await expect(screen.getByTestId('plugin-install-codex')).toBeVisible();
  },
};
export const NoLaunchNote: Story = { args: { launchNote: null } };
export const NoLaunchNoteOrModel: Story = { args: { launchNote: null, model: null } };
export const Issuing: Story = { args: { state: 'issuing', crewLines: undefined } };
export const Failed: Story = { args: { state: 'error', error: 'The squadron manager did not answer.', crewLines: undefined } };
