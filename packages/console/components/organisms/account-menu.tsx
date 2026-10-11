'use client';

import { ChevronsUpDown, CircleUserRound, CodeXml, Compass, LaptopMinimal, LoaderCircle, LogOut, Monitor, Moon, Network, Settings, Sun, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { classNames } from '../../lib/class-names';
import { SOURCE_URL } from '../../lib/source';
import { sessionSince, THEME_LABELS, type Theme } from '../../lib/theme';
import { Avatar } from '../atoms/avatar';
import { Button } from '../atoms/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../atoms/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '../atoms/sheet';
import { Tabs, TabsList, TabsTrigger } from '../atoms/tabs';

/** This console session: the device it signed in from ("Mac · Chrome") and when. */
interface AccountSession {
  device: string;
  since: string;
}

/**
 * Who is signed in, as the account menu shows them: the operator, with their
 * email and theme; or a viewer, who reads the fleet through the viewer ship and
 * has neither (decision 0022).
 */
export type AccountMenuAccount = { kind: 'operator'; email: string; session: AccountSession; theme: Theme } | { kind: 'viewer'; session: AccountSession };

export interface AccountMenuProps {
  /** Undefined until known: the trigger shows, the session line and theme check wait. */
  account: AccountMenuAccount | undefined;
  /** The themes to offer, in order, as common lists them (handed down by the root layout). */
  themes: readonly Theme[];
  onThemeChange: (theme: Theme) => void;
  onSignOut: () => void;
  isSigningOut: boolean;
  now: Date;
  /** The hosting service's account page (AEOLUS_HOSTED_ACCOUNT_URL): set, the menu offers Your account; unset, it does not. */
  accountUrl?: string;
  /** Opens the installation's guide at its first step (decision 0024); unset while no guide is for the session, so the menu offers no Take the tour. */
  onTakeTour?: () => void;
  /**
   * Where Settings is, for the phone's sheet whenever Settings is offered: the
   * tab bar has no place for it (#245, #503). Desktop keeps Settings in the
   * Sidebar.
   */
  settingsHref?: string;
  /** Where Network is, for the phone's sheet while it is offered (#503). Desktop keeps Network in the Sidebar. */
  networkHref?: string;
}

/** The menu's label for the hosting service's account page. */
const YOUR_ACCOUNT = 'Your account';

/** The menu's label for opening the guide again. */
const TAKE_THE_TOUR = 'Take the tour';

const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** The operator's role is the account's name in v1: one operator per fleet. */
const ROLE = 'Operator';

/** A viewer goes by its ship's name. */
const VIEWER = 'viewer';

/** The name and the line under it, in the trigger: the operator and their email, or the viewer, reading only. */
function whoOf(account: AccountMenuAccount | undefined): { name: string; detail: string } {
  return account?.kind === 'viewer' ? { name: VIEWER, detail: 'Read-only' } : { name: ROLE, detail: account?.email ?? ' ' };
}

/** Whether the account chooses a theme: the operator's does, stored on it; a viewer has none (decision 0022). */
function hasTheme(account: AccountMenuAccount | undefined): boolean {
  return account?.kind !== 'viewer';
}

function themeOf(value: unknown, themes: readonly Theme[]): Theme | undefined {
  return themes.find((theme) => theme === value);
}

/** Who is signed in, and this session: the menu's header on desktop and on phone. */
function AccountHeader({ account, now }: Pick<AccountMenuProps, 'account' | 'now'>) {
  const { name, detail } = whoOf(account);
  return (
    <div className="flex flex-col gap-2 px-2.5 pt-2 pb-2.5">
      <div className="flex items-center gap-2.5">
        <Avatar kind="account" size={28} name={name} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium text-foreground">{name}</span>
          <span data-testid="account-detail" className="truncate text-caption text-muted-foreground">
            {account?.kind === 'viewer' ? 'Sees the whole fleet, changes nothing' : detail}
          </span>
        </span>
      </div>
      <p data-testid="account-session" className="flex items-start gap-1.5 text-caption text-muted-foreground">
        <LaptopMinimal aria-hidden className="mt-px size-(--size-icon-sm) shrink-0" />
        {account ? (
          <span>
            This session: <span className="font-medium text-foreground">{sessionSince(account.session, now)}</span>
          </span>
        ) : (
          <span>This session</span>
        )}
      </p>
    </div>
  );
}

/** The sign-out row's content: a spinner and "Signing out" while it runs. */
function SignOutLabel({ isSigningOut }: { isSigningOut: boolean }) {
  return isSigningOut ? (
    <>
      <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
      Signing out
    </>
  ) : (
    <>
      <LogOut aria-hidden />
      Sign out
    </>
  );
}

/**
 * The account menu on desktop (docs/design/png/AccountMenu.png): the Sidebar's
 * account button opens a DropdownMenu upwards with who is signed in, this
 * session (signing in elsewhere ends it), Your account on a hosted
 * installation, Theme and Sign out without a confirm. On the 64 px rail the
 * button collapses to its avatar.
 */
export function AccountMenu({ account, themes, onThemeChange, onSignOut, isSigningOut, now, accountUrl, onTakeTour }: AccountMenuProps) {
  const { name, detail } = whoOf(account);
  const theme = account?.kind === 'operator' ? account.theme : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="account-menu"
        aria-label={`Account menu, ${name}${account ? `, ${detail}` : ''}`}
        className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors duration-(--duration-fast) outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-expanded:bg-accent max-lg:justify-center"
      >
        <Avatar kind="account" size={28} name={name} />
        <span className="flex min-w-0 grow flex-col max-lg:sr-only">
          <span className="truncate text-body font-medium text-foreground">{name}</span>
          <span className="truncate text-caption text-muted-foreground">{detail}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-(--size-icon) shrink-0 text-muted-foreground max-lg:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <AccountHeader account={account} now={now} />
        {accountUrl === undefined || account?.kind === 'viewer' ? null : (
          <DropdownMenuItem
            data-testid="account-hosted"
            render={(props) => (
              <a {...props} href={accountUrl}>
                {props.children}
              </a>
            )}
          >
            <CircleUserRound aria-hidden />
            {YOUR_ACCOUNT}
          </DropdownMenuItem>
        )}
        {onTakeTour === undefined ? null : (
          <DropdownMenuItem data-testid="account-take-tour" onClick={onTakeTour}>
            <Compass aria-hidden />
            {TAKE_THE_TOUR}
          </DropdownMenuItem>
        )}
        {hasTheme(account) && (
          <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          {/* null, never undefined: undefined until the account is read would leave the group uncontrolled, then controlled once it is (#612). */}
          <DropdownMenuRadioGroup
            value={theme ?? null}
            onValueChange={(value: unknown) => {
              const picked = themeOf(value, themes);
              if (picked !== undefined) {
                onThemeChange(picked);
              }
            }}
          >
            {themes.map((theme) => {
              const Icon = THEME_ICONS[theme];
              return (
                <DropdownMenuRadioItem
                  key={theme}
                  value={theme}
                  disabled={account === undefined}
                  closeOnClick={false}
                  data-testid={`account-theme-${theme}`}
                >
                  <Icon aria-hidden />
                  {THEME_LABELS[theme]}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="account-sign-out"
          disabled={isSigningOut}
          closeOnClick={false}
          onClick={onSignOut}
        >
          <SignOutLabel isSigningOut={isSigningOut} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The account menu on phone: the Avatar, last in the root TopBar, opens the
 * same content as a bottom Sheet, with Theme as a segmented control and
 * Cancel at the bottom.
 */
export function AccountMenuSheet({ account, themes, onThemeChange, onSignOut, isSigningOut, now, accountUrl, onTakeTour, settingsHref, networkHref }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { name, detail } = whoOf(account);
  const theme = account?.kind === 'operator' ? account.theme : undefined;

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        data-testid="account-menu"
        aria-label={`Account menu, ${name}${account ? `, ${detail}` : ''}`}
        className="inline-flex size-(--size-control-touch) shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar kind="account" size={28} name={name} />
      </SheetTrigger>
      <SheetContent side="bottom" data-testid="account-sheet" className="gap-3">
        <SheetTitle className="sr-only">Account</SheetTitle>
        <AccountHeader account={account} now={now} />
        {accountUrl === undefined || account?.kind === 'viewer' ? null : (
          <a
            href={accountUrl}
            data-testid="account-hosted"
            className="flex h-(--size-control-touch) items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
          >
            <CircleUserRound aria-hidden />
            {YOUR_ACCOUNT}
          </a>
        )}
        {onTakeTour === undefined ? null : (
          <button
            type="button"
            data-testid="account-take-tour"
            onClick={() => {
              setIsOpen(false);
              onTakeTour();
            }}
            className="flex h-(--size-control-touch) items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
          >
            <Compass aria-hidden />
            {TAKE_THE_TOUR}
          </button>
        )}
        {networkHref === undefined ? null : (
          <Link
            href={networkHref}
            data-testid="account-network"
            onClick={() => {
              setIsOpen(false);
            }}
            className="flex h-(--size-control-touch) items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
          >
            <Network aria-hidden />
            Network
          </Link>
        )}
        {settingsHref === undefined ? null : (
          <Link
            href={settingsHref}
            data-testid="account-settings"
            onClick={() => {
              setIsOpen(false);
            }}
            className="flex h-(--size-control-touch) items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
          >
            <Settings aria-hidden />
            Settings
          </Link>
        )}
        {hasTheme(account) && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-caption text-muted-foreground">Theme</p>
          {/* null, never undefined: Tabs left without a value choose a tab by themselves and send it as a theme write, as when signing out clears the account (#583). */}
          <Tabs
            value={theme ?? null}
            onValueChange={(value: unknown) => {
              const picked = themeOf(value, themes);
              if (picked !== undefined) {
                onThemeChange(picked);
              }
            }}
          >
            <TabsList aria-label="Theme" className="w-full">
              {themes.map((theme) => {
                const Icon = THEME_ICONS[theme];
                return (
                  <TabsTrigger
                    key={theme}
                    value={theme}
                    disabled={account === undefined}
                    data-testid={`account-theme-${theme}`}
                    className="grow"
                  >
                    <Icon aria-hidden />
                    {THEME_LABELS[theme]}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>
        )}
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="account-source"
          className="flex h-(--size-control-touch) items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground"
        >
          <CodeXml aria-hidden />
          Source on GitHub
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button
          type="button"
          data-testid="account-sign-out"
          disabled={isSigningOut}
          onClick={onSignOut}
          className={classNames(
            'flex h-(--size-control-touch) items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground',
          )}
        >
          <SignOutLabel isSigningOut={isSigningOut} />
        </button>
        <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
