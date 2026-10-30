import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, screen } from 'storybook/test';

import { KEY_NOT_REACHABLE, SEALING_NOW } from '../../../../lib/fixtures/sealing.fixtures';
import { keyNotReachableNotice } from '../../services/key-not-reachable';
import { KeyNotReachableNotice } from './key-not-reachable-notice';

const notice = keyNotReachableNotice(KEY_NOT_REACHABLE, SEALING_NOW) ?? { title: '', description: '' };

const meta = {
  title: 'Molecules/KeyNotReachableNotice',
  component: KeyNotReachableNotice,
  args: notice,
} satisfies Meta<typeof KeyNotReachableNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The company key not reachable: since when, why, and View sealing. */
export const KeyNotReachable: Story = {
  play: async () => {
    await expect(await screen.findByTestId('overview-key-not-reachable')).toHaveTextContent('Since 09:05 your KMS answers: access denied.');
    await expect(screen.getByRole('link', { name: 'View sealing' })).toHaveAttribute('href', '/sealing');
  },
};
/** On phone, above the ship cards. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } };
