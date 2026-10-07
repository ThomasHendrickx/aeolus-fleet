import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { Button } from '../atoms/button';
import { NEEDS_CREW_BY_HAND, NEEDS_CREW_WITH_PLUGIN, NOW } from './machines.fixtures';
import { NeedsCrewList } from './needs-crew-list';

const meta = {
  title: 'Organisms/NeedsCrewList',
  component: NeedsCrewList,
  args: { ships: NEEDS_CREW_BY_HAND, hasTrierarchs: false, onRetry: () => undefined, now: NOW, actionOf: () => <Button size="xs">Get starting prompt</Button> },
} satisfies Meta<typeof NeedsCrewList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByHand: Story = {};
export const WithPlugin: Story = { args: { ships: NEEDS_CREW_WITH_PLUGIN, hasTrierarchs: true, actionOf: undefined } };
export const Empty: Story = { args: { ships: [] } };
export const EmptyWithPlugin: Story = { args: { ships: [], hasTrierarchs: true } };
export const Loading: Story = { args: { ships: undefined } };
export const LoadFailed: Story = { args: { ships: undefined, error: 'The fleet server did not answer.' } };
