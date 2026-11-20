'use client';

import { Box, CircleCheck, DoorOpen, Layers, LayoutGrid, LoaderCircle, Ship, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import type { FleetId, HeaderApp } from '@aeolus-fleet/common';
import type { AppSwitcherModel, SwitcherApp, SwitcherFleet } from '@aeolus-fleet/common/rules';
import { Button } from '../atoms/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../atoms/dropdown-menu.js';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '../atoms/sheet.js';
import { Skeleton } from '../atoms/skeleton.js';
import { classNames } from '../class-names.js';

/** Why an app of the list cannot be opened from here: its tile stays, greyed, with no link. */
export type AppAccess = 'unavailable' | 'sign-in-required';

/** A session that reaches the app open alone: the panel explains why there is nowhere else to go. */
export type AppsAndFleetsLimit = 'single-app' | 'argo' | 'viewer';

/** Where the app's read of the apps and fleets stands. */
export type AppsAndFleetsRead = 'loaded' | 'loading' | 'retrying' | 'failed' | 'refreshed';

/** A fleet the person chose: on its way, failed, or on its way again after Try again. */
export interface FleetSwitch {
  fleetId: FleetId;
  state: 'opening' | 'failed' | 'retrying';
}

/** What the app knows about the apps and fleets beyond the list itself, and what it does when one is chosen. */
export interface AppsAndFleetsState {
  read?: AppsAndFleetsRead;
  limit?: AppsAndFleetsLimit;
  appAccess?: Partial<Record<HeaderApp, AppAccess>>;
  fleetSwitch?: FleetSwitch;
  /** Opens a fleet the app's own way; unset, a fleet row is a plain link and says it is opening until the browser leaves. */
  onOpenFleet?: (fleet: SwitcherFleet) => void;
  /** Reads the apps and fleets again, after a read failure or an unavailable app. */
  onRetry?: () => void;
  /** The existing shared sign-in, for an app whose sign-in expired. */
  onSignIn?: () => void;
  isSigningIn?: boolean;
}

interface AppSwitcherProps {
  switcher: AppSwitcherModel;
  /** menu: the panel under the launcher (desktop). sheet: a bottom Sheet with 44 px targets and Cancel (phone). */
  layout: 'menu' | 'sheet';
  state?: AppsAndFleetsState;
  className?: string;
}

const APP_ICONS: Record<HeaderApp, LucideIcon> = { console: Ship, gateway: DoorOpen, account: Box, admin: Box };

const ACCESS_LABELS: Record<AppAccess, string> = { unavailable: 'Unavailable', 'sign-in-required': 'Sign-in required' };

/** How far a tile row reaches: three tiles to a row. */
const TILES_PER_ROW = 3;

const TILE_STEPS: Partial<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: TILES_PER_ROW, ArrowUp: -TILES_PER_ROW };

const spin = 'animate-spin motion-reduce:animate-none';

/**
 * One tab stop for a group: the arrow keys move between its items, the
 * focused one keeping the tab stop. Tiles move by one and by a row; fleet
 * rows move up and down, Home and End jump to the ends.
 */
interface Step {
  key: string;
  at: number;
  count: number;
}

function moveWithin(event: KeyboardEvent<HTMLElement>, group: { selector: string; stepOf: (step: Step) => number | undefined }) {
  const { selector, stepOf } = group;
  const items = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(selector) ?? [])].filter((item) => item.getAttribute('aria-disabled') !== 'true');
  const at = items.findIndex((item) => item === document.activeElement);
  const to = at < 0 ? undefined : stepOf({ key: event.key, at, count: items.length });
  if (to === undefined) {
    return;
  }
  // The panel's own list navigation never sees the key: these items are no menu items.
  event.preventDefault();
  event.stopPropagation();
  const target = items[Math.min(items.length - 1, Math.max(0, to))];
  for (const item of items) {
    item.tabIndex = item === target ? 0 : -1;
  }
  target?.focus();
}

function tileStepOf({ key, at }: Step): number | undefined {
  const step = TILE_STEPS[key];
  return step === undefined ? undefined : at + step;
}

function rowStepOf({ key, at, count }: Step): number | undefined {
  const steps: Partial<Record<string, number>> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: count - 1 };
  return steps[key];
}

