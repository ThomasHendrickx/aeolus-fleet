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
    ],
    state: 'shown',
    isOpen: true,
    onOpenChange: () => undefined,
  },
} satisfies Meta<typeof CrewLineDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shown: Story = {};
export const NoLaunchNote: Story = { args: { launchNote: null } };
export const Issuing: Story = { args: { state: 'issuing', crewLines: undefined } };
export const Failed: Story = { args: { state: 'error', error: 'The squadron manager did not answer.', crewLines: undefined } };
