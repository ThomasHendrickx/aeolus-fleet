import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { forming, sailing } from '../../../lib/fixtures/squadrons.fixtures';
import { SquadronHeader } from './squadron-header';

const meta = {
  title: 'Organisms/SquadronHeader',
  component: SquadronHeader,
  args: { squadron: forming, squadronId: forming.id, state: 'ready' },
} satisfies Meta<typeof SquadronHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Forming: Story = {};
export const Sailing: Story = { args: { squadron: sailing, squadronId: sailing.id } };
export const Loading: Story = { args: { state: 'loading', squadron: undefined } };
export const NotFound: Story = { args: { state: 'not-found', squadron: undefined, squadronId: 'aeolus-zzzzzz' } };
