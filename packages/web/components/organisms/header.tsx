import { LiveStatus, type LiveState } from '../molecules/live-status';

interface HeaderProps {
  /** The current page's place: "Fleet overview". */
  breadcrumb: string;
  live: LiveState;
}

/**
 * Desktop top bar (docs/design/png/Header.png), 56 px: the breadcrumb and the
 * live connection status, whose dot always has its word. The sidebar toggle,
 * CommandPalette search, Compose and the theme toggle come with the slices that
 * build them.
 */
export function Header({ breadcrumb, live }: HeaderProps) {
  return (
    <header
      data-slot="header"
      className="sticky top-0 z-30 hidden h-(--size-header) shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 sm:flex"
    >
      <p className="truncate text-body font-medium text-foreground">{breadcrumb}</p>
      <LiveStatus state={live} />
    </header>
  );
}
