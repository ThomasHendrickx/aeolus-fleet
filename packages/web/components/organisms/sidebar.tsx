'use client';

import { ChevronsUpDown, LogOut, Ship } from 'lucide-react';
import Link from 'next/link';

import { Avatar } from '../atoms/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../atoms/dropdown-menu';

interface SidebarProps {
  /** Signs the operator out; the account menu offers it without a confirm. */
  onSignOut: () => void;
}

/**
 * Desktop navigation (docs/design/png/Sidebar.png): the brand, the
 * destinations and the account menu of the signed-in operator, argo. 256 px
 * from 1024 px; a 64 px rail from 640 to 1023 px, labels kept for assistive
 * technology. Only the fleet overview exists so far, so it is the one
 * destination, without counts.
 */
export function Sidebar({ onSignOut }: SidebarProps) {
  return (
    <aside
      data-slot="sidebar"
      className="sticky top-0 hidden h-dvh w-(--size-rail) shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground sm:flex lg:w-(--size-sidebar)"
    >
      <div className="flex h-(--size-header) items-center gap-2.5 px-4 max-lg:justify-center max-lg:px-0">
        <Avatar kind="app" size={28} />
        <div className="flex flex-col max-lg:sr-only">
          <span className="text-body font-semibold text-foreground">Aeolus</span>
          <span className="text-caption text-muted-foreground">Operator console</span>
        </div>
      </div>
      <nav aria-label="Console" className="flex grow flex-col gap-0.5 px-2.5 py-2">
        <Link
          href="/"
          aria-current="page"
          data-testid="nav-overview"
          className="flex h-(--size-control) items-center gap-2.5 rounded-md px-2.5 text-body text-muted-foreground transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground max-lg:justify-center max-lg:px-0 [&_svg]:size-(--size-icon) [&_svg]:shrink-0"
        >
          <Ship aria-hidden />
          <span className="max-lg:sr-only">Fleet overview</span>
        </Link>
      </nav>
      <div className="border-t border-border p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="account-menu"
            className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors duration-(--duration-fast) outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-accent max-lg:justify-center"
          >
            <Avatar kind="argo" size={28} />
            <span className="flex min-w-0 grow flex-col max-lg:sr-only">
              <span className="truncate text-body font-medium text-foreground">argo</span>
              <span className="truncate text-caption text-muted-foreground">Operator</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground max-lg:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuItem data-testid="account-sign-out" onClick={onSignOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
