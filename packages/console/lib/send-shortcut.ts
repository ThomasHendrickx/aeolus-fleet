import { useSyncExternalStore, type KeyboardEvent } from 'react';

/**
 * The keyboard shortcut that sends what the operator writes: Cmd+Enter on a
 * Mac, Ctrl+Enter elsewhere. Enter alone stays a newline. The Send button
 * stays; the shortcut is never the only way.
 */
export type ShortcutPlatform = 'mac' | 'other';

const MAC_USER_AGENT = /Mac|iPhone|iPad|iPod/;

/** The platform a browser's user agent names: a Mac (or iOS) or anything else. */
export function shortcutPlatformOf(userAgent: string): ShortcutPlatform {
  return MAC_USER_AGENT.test(userAgent) ? 'mac' : 'other';
}

/** The keys the hint shows: the platform's modifier, then Enter. */
export function sendShortcutKeys(platform: ShortcutPlatform): string {
  return platform === 'mac' ? '⌘↵' : 'Ctrl ↵';
}

/** The shortcut as aria-keyshortcuts names it, so the Send button's accessible name stays "Send". */
export function sendShortcutAria(platform: ShortcutPlatform): string {
  return platform === 'mac' ? 'Meta+Enter' : 'Control+Enter';
}

/**
 * Whether a key press asks to send: Enter with Cmd or Ctrl held, as the ⌘K
 * shortcut takes either, and never while an input method is composing text.
 */
export function isSendShortcut(
  event: Readonly<Pick<globalThis.KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'isComposing'>>,
): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing;
}

/**
 * A message field's key handler: on the send shortcut it submits the field's
 * form, so the form's own guard decides whether sending is possible now.
 */
export function submitOnSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>): void {
  const { key, metaKey, ctrlKey } = event;
  if (isSendShortcut({ key, metaKey, ctrlKey, isComposing: event.nativeEvent.isComposing })) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

function subscribe(): () => void {
  // The user agent never changes while the page is open: nothing to listen to.
  return () => undefined;
}

function clientPlatform(): ShortcutPlatform {
  return shortcutPlatformOf(navigator.userAgent);
}

function serverPlatform(): null {
  return null;
}

/**
 * The platform of the browser the console runs in, read once; null while
 * rendering on the server, so the hint shows only once the browser is known.
 */
export function useShortcutPlatform(): ShortcutPlatform | null {
  return useSyncExternalStore(subscribe, clientPlatform, serverPlatform);
}
