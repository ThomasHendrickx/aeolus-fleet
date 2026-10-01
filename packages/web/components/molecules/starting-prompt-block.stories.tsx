import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { StartingPromptBlock } from './starting-prompt-block';

const SHIP_ID = 'shp_01j8xk4t9qf3m2n9xw5r6ryb4c';
const SECRET = 'aeolus_sk_v1_Swyh7-U2pSYOV-caUTN5W0wSLql0iPPn1L11';

const meta = {
  title: 'Molecules/StartingPromptBlock',
  component: StartingPromptBlock,
  args: {
    shipName: 'reviewer-01',
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
    onDone: () => undefined,
  },
} satisfies Meta<typeof StartingPromptBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PromptAndCrewLine: Story = {};
