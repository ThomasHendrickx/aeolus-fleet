import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { COMPOSE_SHIPS, COMPOSE_TYPES, REVIEWER_01 } from '../molecules/selector-picker.fixtures';
import { ComposeDialog } from './compose-dialog';

const DRAFT = {
  selector: { kind: 'ship', shipId: REVIEWER_01.id },
  payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/318 before 15:00.',
} as const;

const meta = {
  title: 'Organisms/ComposeDialog',
  component: ComposeDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    isOpen: true,
    onOpenChange: fn(),
    ships: COMPOSE_SHIPS,
    types: COMPOSE_TYPES,
    state: 'editing',
    onSend: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComposeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Send stays disabled until it has a recipient and a message. */
export const Empty: Story = {};

export const Filled: Story = { args: { draft: DRAFT } };

export const ToAType: Story = {
  args: { draft: { selector: { kind: 'type', type: 'reviewer' }, payload: 'Pause all reviews until 15:00.' } },
};

export const Sending: Story = { args: { draft: DRAFT, state: 'sending' } };

/** The server refused: the operator's input stays. */
export const Failed: Story = {
  args: {
    draft: { selector: { kind: 'type', type: 'deployer' }, payload: 'Deploy 2.14 to production.' },
    state: 'failed',
    error: 'No active ship has the type deployer.',
  },
};

/** Refused at the daily message limit (canvas 12.3): the message is kept, and the dialog says when sending works again. */
export const RefusedAtDailyLimit: Story = {
  args: {
    draft: DRAFT,
    state: 'failed',
    error: 'The fleet reached its limit of 1000 messages today (UTC), so nothing was stored. Sending works again after 00:00 UTC.',
    messageLimit: { limit: 1000, resetsAt: '2026-10-05T00:00:00.000Z' },
    accountUrl: 'https://pagasae.aeolus-fleet.dev/account',
  },
};
export const Phone: Story = { args: { draft: DRAFT }, globals: { viewport: { value: 'mobile1' } } };
