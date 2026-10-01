import { Ship } from 'lucide-react';
import Link from 'next/link';

/**
 * Phone navigation (docs/design/png/TabBar.png): 68 px including the safe
 * area, the same destinations as Sidebar. The active tab uses --primary for
 * icon and label. Only the fleet overview exists so far.
 */
export function TabBar() {
  return (
    <nav
      aria-label="Console"
      data-slot="tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 flex min-h-(--size-tabbar) border-t border-border bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <Link
        href="/"
        aria-current="page"
        data-testid="tab-fleet"
        className="flex grow flex-col items-center justify-center gap-1 text-micro text-muted-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=page]:font-medium aria-[current=page]:text-primary [&_svg]:size-(--size-icon-tab)"
      >
        <Ship aria-hidden />
        Fleet
      </Link>
    </nav>
  );
}
