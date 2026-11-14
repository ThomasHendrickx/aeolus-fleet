import { idSchema, type ShipId } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { ChangeOwnerDialog } from './change-owner-dialog';

const shipId = (suffix: string) => idSchema('ship').parse(`shp_01j8xk4tqzr3a9w6m2v5n7${suffix}`);
const BURAK = { id: shipId('b0rk'), name: 'burak' };
const CHARLOTTE = { id: shipId('c4rm'), name: 'charlotte' };
const DANA = { id: shipId('d4na'), name: 'dana' };
const ARGO = { id: shipId('a7g0'), name: 'argo', isYou: true };

const meta = {
  title: 'Organisms/ChangeOwnerDialog',
  component: ChangeOwnerDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    shipName: 'reviewer-02',
    currentOwner: CHARLOTTE,
    personShips: [BURAK, CHARLOTTE, DANA],
    argo: ARGO,
    isOpen: true,
    onOpenChange: fn(),
    isPending: false,
    onSubmit: fn(),
  },
  decorators: [
    (Story) => (
      <div className="min-h-180">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChangeOwnerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openTheList() {
  const dialog = await screen.findByTestId('change-owner-dialog');
  await waitFor(async () => {
    await expect(dialog).toBeVisible();
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Show the choices' }));
  return screen.findByRole('listbox');
}

/** Picks the option and presses Change owner once the list has closed. */
async function pickAndChange(list: HTMLElement, name: RegExp) {
  await userEvent.click(within(list).getByRole('option', { name }));
  const button = screen.getByRole('button', { name: 'Change owner' });
  await waitFor(async () => {
    await expect(screen.queryByRole('listbox')).toBeNull();
    await expect(button).toBeEnabled();
  });
  await userEvent.click(button);
}

/**
 * Changing it (state 3): the person ships, the current one marked, then argo
 * apart with "No person answers". Change owner stays off until another owner
 * is picked; picking burak and pressing it asks for burak.
 */
export const Changing: Story = {
  play: async ({ args }) => {
    const list = await openTheList();
    const rows = within(list).getAllByRole('option').map((option) => option.textContent);
    await expect(rows).toEqual(['burak', 'charlotteCurrent', 'dana', 'argo (you)No person answers']);
    await expect(list.querySelector('[data-slot="combobox-separator"]')?.nextElementSibling).toHaveTextContent('argo (you)');
    await expect(screen.getByTestId('change-owner-submit')).toBeDisabled();

    await pickAndChange(list, /burak/);

    await expect(args.onSubmit).toHaveBeenCalledWith(BURAK.id);
  },
};

/** argo can be picked: the fallback, offered apart. */
export const PickingArgo: Story = {
  play: async ({ args }) => {
    const list = await openTheList();
    await pickAndChange(list, /argo \(you\)/);
    await expect(args.onSubmit).toHaveBeenCalledWith(ARGO.id);
  },
};

/** Saving (state 4): the button says so and takes no second press. */
export const Saving: Story = {
  args: { isPending: true },
  play: async ({ args }) => {
    const button = await screen.findByRole('button', { name: 'Changing owner' });
    await waitFor(async () => {
      await expect(button).toBeVisible();
    });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** The press shows Changing owner at once, before the fleet answers. */
export const PressShowsSaving: Story = {
  render: function PressShowsSaving(args: ComponentProps<typeof ChangeOwnerDialog>) {
    const [isPending, setIsPending] = useState(false);
    return (
      <ChangeOwnerDialog
        {...args}
        isPending={isPending}
        onSubmit={(ownerShipId: ShipId) => {
          setIsPending(true);
          args.onSubmit(ownerShipId);
        }}
      />
    );
  },
  play: async () => {
    const list = await openTheList();
    await pickAndChange(list, /dana/);
    await expect(await screen.findByRole('button', { name: 'Changing owner' })).toHaveAttribute('aria-busy', 'true');
  },
};

/** Refused (state 6): the fleet's reason inline, and that nothing changed; the pick is kept. */
export const Refused: Story = {
  args: { error: "An owner is an active person's ship or argo." },
  play: async () => {
    await waitFor(async () => {
      await expect(await screen.findByText("An owner is an active person's ship or argo. Nothing changed.")).toBeVisible();
    });
    await expect(screen.getByText('Couldn’t change the owner')).toBeVisible();
  },
};

/** The person ships could not be read: why, with Try again. */
export const PersonShipsNotRead: Story = {
  args: { personShips: undefined, readFailure: { message: 'The fleet did not answer', onRetry: fn() } },
};

/** On phone the dialog is a full-screen page. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
