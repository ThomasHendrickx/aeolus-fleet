import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CrewLines } from './crew-lines';

const IDENTITY = 'https://fleet.example.dev shp_01m3tbfspe96yf1rnr4ank0002 aeolus_sk_v1_example';

const meta = {
  title: 'Molecules/CrewLines',
  component: CrewLines,
  args: {
    crewLines: [
      { harness: 'claude-code', line: `/aeolus:crew ${IDENTITY}` },
      { harness: 'codex', line: `$aeolus-crew ${IDENTITY}` },
    ],
    subject: 'reviewer-01',
    testIdPrefix: 'story-crew-line',
  },
  decorators: [(Story) => <div className="flex flex-col gap-3">{Story()}</div>],
} satisfies Meta<typeof CrewLines>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