/** A plain press, which the app handles; a press with a modifier opens the link the browser's way. */
function isPlainPress(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A notice in the panel; a failure has the warning icon, and is announced at once unless its retry already runs. */
function Notice({ title, isError = false, isAnnounced = isError, children }: { title: string; isError?: boolean; isAnnounced?: boolean; children: ReactNode }) {
  return (
    <div role={isAnnounced ? 'alert' : undefined} className="m-2 flex flex-col gap-2 rounded-md bg-muted p-3 text-body text-foreground">
      <p className="flex items-center gap-2 font-medium">
        {isError ? <TriangleAlert aria-hidden className="size-(--size-icon) shrink-0 text-destructive-text" /> : null}
        {title}
      </p>
      {children}
    </div>
  );
}

function NoticeText({ children }: { children: ReactNode }) {
  return <p className="text-meta text-muted-foreground">{children}</p>;
}

function SectionHead({ id, Icon, label, context }: { id: string; Icon: LucideIcon; label: string; context?: string }) {
  return (
    <>
      <div className="flex items-center gap-2 px-2 pt-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase [&_svg]:size-(--size-icon-sm)">
        <Icon aria-hidden />
        <h3 id={id}>{label}</h3>
      </div>
      {context === undefined ? null : <p className="px-2 pb-3 text-caption text-muted-foreground">{context}</p>}
    </>
  );
}

/** The status line under a section: what is on its way, announced. */
function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" data-testid="app-switcher-status" className="px-2 pt-1 pb-2 text-caption text-muted-foreground">
      {children}
    </p>
  );
}

interface PanelProps {
  switcher: AppSwitcherModel;
  state: AppsAndFleetsState;
  fleetSwitch: FleetSwitch | undefined;
  openingApp: HeaderApp | undefined;
  isPhone: boolean;
  onOpenApp: (app: SwitcherApp) => void;
  onOpenFleet: (fleet: SwitcherFleet, event: MouseEvent) => void;
  onChooseCurrent: (name: string) => void;
}

function AppTile({ app, access, isOpening, isWaiting, isPhone, onOpen, onChooseCurrent }: { app: SwitcherApp; access: AppAccess | undefined; isOpening: boolean; isWaiting: boolean; isPhone: boolean; onOpen: () => void; onChooseCurrent: () => void }) {
  const Icon = APP_ICONS[app.app];
  const tileClass = classNames(
    'flex flex-col items-center gap-1.5 rounded-md border border-transparent px-1 pt-3 pb-2 text-center outline-none focus-visible:outline-2 focus-visible:outline-ring',
    isPhone ? 'min-h-26' : 'min-h-23',
  );
  const iconClass = classNames('grid place-items-center rounded-lg [&_svg]:size-(--size-icon-lg)', isPhone ? 'size-12' : 'size-10');
  const nameClass = classNames('font-medium [overflow-wrap:anywhere]', isPhone ? 'text-body-touch' : 'text-body');
  if (access !== undefined) {
    return (
      <div data-testid="app-switcher-app" data-name={app.label} data-access={access} aria-label={`${app.label}, ${ACCESS_LABELS[access]}`} role="img" className={classNames(tileClass, 'text-muted-foreground')}>
        <span aria-hidden className={classNames(iconClass, 'bg-muted text-muted-foreground')}>
          <Icon />
        </span>
        <span aria-hidden className={nameClass}>{app.label}</span>
        <span aria-hidden className="min-h-4 text-caption">{ACCESS_LABELS[access]}</span>
      </div>
    );
  }
  const caption = isOpening ? 'Opening' : app.isCurrent ? 'Current' : '';
  return (
    <a
      href={app.url}
      data-testid="app-switcher-app"
      data-name={app.label}
      data-current={app.isCurrent || undefined}
      aria-current={app.isCurrent ? 'page' : undefined}
      aria-disabled={isWaiting || undefined}
      aria-label={isOpening ? `Opening ${app.label}` : app.isCurrent ? `${app.label}, current app` : app.label}
      tabIndex={app.isCurrent ? 0 : -1}
      onKeyDown={(event) => {
        moveWithin(event, { selector: '[data-testid="app-switcher-app"][href]', stepOf: tileStepOf });
      }}
      onClick={(event) => {
        if (isWaiting) {
          event.preventDefault();
          return;
        }
        if (app.isCurrent) {
          event.preventDefault();
          onChooseCurrent();
          return;
        }
        onOpen();
      }}
      className={classNames(tileClass, app.isCurrent ? 'border-border bg-highlight' : 'hover:bg-accent', 'aria-disabled:opacity-60')}
    >
      <span aria-hidden className={classNames(iconClass, app.isCurrent ? 'bg-primary text-primary-foreground' : 'bg-secondary text-primary')}>
        <Icon />
      </span>
      <span className={classNames(nameClass, 'text-foreground')}>{app.label}</span>
      <span className={classNames('inline-flex min-h-4 items-center gap-1 text-caption', app.isCurrent ? 'font-medium text-primary' : 'text-muted-foreground')}>
        {isOpening ? <LoaderCircle aria-hidden data-testid="app-switcher-busy" className={classNames('size-(--size-icon-sm)', spin)} /> : null}
        {caption}
      </span>
    </a>
  );
}

