import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Archive, Copy, Pencil, RefreshCw } from 'lucide-react';

import { Button } from './button';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet';
import { Skeleton } from './skeleton';

const meta = {
  title: 'Atoms/Sheet',
  component: Sheet,
  decorators: [
    (Story) => (
      <div className="min-h-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SideDesktop: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>One line of context</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3">
          <Skeleton className="h-3 w-52" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </SheetBody>
        <SheetFooter>
          <Button size="sm">Dismiss</Button>
          <Button variant="primary" size="sm" icon={<RefreshCw />}>
            Resend
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

const MENU_ITEM =
  'flex h-13 w-full items-center gap-3.5 border-b border-border px-1.5 text-input-touch text-foreground [&_svg]:size-(--size-icon-lg) [&_svg]:text-muted-foreground';

export const BottomMenuOnPhone: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetContent side="bottom">
        <SheetTitle>reviewer-01</SheetTitle>
        <div className="flex flex-col">
          <button type="button" className={MENU_ITEM}>
            <Copy aria-hidden />
            Copy ship id
          </button>
          <button type="button" className={MENU_ITEM}>
            <Pencil aria-hidden />
            Rename
          </button>
          <button type="button" className={`${MENU_ITEM} text-destructive-text [&_svg]:text-destructive-text`}>
            <Archive aria-hidden />
            Retire ship
          </button>
        </div>
        <SheetFooter>
          <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const BottomConfirmOnPhone: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetContent side="bottom">
        <SheetTitle>Retire planner?</SheetTitle>
        <SheetDescription className="text-body-touch">
          Its inbox is empty, so no deliveries are affected. This can’t be undone.
        </SheetDescription>
        <SheetFooter>
          <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
          <Button variant="destructive" size="touch" className="w-full">
            Retire ship
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};
