'use client';

import { BellRing, CircleHelp, CircleUserRound, Keyboard, LaptopMinimal, LoaderCircle, LogOut, Monitor, Moon, ShieldCheck, Sun, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import type { Theme } from '@aeolus-fleet/common';
import { signedInAsOf, type SignedInAs } from './signed-in-as.js';
import { shownEntryOf, type AvatarMenuEntry } from './avatar-entry.js';
import { Avatar } from '../atoms/avatar.js';
import { Button } from '../atoms/button.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../atoms/dialog.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../atoms/dropdown-menu.js';
import { Kbd } from '../atoms/kbd.js';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '../atoms/sheet.js';
import { classNames } from '../class-names.js';

/** A keyboard shortcut the app offers, for the Keyboard shortcuts dialog: its keys in order and what it does. */
export interface Shortcut {
  keys: readonly string[];
  label: string;
}

export interface AvatarMenuProps {
  /** The account's name; undefined until known, or for argo's sign-in and the viewer, which go by those names. */
  name: string | undefined;
  /** How someone is signed in here (H10); undefined until known. */
  signedInAs: SignedInAs | undefined;
  /** This session, as the app words it ("Device · Mac · Chrome, since 08:02"); unset, no session line. */
  session?: string;
  /** Account's address from the apps list: set, the menu offers Your account, Your rights and Email updates (H8). */
  accountUrl?: string;
  /** The theme chosen; undefined while unknown, or for a sign-in that has none (the viewer). */
  theme: Theme | undefined;
  themes: readonly Theme[];
  /** Whether the menu offers the theme at all. */
  hasTheme: boolean;
  onThemeChange: (theme: Theme) => void;
  shortcuts: readonly Shortcut[];
  helpUrl: string;
  onSignOut: () => void;
  isSigningOut: boolean;
  entries?: readonly AvatarMenuEntry[];
}

const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** The account's own pages in Account, from its address there. */
function accountPagesOf(accountUrl: string): { key: string; label: string; href: string; Icon: LucideIcon }[] {
  return [
    { key: 'account', label: 'Your account', href: accountUrl, Icon: CircleUserRound },
    { key: 'rights', label: 'Your rights', href: `${accountUrl}/rights`, Icon: ShieldCheck },
    { key: 'updates', label: 'Email updates', href: `${accountUrl}/updates`, Icon: BellRing },
  ];
}

/** The name the avatar shows: the account's, or argo or the viewer by their own. */
function displayNameOf(name: string | undefined, signedInAs: SignedInAs | undefined): string {
  if (name !== undefined) {
    return name;
  }
  return signedInAs === 'viewer' ? 'viewer' : signedInAs === 'argo' ? 'argo' : ' ';
}

function themeOf(value: unknown, themes: readonly Theme[]): Theme | undefined {
  return themes.find((theme) => theme === value);
}

/** Who is signed in here, and how (H10), with this session when the app words it. */
function WhoHeader({ name, signedInAs, session }: Pick<AvatarMenuProps, 'name' | 'signedInAs' | 'session'>) {
  const shown = displayNameOf(name, signedInAs);
  return (
    <div className="flex shrink-0 flex-col gap-2 px-2.5 pt-2 pb-2.5">
      <div className="flex items-center gap-2.5">
        <Avatar kind={signedInAs === 'argo' ? 'argo' : 'account'} size={28} name={shown} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium text-foreground">{shown}</span>
          <span data-testid="avatar-menu-signed-in-as" className="truncate text-caption text-muted-foreground">
            {signedInAs === undefined ? ' ' : signedInAsOf(signedInAs)}
          </span>
        </span>
      </div>
      {session === undefined ? null : (
        <p data-testid="avatar-menu-session" className="flex items-start gap-1.5 text-caption text-muted-foreground">
          <LaptopMinimal aria-hidden className="mt-px size-(--size-icon-sm) shrink-0" />
          <span>This session: <span className="font-medium text-foreground">{session}</span></span>
        </p>
      )}
    </div>
  );
}

/** An entry's icon and label, or a spinner and its working label while its work runs. */
function EntryContent({ entry }: { entry: AvatarMenuEntry }) {
  const shown = shownEntryOf(entry);
  return (
    <>
      {shown.isWorking ? <LoaderCircle aria-hidden data-testid="avatar-menu-entry-spinner" className="animate-spin motion-reduce:animate-none" /> : entry.icon}
      {shown.label}
    </>
  );
}

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

/** The app's keyboard shortcuts, desktop only: phone has no Kbd hints (H6). */
function ShortcutsDialog({ isOpen, onOpenChange, shortcuts }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; shortcuts: readonly Shortcut[] }) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="avatar-menu-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>What the keys do here.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4 text-body text-foreground">
              {shortcut.label}
              <span className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The avatar menu on desktop (header design H8, H10, H13): the avatar opens a
 * DropdownMenu with who is signed in here and how, the account's own pages
 * in Account, the app's entries, the theme (applied at once), keyboard
 * shortcuts, help and sign out, which shows "Signing out" until it ends.
 */