function FleetRow({ fleet, isOpening, isWaiting, isPhone, onOpen, onChooseCurrent }: { fleet: SwitcherFleet; isOpening: boolean; isWaiting: boolean; isPhone: boolean; onOpen: (event: MouseEvent) => void; onChooseCurrent: () => void }) {
  return (
    <a
      href={fleet.url}
      data-testid="app-switcher-fleet"
      data-name={fleet.name}
      data-current={fleet.isCurrent || undefined}
      aria-current={fleet.isCurrent ? 'page' : undefined}
      aria-disabled={isWaiting || undefined}
      aria-busy={isOpening || undefined}
      tabIndex={fleet.isCurrent ? 0 : -1}
      onKeyDown={(event) => {
        moveWithin(event, { selector: '[data-testid="app-switcher-fleet"]', stepOf: rowStepOf });
      }}
      onClick={(event) => {
        if (isWaiting || isOpening) {
          event.preventDefault();
          return;
        }
        if (fleet.isCurrent) {
          event.preventDefault();
          onChooseCurrent();
          return;
        }
        onOpen(event);
      }}
      className={classNames(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring aria-disabled:opacity-60 [&_svg]:size-(--size-icon) [&_svg]:shrink-0',
        isPhone ? 'min-h-(--size-control-touch) text-body-touch' : 'min-h-(--size-control) text-body',
        fleet.isCurrent || isOpening ? 'bg-accent' : 'hover:bg-accent',
      )}
    >
      <Layers aria-hidden />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{isOpening ? `Opening ${fleet.name}` : fleet.name}</span>
      {isOpening ? (
        <LoaderCircle aria-hidden data-testid="app-switcher-busy" className={classNames('text-muted-foreground', spin)} />
      ) : fleet.isCurrent ? (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-caption text-primary [&_svg]:size-(--size-icon-sm)">
          <CircleCheck aria-hidden />
          <span aria-hidden>Current</span>
          <span className="sr-only">Current fleet</span>
        </span>
      ) : null}
    </a>
  );
}

function LimitNotice({ limit, appLabel, fleetName }: { limit: AppsAndFleetsLimit; appLabel: string; fleetName: string }) {
  const words: Record<AppsAndFleetsLimit, { title: string; text: string }> = {
    'single-app': { title: 'No other apps', text: `Only ${appLabel} is configured in this installation. There are no other apps to open.` },
    argo: { title: 'Signed in as argo', text: `This sign-in is for ${appLabel} in ${fleetName}. Other apps require an account sign-in. Bridge does not accept an argo sign-in.` },
    viewer: { title: 'Viewer', text: `This viewer sign-in is for ${appLabel} in ${fleetName}. Other apps are not supplied for this session. Bridge requires an account.` },
  };
  return (
    <Notice title={words[limit].title}>
      <NoticeText>{words[limit].text}</NoticeText>
      <NoticeText>{`You can keep using this ${appLabel} session.`}</NoticeText>
    </Notice>
  );
}

