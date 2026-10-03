import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { SquadronTag } from './squadron-tag';

const meta = { title: 'Molecules/SquadronTag', component: SquadronTag } satisfies Meta<typeof SquadronTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Squadron: Story = { args: { squadronId: 'aeolus-a1b2c3' } };
export const SquadronAndRole: Story = { args: { squadronId: 'aeolus-a1b2c3', role: 'tester' } };
export const SmallInRows: Story = { args: { squadronId: 'hemma-feature-k9m4p2', role: 'implementer', size: 'sm' } };
