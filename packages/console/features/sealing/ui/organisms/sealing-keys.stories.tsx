import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { KEY_NOT_REACHABLE, SEALED, SEALED_WITHOUT_RECOVERY_KEY, SEALING, SEALING_NOW } from '../../../../lib/fixtures/sealing.fixtures';
import { SealingKeys } from './sealing-keys';

const meta = {
  title: 'Organisms/SealingKeys',
  component: SealingKeys,
  args: { sealing: SEALED, now: SEALING_NOW, onChangeCompanyKey: fn(), onChangeRecoveryKey: fn() },
} satisfies Meta<typeof SealingKeys>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sealed, the key reachable, with fleet:keys. */
export const Sealed: Story = {
  play: async ({ args }) => {
    await expect(await screen.findByTestId('sealing-state-since')).toHaveTextContent('since 29 Aug, 10:12');
    await expect(screen.getByTestId('sealing-company-key')).toHaveTextContent('arn:aws:kms:eu-central-1:4417…:key/7f3c…b1a3');
    await userEvent.click(screen.getByTestId('sealing-replace-recovery-key'));
    await expect(args.onChangeRecoveryKey).toHaveBeenCalledWith('replace');
  },
};
/** Sealing: payloads from before are being sealed, with how many of how many. */
export const Sealing: Story = {
  args: { sealing: SEALING },
  play: async () => {
    await expect(await screen.findByTestId('sealing-state-since')).toHaveTextContent('turned on 6 min ago');
    await expect(screen.getByTestId('sealing-progress')).toHaveTextContent('2,180 of 3,412 payloads sealed');
  },
};
/** Without fleet:keys: read only, saying what changing keys takes. */
export const ReadOnly: Story = {
  args: { onChangeCompanyKey: undefined, onChangeRecoveryKey: undefined },
  play: async () => {
    await expect(await screen.findByText(/Changing keys takes the scope/)).toBeVisible();
    await expect(screen.queryByTestId('sealing-change-company-key')).toBeNull();
  },
};
/** Sealed without a recovery key: Set recovery key. */
export const WithoutRecoveryKey: Story = {
  args: { sealing: SEALED_WITHOUT_RECOVERY_KEY },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByTestId('sealing-set-recovery-key'));
    await expect(args.onChangeRecoveryKey).toHaveBeenCalledWith('set');
  },
};
/** The company cut its key off: nothing waiting is lost. */
export const KeyNotReachable: Story = {
  args: { sealing: KEY_NOT_REACHABLE },
  play: async () => {
    await expect(await screen.findByTestId('sealing-key-not-reachable')).toHaveTextContent('Since 09:05 your KMS answers: access denied.');
  },
};
/** On phone. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
export const PhoneSealing: Story = { args: { sealing: SEALING }, globals: { viewport: { value: 'mobile1' } } };
