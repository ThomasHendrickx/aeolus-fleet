import { THEMES } from '@aeolus-fleet/common';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Plus } from 'lucide-react';

import { Button } from '../atoms/button';
import { TopBar } from './top-bar';

const meta = {
  title: 'Organisms/TopBar',
  component: TopBar,
  args: { title: 'Fleet', live: 'live' },
  globals: { viewport: { value: 'mobile1' } },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Root: Story = {};
export const Detail: Story = { args: { title: 'reviewer-01', back: { href: '/', label: 'Fleet' } } };
export const Offline: Story = { args: { live: 'offline' } };
/** Root with the CommandPalette's search icon, before the other actions. */
export const WithSearch: Story = {
  args: {
    onSearch: fn(),
    actions: (
      <Button variant="ghost" size="touch" isIconOnly aria-label="Commission ship" icon={<Plus aria-hidden />} />
    ),
  },
};
export const WithAction: Story = {
  args: {
    actions: (
      <Button variant="ghost" size="touch" isIconOnly aria-label="Commission ship" icon={<Plus aria-hidden />} />
    ),
  },
};

/** Root with the AccountMenu's Avatar, always last; it opens the menu as a bottom Sheet. */
export const WithAccount: Story = {
  args: {
    actions: (
      <Button variant="ghost" size="touch" isIconOnly aria-label="Commission ship" icon={<Plus aria-hidden />} />
    ),
    account: {
      account: {
        kind: 'operator',
        email: 'operator@example.com',
        session: { device: 'iPhone · Safari', since: '2026-10-01T11:10:00.000Z' },
        theme: 'system',
      },
      themes: THEMES, onThemeChange: fn(),
      onSignOut: fn(),
      isSigningOut: false,
      now: new Date('2026-10-01T12:30:00.000Z'),
    },
  },
};