export function AvatarMenu(props: AvatarMenuProps) {
  const { name, signedInAs, accountUrl, theme, themes, hasTheme, onThemeChange, shortcuts, helpUrl, onSignOut, isSigningOut, entries = [] } = props;
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const shown = displayNameOf(name, signedInAs);
  const label = `Account menu, ${shown}${signedInAs === undefined ? '' : `, ${signedInAsOf(signedInAs)}`}`;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="avatar-menu"
          aria-label={label}
          className="inline-flex size-(--size-control) shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Avatar kind={signedInAs === 'argo' ? 'argo' : 'account'} size={28} name={shown} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <WhoHeader name={name} signedInAs={signedInAs} session={props.session} />
          {accountUrl === undefined
            ? null
            : accountPagesOf(accountUrl).map(({ key, label: pageLabel, href, Icon }) => (
                <DropdownMenuItem
                  key={key}
                  data-testid={`avatar-menu-${key}`}
                  render={(itemProps) => (
                    <a {...itemProps} href={href}>
                      {itemProps.children}
                    </a>
                  )}
                >
                  <Icon aria-hidden />
                  {pageLabel}
                </DropdownMenuItem>
              ))}
          {entries
            .filter((entry) => entry.isPhoneOnly !== true)
            .map((entry) => (
              <DropdownMenuItem
                key={entry.key}
                data-testid={`avatar-menu-${entry.key}`}
                disabled={shownEntryOf(entry).isWorking}
                closeOnClick={shownEntryOf(entry).shouldCloseMenu}
                onClick={entry.onSelect}
                {...(entry.href === undefined
                  ? {}
                  : {
                      render: (itemProps) => (
                        <a {...itemProps} href={entry.href}>
                          {itemProps.children}
                        </a>
                      ),
                    })}
              >
                <EntryContent entry={entry} />
              </DropdownMenuItem>
            ))}
          {hasTheme ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                {/* null, never undefined: undefined until the theme is known would leave the group uncontrolled, then controlled once it is. */}
                <DropdownMenuRadioGroup
                  value={theme ?? null}
                  onValueChange={(value: unknown) => {
                    const picked = themeOf(value, themes);
                    if (picked !== undefined) {
                      onThemeChange(picked);
                    }
                  }}
                >
                  {themes.map((option) => {
                    const Icon = THEME_ICONS[option];
                    return (
                      <DropdownMenuRadioItem key={option} value={option} disabled={theme === undefined} closeOnClick={false} data-testid={`avatar-menu-theme-${option}`}>
                        <Icon aria-hidden />
                        {THEME_LABELS[option]}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="avatar-menu-shortcuts"
            onClick={() => {
              setIsShortcutsOpen(true);
            }}
          >
            <Keyboard aria-hidden />
            Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="avatar-menu-help"
            render={(itemProps) => (
              <a {...itemProps} href={helpUrl} target="_blank" rel="noreferrer">
                {itemProps.children}
              </a>
            )}
          >
            <CircleHelp aria-hidden />
            Help
            <span className="sr-only"> (opens in a new tab)</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="avatar-menu-sign-out" disabled={isSigningOut} closeOnClick={false} onClick={onSignOut}>
            <SignOutLabel isSigningOut={isSigningOut} />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShortcutsDialog isOpen={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} shortcuts={shortcuts} />
    </>
  );
}

const rowClass =
  'flex shrink-0 h-(--size-control-touch) w-full items-center gap-2.5 border-t border-border pt-3 text-body-touch text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 [&_svg]:size-(--size-icon) [&_svg]:text-muted-foreground';

/**
 * The avatar menu on phone (H6): the avatar opens the same content as a
 * bottom Sheet, with the app's phone-only entries for what its tab bar
 * lacks, the theme as three buttons, and Cancel. No keyboard shortcuts on
 * phone.
 */
export function AvatarMenuSheet(props: AvatarMenuProps) {
  const { name, signedInAs, accountUrl, theme, themes, hasTheme, onThemeChange, helpUrl, onSignOut, isSigningOut, entries = [] } = props;
  const [isOpen, setIsOpen] = useState(false);
  const shown = displayNameOf(name, signedInAs);
  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        data-testid="avatar-menu"
        aria-label={`Account menu, ${shown}${signedInAs === undefined ? '' : `, ${signedInAsOf(signedInAs)}`}`}
        className="inline-flex size-(--size-control-touch) shrink-0 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar kind={signedInAs === 'argo' ? 'argo' : 'account'} size={28} name={shown} />
      </SheetTrigger>
      <SheetContent side="bottom" data-testid="avatar-menu-sheet" className="gap-3 overflow-y-auto">
        <SheetTitle className="sr-only">Account</SheetTitle>
        <WhoHeader name={name} signedInAs={signedInAs} session={props.session} />
        {accountUrl === undefined
          ? null
          : accountPagesOf(accountUrl).map(({ key, label, href, Icon }) => (
              <a key={key} href={href} data-testid={`avatar-menu-${key}`} className={rowClass}>
                <Icon aria-hidden />
                {label}
              </a>
            ))}
        {entries.map((entry) =>
          entry.href === undefined ? (
            <button
              key={entry.key}
              type="button"
              data-testid={`avatar-menu-${entry.key}`}
              className={rowClass}
              disabled={shownEntryOf(entry).isWorking}
              onClick={() => {
                if (shownEntryOf(entry).shouldCloseMenu) {
                  setIsOpen(false);
                }
                entry.onSelect?.();
              }}
            >
              <EntryContent entry={entry} />
            </button>
          ) : (
            <a
              key={entry.key}
              href={entry.href}
              data-testid={`avatar-menu-${entry.key}`}
              className={rowClass}
              onClick={() => {
                setIsOpen(false);
                entry.onSelect?.();
              }}
            >
              {entry.icon}
              {entry.label}
            </a>
          ),
        )}
        {hasTheme ? (
          <div role="group" aria-label="Theme" className="flex shrink-0 flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-caption text-muted-foreground">Theme</p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {themes.map((option) => {
                const Icon = THEME_ICONS[option];
                const isChosen = option === theme;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={isChosen}
                    disabled={theme === undefined}
                    data-testid={`avatar-menu-theme-${option}`}
                    onClick={() => {
                      onThemeChange(option);
                    }}
                    className={classNames(
                      'inline-flex h-(--size-control-touch) items-center justify-center gap-1.5 rounded-md text-body-touch text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 [&_svg]:size-(--size-icon)',
                      isChosen ? 'bg-background text-foreground shadow-xs' : undefined,
                    )}
                  >
                    <Icon aria-hidden />
                    {THEME_LABELS[option]}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <a href={helpUrl} target="_blank" rel="noreferrer" data-testid="avatar-menu-help" className={rowClass}>
          <CircleHelp aria-hidden />
          Help
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <button type="button" data-testid="avatar-menu-sign-out" disabled={isSigningOut} onClick={onSignOut} className={rowClass}>
          <SignOutLabel isSigningOut={isSigningOut} />
        </button>
        <SheetClose render={<Button size="touch" className="w-full shrink-0" />}>Cancel</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