function RetryButton({ isRetrying, onRetry, testId, shouldFocusOnMount = false }: { isRetrying: boolean; onRetry: (() => void) | undefined; testId: string; shouldFocusOnMount?: boolean }) {
  if (onRetry === undefined) {
    return null;
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      data-testid={testId}
      isLoading={isRetrying}
      onClick={onRetry}
      className="self-start"
      // A failed choice puts focus on its next step, as the design's walk says.
      ref={shouldFocusOnMount ? (node: HTMLButtonElement | null) => node?.focus() : undefined}
    >
      Try again
    </Button>
  );
}

function LoadingPanel({ isPhone, isRetrying, onRetry }: { isPhone: boolean; isRetrying: boolean; onRetry: (() => void) | undefined }) {
  return (
    <div data-testid="app-switcher-loading" className="flex flex-col">
      <SectionHead id="app-switcher-apps-heading" Icon={LayoutGrid} label="Apps" />
      <div className={classNames('grid grid-cols-3 px-1 pt-2 pb-2', isPhone ? 'gap-2' : 'gap-1')}>
        {['first', 'second', 'third', 'fourth'].map((key) => (
          <span key={key} className="flex min-h-23 flex-col items-center gap-2 pt-3">
            <Skeleton className={classNames('rounded-lg', isPhone ? 'size-12' : 'size-10')} />
            <Skeleton className="h-3 w-3/5" />
          </span>
        ))}
      </div>
      <hr className="my-2 border-border" />
      <SectionHead id="app-switcher-fleets-heading" Icon={Layers} label="Fleets" />
      <Skeleton className={classNames('mx-2 mt-3', isPhone ? 'h-(--size-control-touch)' : 'h-4')} />
      <Skeleton className={classNames('mx-2 mt-3 w-3/5', isPhone ? 'h-(--size-control-touch)' : 'h-4')} />
      <StatusLine>Loading apps and fleets…</StatusLine>
      {isRetrying ? (
        <div className="px-2 pb-2">
          <RetryButton isRetrying onRetry={onRetry} testId="app-switcher-retry" />
        </div>
      ) : null}
    </div>
  );
}

