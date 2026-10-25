import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { ScopeDialog } from './scope-dialog';

const meta = {
  title: 'Organisms/ScopeDialog',
  component: ScopeDialog,
  args: { isOpen: true, onOpenChange: fn(), isPending: false, onSubmit: fn() },
} satisfies Meta<typeof ScopeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Define scope: a name and its one-line description. */
export const Define: Story = {};
/** Define sends the scope and description as typed, trimmed. */
export const Defines: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByTestId('scope-dialog-scope'), 'crm:read-leads');
    await userEvent.type(screen.getByTestId('scope-dialog-description'), 'Read leads in the CRM ');
    await userEvent.click(screen.getByTestId('scope-dialog-submit'));
    await expect(args.onSubmit).toHaveBeenCalledWith({ scope: 'crm:read-leads', description: 'Read leads in the CRM' });
  },
};
/** Being defined: the button says so and cannot be pressed twice. */
export const Defining: Story = { args: { isPending: true } };
/** A namespace reserved for a known plugin, refused by name; the input stays. */
export const Reserved: Story = { args: { error: 'gateway is reserved for a plugin Aeolus knows: pick another namespace' } };
/** A scope the fleet has. */
export const Taken: Story = { args: { error: 'The fleet has crm:read-leads already: change its description instead' } };
/** A namespace a plugin declared, naming its ship. */
export const PluginNamespace: Story = { args: { error: 'The namespace squadrons is taken, by squadrons' } };
/** Change description: the name stays as it is. */
export const Describe: Story = { args: { describing: { scope: 'crm:read-leads', description: 'Read leads in the CRM' } } };
export const Saving: Story = { args: { describing: { scope: 'crm:read-leads', description: 'Read leads in the CRM' }, isPending: true } };
/** On phone. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
