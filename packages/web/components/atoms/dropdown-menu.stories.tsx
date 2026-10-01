import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive, Copy, Ellipsis, Inbox, Pencil, SquarePen, UserX } from 'lucide-react';

import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

const meta = {
  title: 'Atoms/DropdownMenu',
  component: DropdownMenu,
  decorators: [
    (Story) => (
      <div className="flex min-h-80 justify-start pl-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

function Trigger() {
  return (
    <DropdownMenuTrigger
      render={<Button variant="ghost" size="xs" isIconOnly aria-label="Actions for reviewer-01" icon={<Ellipsis />} />}
    />
  );
}

export const ShipActions: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger />
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <SquarePen />
            Message this ship
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy />
            Copy ship id
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <Pencil />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem>
            <UserX />
            Release ship…
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Archive />
          Retire ship…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const Argo: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger />
      <DropdownMenuContent>
        <DropdownMenuItem>
          <Inbox />
          Open inbox
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy />
          Copy ship id
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const RetiredShip: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <Trigger />
      <DropdownMenuContent>
        <DropdownMenuItem disabled>
          <SquarePen />
          Message this ship
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Copy />
          Copy ship id
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled>
          <Archive />
          Retire ship…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