/** The panel's two sections, or the shape of what is coming, or the read failure. */
function Panel({ switcher, state, fleetSwitch, openingApp, isPhone, onOpenApp, onOpenFleet, onChooseCurrent }: PanelProps) {
  const { read = 'loaded', limit, appAccess = {}, onRetry, onSignIn, isSigningIn = false } = state;
  const { fleet, appLabel, apps, fleets } = switcher;
  if (read === 'loading' || read === 'retrying') {
    return <LoadingPanel isPhone={isPhone} isRetrying={read === 'retrying'} onRetry={onRetry} />;
  }
  if (read === 'failed') {
    return (
      <Notice title="Couldn’t load apps and fleets" isError>
        <NoticeText>Your current page is still open. Try again to load them.</NoticeText>
        <RetryButton isRetrying={false} onRetry={onRetry} testId="app-switcher-retry" />
      </Notice>
    );
  }
  const switchTarget = fleetSwitch === undefined ? undefined : fleets.find((choice) => choice.id === fleetSwitch.fleetId);
  const isSwitching = fleetSwitch !== undefined && fleetSwitch.state !== 'failed';
  const unavailable = apps.find((app) => appAccess[app.app] === 'unavailable');
  const expired = apps.find((app) => appAccess[app.app] === 'sign-in-required');
  const isOnlyFleet = fleets.length === 1;
  return (
    <>
      <section aria-labelledby="app-switcher-apps-heading">
        <SectionHead id="app-switcher-apps-heading" Icon={LayoutGrid} label="Apps" context={`Apps you can open in ${fleet.name}`} />
        <div
          role="group"
          aria-labelledby="app-switcher-apps-heading"
          className={classNames('grid grid-cols-3 px-1 pb-2', isPhone ? 'gap-2' : 'gap-1')}
        >
          {apps.map((app) => (
            <AppTile
              key={app.app}
              app={app}
              access={appAccess[app.app]}
              isOpening={openingApp === app.app}
              isWaiting={(openingApp !== undefined && openingApp !== app.app) || isSwitching}
              isPhone={isPhone}
              onOpen={() => {
                onOpenApp(app);
              }}
              onChooseCurrent={() => {
                onChooseCurrent(app.label);
              }}
            />
          ))}
        </div>
        {openingApp === undefined ? null : <StatusLine>{`Opening ${appLabelOf(apps, openingApp)}…`}</StatusLine>}
        {limit === undefined ? null : <LimitNotice limit={limit} appLabel={appLabel} fleetName={fleet.name} />}
        {unavailable === undefined ? null : (
          <Notice title={`Couldn’t open ${unavailable.label}`} isError>
            <NoticeText>{`This app is no longer available. You are still in ${appLabel}. Try again to refresh the apps.`}</NoticeText>
            <RetryButton isRetrying={false} onRetry={onRetry} testId="app-switcher-retry" />
          </Notice>
        )}
        {expired === undefined ? null : (
          <Notice title="Your sign-in has expired" isError>
            <NoticeText>{`Sign in again to open ${expired.label}. The current page remains visible, but does not prove you still have access.`}</NoticeText>
            {onSignIn === undefined ? null : (
              <Button size="sm" data-testid="app-switcher-sign-in" isLoading={isSigningIn} onClick={onSignIn} className="self-start">
                Sign in
              </Button>
            )}
          </Notice>
        )}
      </section>
      <hr className="my-2 border-border" />
      <section aria-labelledby="app-switcher-fleets-heading">
        <SectionHead id="app-switcher-fleets-heading" Icon={Layers} label="Fleets" context={isOnlyFleet ? 'This is the only fleet you can open.' : `Choose a fleet. You stay in ${appLabel} where that fleet has it.`} />
        <div
          role="group"
          aria-labelledby="app-switcher-fleets-heading"
          className="flex flex-col gap-0.5"
        >
          {fleets.map((choice) => {
            const isOpening = isSwitching && choice.id === fleetSwitch.fleetId;
            return (
              <FleetRow
                key={choice.id}
                fleet={choice}
                isOpening={isOpening}
                isWaiting={(isSwitching && !isOpening) || openingApp !== undefined}
                isPhone={isPhone}
                onOpen={(event) => {
                  onOpenFleet(choice, event);
                }}
                onChooseCurrent={() => {
                  onChooseCurrent(choice.name);
                }}
              />
            );
          })}
        </div>
        {switchTarget !== undefined && fleetSwitch !== undefined && fleetSwitch.state !== 'opening' ? (
          <Notice title={`Couldn’t open ${switchTarget.name}`} isError isAnnounced={fleetSwitch.state === 'failed'}>
            <NoticeText>{`You are still in ${fleet.name}. Try again to open ${switchTarget.name}.`}</NoticeText>
            <RetryButton
              isRetrying={fleetSwitch.state === 'retrying'}
              onRetry={() => {
                state.onOpenFleet?.(switchTarget);
              }}
              testId="app-switcher-fleet-retry"
              shouldFocusOnMount={fleetSwitch.state === 'failed'}
            />
          </Notice>
        ) : null}
        {isSwitching && switchTarget !== undefined ? <StatusLine>{`Opening ${switchTarget.name}…`}</StatusLine> : null}
        {read === 'refreshed' ? <StatusLine>Apps and fleets refreshed.</StatusLine> : null}
      </section>
    </>
  );
}

function appLabelOf(apps: readonly SwitcherApp[], app: HeaderApp): string {
  return apps.find((choice) => choice.app === app)?.label ?? app;
}

