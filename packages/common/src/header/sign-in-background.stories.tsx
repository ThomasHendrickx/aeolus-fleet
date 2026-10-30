import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { SignInBackground } from './sign-in-background.js';
import { SIGN_IN_BACKGROUNDS } from './sign-in-backgrounds.js';

const meta = {
  title: 'Header/SignInBackground',
  component: SignInBackground,
  decorators: [
    (Story) => (
      <div className="relative isolate grid h-[calc(100vh-3rem)] place-items-center overflow-hidden">
        <Story />
        <div className="relative w-full max-w-100 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-heading font-semibold">Sign in to Aeolus</h1>
          <p className="text-body text-muted-foreground">Your sign-in ended.</p>
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof SignInBackground>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Without a background named: the one picked at random when the page loaded. */
export const PickedAtLoad: Story = {
  play: async ({ canvasElement }) => {
    const background = await within(canvasElement).findByTestId('sign-in-background');
    await expect(SIGN_IN_BACKGROUNDS).toContain(background.dataset.background);
  },
};

/** The view Thomas picked: single ships seen from above. */
export const FromAbove1: Story = { args: { background: 'from-above-1' } };
export const FromAbove1Dark: Story = { args: { background: 'from-above-1' }, globals: { theme: 'dark' } };

/** Loose groups of three to five ships sailing together among the single ships. */
export const Squadrons1: Story = { args: { background: 'squadrons-1' } };
export const Squadrons1Dark: Story = { args: { background: 'squadrons-1' }, globals: { theme: 'dark' } };

/** Squadrons in a line, each ship following the wake of the one ahead. */
export const Squadrons3: Story = { args: { background: 'squadrons-3' } };
export const Squadrons3Dark: Story = { args: { background: 'squadrons-3' }, globals: { theme: 'dark' } };

/** Two loose groups and two lines. */
export const Squadrons4: Story = { args: { background: 'squadrons-4' } };
export const Squadrons4Dark: Story = { args: { background: 'squadrons-4' }, globals: { theme: 'dark' } };

/** Like Squadrons 1, the groups closer together and one more. */
export const Squadrons5: Story = { args: { background: 'squadrons-5' } };
export const Squadrons5Dark: Story = { args: { background: 'squadrons-5' }, globals: { theme: 'dark' } };

/** Like Squadrons 3, the lines bending gently as if following a course. */
export const Squadrons6: Story = { args: { background: 'squadrons-6' } };
export const Squadrons6Dark: Story = { args: { background: 'squadrons-6' }, globals: { theme: 'dark' } };
