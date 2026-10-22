import type { ReactNode } from 'react';

/** An entry of the app's own in the avatar menu, such as Take the tour; phone-only ones stand in for what a tab bar lacks (H6). */
export interface AvatarMenuEntry {
  key: string;
  label: string;
  icon: ReactNode;
  /** A link, or an action; one of the two. */
  href?: string;
  onSelect?: () => void;
  isPhoneOnly?: boolean;
  /** For an action whose work runs on the server, such as signing in as argo: what the entry says while it runs. Set, the menu stays open once it is picked. */
  workingLabel?: string;
  /** Whether that work runs now: the entry says its working label, with a spinner, and takes no second press. */
  isWorking?: boolean;
}

/** What the menu shows of an entry: its label, or its working label while its work runs, and whether picking it closes the menu. */
export function shownEntryOf(entry: AvatarMenuEntry): { label: string; isWorking: boolean; shouldCloseMenu: boolean } {
  const isWorking = entry.workingLabel !== undefined && entry.isWorking === true;
  return { label: isWorking && entry.workingLabel !== undefined ? entry.workingLabel : entry.label, isWorking, shouldCloseMenu: entry.workingLabel === undefined };
}