/** The app open and the fleet in view, after the launcher: the fleet in a quiet pill, busy while another fleet opens. */
function WhereYouAre({ switcher, isSwitching, isPhone }: { switcher: AppSwitcherModel; isSwitching: boolean; isPhone: boolean }) {
  const app = switcher.apps.find((choice) => choice.isCurrent)?.app;
  const Icon = app === undefined ? Box : APP_ICONS[app];
  return (
    <>
      <span data-testid="app-switcher-app-name" className={classNames('inline-flex min-w-0 shrink-0 items-center gap-2 font-semibold text-foreground [&_svg]:size-(--size-icon) [&_svg]:text-primary', isPhone ? 'text-body-touch' : 'text-body')}>
        {isPhone ? null : <Icon aria-hidden />}
        <span>{switcher.appLabel}</span>
      </span>
      <span
        data-testid="app-switcher-fleet-pill"
        title={`Fleet: ${switcher.fleet.name}`}
        aria-busy={isSwitching || undefined}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-meta font-medium text-foreground [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0"
      >
        {isSwitching ? <LoaderCircle aria-hidden data-testid="app-switcher-busy" className={spin} /> : <Layers aria-hidden />}
        <span className="sr-only">Fleet: </span>
        <span className={classNames('truncate', isPhone ? 'max-w-24' : 'max-w-55')}>{switcher.fleet.name}</span>
      </span>
    </>
  );
}

/**
 * The start of every Aeolus bar (docs/design/app-navigation, section 4): the
 * launcher, which opens the one Apps and fleets panel, then the app open and
 * the fleet in view. The panel holds the apps as tiles, the current one
 * marked, and the fleets as rows, the current one checked. Choosing an app
 * follows its link and says "Opening" until the browser leaves; choosing a
 * fleet hands it to the app, which says through `state` whether it opens,
 * failed, or opens again after Try again. When the fleet in view changes the
 * panel closes. Desktop opens the panel under the launcher, phone as a
 * bottom Sheet.
 */
export function AppSwitcher({ switcher, layout, state = {}, className }: AppSwitcherProps) {
  // The fleet the panel was opened in: open while it is still the fleet in view, so arriving in another fleet closes it.
  const [openedIn, setOpenedIn] = useState<FleetId | undefined>(undefined);
  const [openingApp, setOpeningApp] = useState<HeaderApp | undefined>(undefined);
  const [openingFleet, setOpeningFleet] = useState<FleetId | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');
  const isOpen = openedIn === switcher.fleet.id;
  const isPhone = layout === 'sheet';
  const fleetSwitch = state.fleetSwitch ?? (openingFleet === undefined ? undefined : { fleetId: openingFleet, state: 'opening' as const });
  const isSwitching = fleetSwitch !== undefined && fleetSwitch.state !== 'failed';

  const onOpenChange = (isOpening: boolean) => {
    setOpenedIn(isOpening ? switcher.fleet.id : undefined);
    setAnnouncement(isOpening ? 'Apps and fleets opened' : '');
  };
  const panel = (
    <Panel
      switcher={switcher}
      state={state}
      fleetSwitch={fleetSwitch}
      openingApp={openingApp}
      isPhone={isPhone}
      onOpenApp={(app) => {
        setOpeningApp(app.app);
      }}
      onOpenFleet={(fleet, event) => {
        if (state.onOpenFleet === undefined) {
          setOpeningFleet(fleet.id);
          return;
        }
        if (isPlainPress(event)) {
          event.preventDefault();
          state.onOpenFleet(fleet);
        }
      }}
      onChooseCurrent={(name) => {
        setOpenedIn(undefined);
        setAnnouncement(`${name} is already open`);
      }}
    />
  );
  const launcherClass = classNames(
    'grid shrink-0 place-items-center rounded-md text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-accent [&_svg]:size-(--size-icon)',
    isPhone ? 'size-(--size-control-touch)' : 'size-(--size-control)',
  );

  return (
    <div data-testid="app-switcher" className={classNames('flex min-w-0 items-center', isPhone ? 'gap-1' : 'gap-3', className)}>
      {isPhone ? (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
          <SheetTrigger data-testid="app-switcher-launcher" aria-label="Apps and fleets" title="Apps and fleets" className={launcherClass}>
            <LayoutGrid aria-hidden />
          </SheetTrigger>
          <SheetContent side="bottom" data-testid="app-switcher-panel" className="gap-1 overflow-y-auto">
            <SheetTitle className="in-data-[side=bottom]:text-heading-touch">Apps and fleets</SheetTitle>
            {panel}
            <SheetClose render={<Button size="touch" variant="secondary" className="mt-2 w-full shrink-0" />}>Cancel</SheetClose>
          </SheetContent>
        </Sheet>
      ) : (
        <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
          <DropdownMenuTrigger data-testid="app-switcher-launcher" aria-label="Apps and fleets" title="Apps and fleets" className={launcherClass}>
            <LayoutGrid aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={8} role="dialog" aria-labelledby="app-switcher-title" data-testid="app-switcher-panel" className="w-86 p-2">
            <h2 id="app-switcher-title" className="p-2 text-body font-semibold text-foreground">
              Apps and fleets
            </h2>
            {panel}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <WhereYouAre switcher={switcher} isSwitching={isSwitching} isPhone={isPhone} />
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
