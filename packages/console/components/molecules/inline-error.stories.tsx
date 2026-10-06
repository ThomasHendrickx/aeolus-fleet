import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';

import { InlineError } from './inline-error';

const meta = {
  title: 'Molecules/InlineError',
  component: InlineError,
  decorators: [
    (Story) => (
      <div className="max-w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InlineError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Field: Story = {
  args: { variant: 'field', title: 'reviewer-01 is already used by an active ship.' },
};

export const Section: Story = {
  args: {
    variant: 'section',
    title: 'No ship of type deployer exists',
    description:
      'The message was not accepted, so nothing was stored. Choose a type that is in use, or commission a deployer ship first.',
  },
};

/** A section whose read failed: Try again reads it again. */
export const SectionWithRetry: Story = {
  args: {
    variant: 'section',
    title: 'Couldn’t read the repositories',
    description: 'squadrons did not answer.',
    onRetry: fn(),
  },
};

export const Page: Story = {
  args: {
    variant: 'page',
    title: 'Couldn’t load the fleet',
    description: 'This page couldn’t reach the fleet server. Nothing is lost; try again.',
    detail: 'Request timed out after 10 s',
    onRetry: fn(),
    retryNote: 'Retrying in 12 s',
  },
};
