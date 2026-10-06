import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CrewLineDialog } from './crew-line-dialog';

const meta = {
  title: 'Organisms/CrewLineDialog',
  component: CrewLineDialog,
  args: {
    memberName: 'implementer-q8r2',
    template: 'implementer@3',
    launchNote: 'Start Claude Code in a fresh git worktree of aeolus-fleet. Needs gh signed in and Node 26.',
    crewLines: [
      { harness: 'claude-code', line: '/aeolus:crew https://fleet.example.dev shp_01m3tbfspe96yf1rnr4ank0002 aeolus_sk_v1_example aeolus-a1b2c3' },
      { harness: 'codex', line: '$aeolus-crew https://fleet.example.dev shp_01m3tbfspe96yf1rnr4ank0002 aeolus_sk_v1_example aeolus-a1b2c3' },
      {
        harness: 'chat',
        line: 'Crew Aeolus ship shp_01m3tbfspe96yf1rnr4ank0002 through the fleet\'s MCP connector at https://fleet.example.dev/mcp: register with ship id shp_01m3tbfspe96yf1rnr4ank0002, secret aeolus_sk_v1_example and your chat client as harness (claude-chat or chatgpt). Then check in: send the ship aeolus-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"aeolus-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"aeolus-a1b2c3","role":"implementer"}, and take up the charter.',
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

export const Shown: Story = {};
export const NoLaunchNote: Story = { args: { launchNote: null } };
export const NoLaunchNoteOrModel: Story = { args: { launchNote: null, model: null } };
export const Issuing: Story = { args: { state: 'issuing', crewLines: undefined } };
export const Failed: Story = { args: { state: 'error', error: 'The squadron manager did not answer.', crewLines: undefined } };
