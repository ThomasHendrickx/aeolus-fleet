import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { SEALED, SEALING_FLEET_ID } from '../../../../lib/fixtures/sealing.fixtures';
import { ChangeCompanyKeyDialog } from './change-company-key-dialog';

const NEW_KEY = 'arn:aws:kms:eu-central-1:441703952218:key/0b9e44d2-6c1a-4f7e-8d2b-5a9c3e1f7d60';

const meta = {
  title: 'Organisms/ChangeCompanyKeyDialog',
  component: ChangeCompanyKeyDialog,
  args: { isOpen: true, onOpenChange: fn(), fleetId: SEALING_FLEET_ID, current: SEALED.companyKey, isPending: false, onChange: fn() },
} satisfies Meta<typeof ChangeCompanyKeyDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Form: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByTestId('change-company-key-input'), NEW_KEY);
    await userEvent.click(screen.getByTestId('change-company-key-submit'));
    await expect(args.onChange).toHaveBeenCalledWith({ companyKey: NEW_KEY });
  },
};
export const Moving: Story = { args: { isPending: true } };
/** A press shows it working at once, before the answer comes, and can not run twice. */
export const PressShowsPending: Story = {
  render: function Render(args) {
    const [isPending, setIsPending] = useState(false);
    return (
      <ChangeCompanyKeyDialog
        {...args}
        isPending={isPending}
        onChange={() => {
          setIsPending(true);
        }}
      />
    );
  },
  play: async () => {
    await userEvent.type(await screen.findByTestId('change-company-key-input'), NEW_KEY);
    await userEvent.click(screen.getByTestId('change-company-key-submit'));
    await waitFor(async () => {
      await expect(screen.getByTestId('change-company-key-submit')).toHaveTextContent('Moving the data keys…');
    });
    await expect(screen.getByTestId('change-company-key-submit')).toHaveAttribute('aria-disabled', 'true');
  },
};
/** Refused: the current key is not reachable; recovery is the way. */
export const CurrentKeyNotReachable: Story = {
  args: { refusal: { kind: 'currentKeyUnavailable' } },
  play: async () => {
    // The dialog fades in: wait until the refusal shows.
    await waitFor(async () => {
      await expect(screen.getByText('Your current company key is not reachable')).toBeVisible();
    });
  },
};
/** Refused: the new key's policy has no condition naming this fleet. */
export const NotBoundToFleet: Story = { args: { refusal: { kind: 'keyNotBoundToFleet' } } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
