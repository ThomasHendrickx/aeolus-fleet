import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { LimitNotice } from './limit-notice';

const meta = {
  title: 'Molecules/LimitNotice',
  component: LimitNotice,
  args: {
    title: 'Your fleet reached today’s message limit',
    description: 'It sent 1,000 messages today, its daily limit. New messages are refused until the limit resets at 00:00 UTC.',
    accountUrl: 'https://pagasae.aeolus-fleet.dev/account',
  },
} satisfies Meta<typeof LimitNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithViewLimits: Story = {};

/** No hosted account configured: the notice says where limits live, with no link. */
export const WithoutAccount: Story = { args: { accountUrl: undefined } };
