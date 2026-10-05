import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { NoticeBanner } from './notice-banner';

const meta = {
  title: 'Molecules/NoticeBanner',
  component: NoticeBanner,
  args: {
    notice: {
      id: 'maintenance',
      audience: 'everyone',
      text: 'The server restarts for maintenance on Saturday at 06:00 UTC. Ships reconnect by themselves.',
      links: [],
      isDismissible: false,
    },
    onDismiss: () => undefined,
    onSignOut: () => undefined,
  },
} satisfies Meta<typeof NoticeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text only, not dismissible: it stays for the whole session. */
export const TextOnly: Story = {};

/** Dismissible, with a link and a link that signs out first. */
export const WithLinksDismissible: Story = {
  args: {
    notice: {
      id: 'read-only',
      audience: 'viewers',
      text: 'You are looking at this fleet read-only.',
      links: [
        { label: 'Learn more', url: 'https://example.com/about' },
        { label: 'Leave', url: 'https://example.com', isSignOut: true },
      ],
      isDismissible: true,
    },
  },
};
