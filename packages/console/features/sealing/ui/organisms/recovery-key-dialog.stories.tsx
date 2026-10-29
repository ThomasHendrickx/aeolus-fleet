import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';

import { SEALED, SEALING_FLEET_ID } from '../../../../lib/fixtures/sealing.fixtures';
import { RecoveryKeyDialog } from './recovery-key-dialog';

const NEW_RECOVERY_KEY = 'age1zr4mqx0d8h2k6y9w3t5v7n1p4s8u2c6e0g3j5l7q9r1x3z5b7u7tq';

const meta = {
  title: 'Organisms/RecoveryKeyDialog',
  component: RecoveryKeyDialog,
  args: { isOpen: true, onOpenChange: fn(), fleetId: SEALING_FLEET_ID, current: SEALED.recoveryKeyFingerprint, isPending: false, onChange: fn() },
} satisfies Meta<typeof RecoveryKeyDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Replace recovery key: no Remove. */
export const Replace: Story = {
  play: async ({ args }) => {
    await userEvent.type(await screen.findByTestId('recovery-key-input'), NEW_RECOVERY_KEY);
    await userEvent.click(screen.getByTestId('recovery-key-submit'));
    await expect(args.onChange).toHaveBeenCalledWith({ recoveryKey: NEW_RECOVERY_KEY });
  },
};
/** Set recovery key, on a fleet sealed without one. */
export const SetFirst: Story = { args: { current: null } };
export const Replacing: Story = { args: { isPending: true } };
/** A press shows it working at once, before the answer comes, and can not run twice. */
export const PressShowsPending: Story = {
  render: function Render(args) {
    const [isPending, setIsPending] = useState(false);
    return (
      <RecoveryKeyDialog
        {...args}
        isPending={isPending}
        onChange={() => {
          setIsPending(true);
        }}
      />
    );
  },
  play: async () => {
    await userEvent.type(await screen.findByTestId('recovery-key-input'), NEW_RECOVERY_KEY);
    await userEvent.click(screen.getByTestId('recovery-key-submit'));
    await waitFor(async () => {
      await expect(screen.getByTestId('recovery-key-submit')).toHaveTextContent('Wrapping the data keys…');
    });
    await expect(screen.getByTestId('recovery-key-submit')).toHaveAttribute('aria-disabled', 'true');
  },
};
/** Refused: the company key is not reachable, so no data key can be wrapped. */
export const KeyNotReachable: Story = { args: { refusal: { kind: 'keyUnavailable', reason: 'disabled' } } };
/** Refused: not an age recipient. */
export const InvalidRecoveryKey: Story = { args: { refusal: { kind: 'other', message: 'The recovery key is not an age X25519 recipient' } } };
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
