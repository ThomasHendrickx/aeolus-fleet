import { ChevronRight, Network } from 'lucide-react';
import Link from 'next/link';

/**
 * On phone, Network is the first row of Settings (docs/design/app-navigation,
 * where the account menu's items go): the tab bar has no room for it. Desktop
 * keeps its sidebar item.
 */
export function NetworkSettingsRow() {
  return (
    <Link
      href="/network"
      data-testid="settings-network"
      className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 text-body-touch font-medium text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring sm:hidden [&_svg]:size-(--size-icon) [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      <Network aria-hidden />
      <span className="grow">Network</span>
      <ChevronRight aria-hidden />
    </Link>
  );
}
