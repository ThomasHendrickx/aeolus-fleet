import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { ConsoleFrame } from './console-frame';

const meta = {
  title: 'Organisms/ConsoleFrame',
  component: ConsoleFrame,
  args: {
    nav: { active: 'overview', inboxCount: 3, stuckCount: 2 },
    children: (
      <div className="m-8 flex min-h-80 items-center justify-center rounded-lg border border-dashed border-border font-mono text-id text-muted-foreground">
        ListPage or DetailPage
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConsoleFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };

/** With squadrons and the trierarch plugin, which add them to the navigation. */
export const WithPlugins: Story = {
  args: { nav: { active: 'trierarchs', inboxCount: 3, stuckCount: 2, hasSquadrons: true, hasTrierarchs: true, trierarchsCount: 2, hasNetwork: true, hasSettings: true } },
};
export const WithPluginsPhone: Story = { ...WithPlugins, globals: { viewport: { value: 'mobile1' } } };
