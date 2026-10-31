import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { Plus } from 'lucide-react';

import { Button } from '@aeolus-fleet/ui';
import { TopBar } from './top-bar';
import { AVATAR_MENU, SWITCHER } from '../../lib/fixtures/header.fixtures';

const meta = {
  title: 'Organisms/TopBar',
  component: TopBar,
  args: { title: 'Fleet', live: 'live', switcher: SWITCHER },
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
    account: AVATAR_MENU,
    actions: (
      <Button variant="ghost" size="touch" isIconOnly aria-label="Commission ship" icon={<Plus aria-hidden />} />
    ),
  },
};
