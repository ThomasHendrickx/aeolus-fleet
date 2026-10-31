import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';

import { SEALED, SEALING_NOW } from '../../../../lib/fixtures/sealing.fixtures';
import { SealingPanel } from './sealing-panel';

const meta = {
  title: 'Organisms/SealingPanel',
  component: SealingPanel,
  args: { sealing: SEALED, now: SEALING_NOW, onRetry: fn(), onTurnOn: fn(), onChangeCompanyKey: fn(), onChangeRecoveryKey: fn() },
} satisfies Meta<typeof SealingPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sealed: Story = {};
/** Loading: the shape that is coming. */
export const Loading: Story = { args: { sealing: undefined } };
/** Couldn't load: nothing changed, Try again. */
export const LoadFailed: Story = {
  args: { sealing: undefined, error: 'timed out after 10 s' },
  play: async ({ args }) => {
    await expect(await screen.findByText('fleet.sealing: timed out after 10 s')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};
/** Sealing off, with fleet:keys: Turn on sealing. */
export const Off: Story = {
  args: { sealing: { state: 'none' } },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByTestId('sealing-turn-on'));
    await expect(args.onTurnOn).toHaveBeenCalled();
  },
};
/** Sealing off, without fleet:keys: what turning it on takes. */
export const OffReadOnly: Story = {
  args: { sealing: { state: 'none' }, onTurnOn: undefined },
  play: async () => {
    await expect(await screen.findByText(/Turning it on takes the scope/)).toBeVisible();
    await expect(screen.queryByTestId('sealing-turn-on')).toBeNull();
  },
};
export const PhoneOff: Story = { args: { sealing: { state: 'none' } }, globals: { viewport: { value: 'mobile1' } } };
export const PhoneLoadFailed: Story = { args: { sealing: undefined, error: 'timed out after 10 s' }, globals: { viewport: { value: 'mobile1' } } };
