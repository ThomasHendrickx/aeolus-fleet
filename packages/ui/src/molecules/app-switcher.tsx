'use client';

import { Check, ChevronDown, LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import type { AppSwitcherModel } from '@aeolus-fleet/common/rules';
import { Button } from '../atoms/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../atoms/dropdown-menu.js';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '../atoms/sheet.js';
import { classNames } from '../class-names.js';

interface AppSwitcherProps {
  switcher: AppSwitcherModel;
  /**
   * full: "Acme / Console ▾", the fleet part switching fleet and the app part
   * switching app, each a menu. compact (phone, H6): "Console ▾", one bottom
   * Sheet with the fleets, then the apps.
   */
  layout: 'full' | 'compact';
  className?: string;
}

/** What is opening, once a fleet or an app is chosen: its address and name, so the choice shows it is on its way. */
interface Opening {
  url: string;
  name: string;
}

const triggerClass =
  'inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-body font-semibold text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-accent disabled:opacity-60';

/** A choice's mark: a spinner while it opens, a check on the one in view. */
function Mark({ isCurrent, isOpening }: { isCurrent: boolean; isOpening: boolean }) {
  if (isOpening) {
    return <LoaderCircle aria-hidden className="ml-auto animate-spin motion-reduce:animate-none" />;
  }
  return isCurrent ? <Check aria-hidden className="ml-auto" /> : null;
}

/** One choice in a desktop menu: a link, with "Opening" while the browser goes there. */
function MenuChoice({ url, name, isCurrent, opening, onOpen, testId }: { url: string; name: string; isCurrent: boolean; opening: Opening | undefined; onOpen: (opening: Opening) => void; testId: string }) {
  const isOpening = opening?.url === url && opening.name === name;
  return (
    <DropdownMenuItem
      data-testid={testId}
      data-current={isCurrent || undefined}
      disabled={opening !== undefined && !isOpening}
      closeOnClick={false}
      render={(props) => (
        <a
          {...props}
          href={url}
          aria-current={isCurrent ? 'page' : undefined}
          onClick={(event) => {
            props.onClick?.(event);
            onOpen({ url, name });
          }}
        >
          {props.children}
        </a>
      )}
    >
      <span className="min-w-0 truncate">{isOpening ? `Opening ${name}` : name}</span>
      <Mark isCurrent={isCurrent} isOpening={isOpening} />
    </DropdownMenuItem>
  );
}

/** One choice in the phone's Sheet: a 44 px link, with "Opening" while the browser goes there. */
function SheetChoice({ url, name, isCurrent, opening, onOpen, testId }: { url: string; name: string; isCurrent: boolean; opening: Opening | undefined; onOpen: (opening: Opening) => void; testId: string }) {
  const isOpening = opening?.url === url && opening.name === name;
  return (
    <a
      href={url}
      data-testid={testId}
      aria-current={isCurrent ? 'page' : undefined}
      aria-disabled={opening !== undefined && !isOpening ? true : undefined}
      onClick={(event) => {
        if (opening !== undefined) {
          event.preventDefault();
          return;
        }
        onOpen({ url, name });
      }}
      className="flex h-(--size-control-touch) items-center gap-2.5 rounded-md px-2 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring aria-disabled:opacity-60 [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
    >
      <span className="min-w-0 truncate">{isOpening ? `Opening ${name}` : name}</span>
      <Mark isCurrent={isCurrent} isOpening={isOpening} />
    </a>
  );
}

function SheetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <p className="px-2 text-caption font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * The switcher in the title (header design H1, H6, H8, H9): the fleet in view
 * and the app open. Choosing another fleet or app follows its link; the
 * choice says "Opening ..." with a spinner at once, and the others wait,
 * until the browser leaves. Without anywhere else to go it is plain text,
 * with no ▾.
 */
export function AppSwitcher({ switcher, layout, className }: AppSwitcherProps) {
  const [opening, setOpening] = useState<Opening | undefined>(undefined);
  const { fleet, appLabel, fleets, apps, canSwitch } = switcher;

  if (!canSwitch) {
    return (
      <p data-testid="app-switcher" className={classNames('flex min-w-0 items-center gap-1 px-1.5 text-body font-semibold text-foreground', className)}>
        {layout === 'full' ? (
          <>
            <span className="truncate">{fleet.name}</span>
            <span aria-hidden className="text-muted-foreground">/</span>
          </>
        ) : null}
        <span className="truncate">{appLabel}</span>
      </p>
    );
  }

  if (layout === 'compact') {
    return (
      <Sheet>
        <SheetTrigger data-testid="app-switcher" aria-label={`Switch fleet or app: ${fleet.name}, ${appLabel}`} className={classNames(triggerClass, 'text-title-touch', className)}>
          <span className="truncate">{appLabel}</span>
          {opening === undefined ? <ChevronDown aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground" /> : <LoaderCircle aria-hidden className="size-(--size-icon) shrink-0 animate-spin motion-reduce:animate-none" />}
        </SheetTrigger>
        <SheetContent side="bottom" data-testid="app-switcher-sheet" className="gap-3">
          <SheetTitle className="sr-only">Switch fleet or app</SheetTitle>
          <SheetGroup label="Fleets">
            {fleets.map((choice) => (
              <SheetChoice key={choice.id} url={choice.url} name={choice.name} isCurrent={choice.isCurrent} opening={opening} onOpen={setOpening} testId="app-switcher-fleet" />
            ))}
          </SheetGroup>
          <SheetGroup label="Apps">
            {apps.map((choice) => (
              <SheetChoice key={choice.app} url={choice.url} name={choice.label} isCurrent={choice.isCurrent} opening={opening} onOpen={setOpening} testId="app-switcher-app" />
            ))}
          </SheetGroup>
          <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <nav aria-label="Fleet and app" data-testid="app-switcher" className={classNames('flex min-w-0 items-center gap-0.5', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="app-switcher-fleets" aria-label={`Fleet: ${fleet.name}. Switch fleet`} className={triggerClass}>
          <span className="truncate">{fleet.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Fleets</DropdownMenuLabel>
            {fleets.map((choice) => (
              <MenuChoice key={choice.id} url={choice.url} name={choice.name} isCurrent={choice.isCurrent} opening={opening} onOpen={setOpening} testId="app-switcher-fleet" />
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden className="text-muted-foreground">/</span>
      <DropdownMenu>
        <DropdownMenuTrigger data-testid="app-switcher-apps" aria-label={`App: ${appLabel}. Switch app`} className={triggerClass}>
          <span className="truncate">{appLabel}</span>
          {opening === undefined ? <ChevronDown aria-hidden className="size-(--size-icon-sm) shrink-0 text-muted-foreground" /> : <LoaderCircle aria-hidden className="size-(--size-icon-sm) shrink-0 animate-spin motion-reduce:animate-none" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Apps</DropdownMenuLabel>
            {apps.map((choice) => (
              <MenuChoice key={choice.app} url={choice.url} name={choice.label} isCurrent={choice.isCurrent} opening={opening} onOpen={setOpening} testId="app-switcher-app" />
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
