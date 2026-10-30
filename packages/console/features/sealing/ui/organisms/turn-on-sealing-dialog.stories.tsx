import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { SEALING_FLEET_ID } from '../../../../lib/fixtures/sealing.fixtures';
import { TurnOnSealingDialog } from './turn-on-sealing-dialog';

const COMPANY_KEY = 'arn:aws:kms:eu-central-1:441703952218:key/7f3c2a91-5d0e-4b8a-9c61-2e8f04d7b1a3';

const meta = {
  title: 'Organisms/TurnOnSealingDialog',
  component: TurnOnSealingDialog,
  args: { isOpen: true, onOpenChange: fn(), fleetId: SEALING_FLEET_ID, isPending: false, onTurnOn: fn() },
} satisfies Meta<typeof TurnOnSealingDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The form, with the condition the key's policy needs to copy (ES4). */
export const Form: Story = {};
/** Turn on sends the company key and the recovery key as typed, trimmed; no recovery key when left empty. */
export const TurnsOn: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByTestId('turn-on-sealing-company-key'), ` ${COMPANY_KEY} `);
    await userEvent.click(screen.getByTestId('turn-on-sealing-submit'));
    await expect(args.onTurnOn).toHaveBeenCalledWith({ companyKey: COMPANY_KEY });
  },
};
/** Busy: the KMS is checked. */
export const Checking: Story = { args: { isPending: true } };
/** A press shows it working at once, before the answer comes, and can not run twice. */
export const PressShowsPending: Story = {
  render: function Render(args) {
    const [isPending, setIsPending] = useState(false);
    return (
      <TurnOnSealingDialog
        {...args}
        isPending={isPending}
        onTurnOn={() => {
          setIsPending(true);
        }}
      />
    );
  },
  play: async () => {
    await userEvent.type(await screen.findByTestId('turn-on-sealing-company-key'), COMPANY_KEY);
    await userEvent.click(screen.getByTestId('turn-on-sealing-submit'));
    await waitFor(async () => {
      await expect(screen.getByTestId('turn-on-sealing-submit')).toHaveTextContent('Checking the key…');
    });
    await expect(screen.getByTestId('turn-on-sealing-submit')).toHaveAttribute('aria-disabled', 'true');
  },
};
/** Refused: the key's policy has no condition naming this fleet. */
export const NotBoundToFleet: Story = {
  args: { refusal: { kind: 'keyNotBoundToFleet' } },
  play: async () => {
    // The dialog fades in: wait until the refusal shows.
    await waitFor(async () => {
      await expect(screen.getByText('The key’s policy doesn’t name this fleet')).toBeVisible();
    });
  },
};
/** Refused: KEY_UNAVAILABLE with the KMS's reason. */
export const AccessDenied: Story = { args: { refusal: { kind: 'keyUnavailable', reason: 'access denied' } } };
export const KeyDisabled: Story = { args: { refusal: { kind: 'keyUnavailable', reason: 'disabled' } } };
/** Refused for another reason, by the server's words. */
export const InvalidRecoveryKey: Story = { args: { refusal: { kind: 'other', message: 'The recovery key is not an age X25519 recipient' } } };
/** On phone: full screen. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
