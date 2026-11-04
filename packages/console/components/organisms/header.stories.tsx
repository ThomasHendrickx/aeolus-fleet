import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { Header } from './header';
import { SWITCHER } from '../../lib/fixtures/header.fixtures';

const meta = {
  title: 'Organisms/Header',
  component: Header,
  args: { breadcrumb: 'Fleet overview', live: 'live', switcher: SWITCHER, onCompose: fn(), onSearch: fn() },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * As the fleet overview mockups draw it (docs/design/fleet-overview): "Acme / Fleet overview", Live, a Search
 * field and Compose; the avatar menu sits in the Sidebar foot.
 */
export const Live: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('app-switcher')).toHaveTextContent(/^Acme$/);
    await expect(canvas.getByTestId('header-breadcrumb')).toHaveTextContent(/^\/\s*Fleet overview$/);
    await expect(canvas.getByTestId('header-search')).toHaveTextContent(/^Search$/);
    await expect(canvas.queryByTestId('avatar-menu')).toBeNull();
  },
};
export const Reconnecting: Story = { args: { live: 'reconnecting' } };
export const Offline: Story = { args: { live: 'offline' } };

/** A page that offers no Compose. */
export const WithoutCompose: Story = { args: { onCompose: undefined } };

/** Without the CommandPalette: no search trigger. */
export const WithoutSearch: Story = { args: { onSearch: undefined } };

/** A member's page: every level above it links up to it. */
export const WithParents: Story = {
  args: {
    breadcrumb: 'tester-a1b2',
    parents: [
      { href: '/squadrons', label: 'Squadrons' },
      { href: '/squadrons/team-a1b2c3', label: 'team-a1b2c3' },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('header-breadcrumb')).toHaveTextContent(/^\/\s*Squadrons\s*\/\s*team-a1b2c3\s*\/\s*tester-a1b2$/);
  },
};
