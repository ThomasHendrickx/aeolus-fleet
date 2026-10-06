import { describe, expect, it } from 'vitest';

import { isSendShortcut, sendShortcutAria, sendShortcutKeys, shortcutPlatformOf } from './send-shortcut';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const press = { key: 'Enter', metaKey: false, ctrlKey: false, isComposing: false };

describe('shortcutPlatformOf', () => {
  it.each([
    [MAC, 'mac'],
    [WINDOWS, 'other'],
    [LINUX, 'other'],
  ])('reads the platform from the user agent %#', (userAgent, platform) => {
    expect(shortcutPlatformOf(userAgent)).toBe(platform);
  });
});

describe('sendShortcutKeys', () => {
  it('shows Cmd and Enter on a Mac', () => {
    expect(sendShortcutKeys('mac')).toBe('⌘↵');
  });

  it('shows Ctrl and Enter elsewhere', () => {
    expect(sendShortcutKeys('other')).toBe('Ctrl ↵');
  });
});

describe('sendShortcutAria', () => {
  it.each([
    ['mac', 'Meta+Enter'],
    ['other', 'Control+Enter'],
  ] as const)('names the %s shortcut for assistive technology', (platform, keys) => {
    expect(sendShortcutAria(platform)).toBe(keys);
  });
});

describe('isSendShortcut', () => {
  it('sends on Cmd+Enter', () => {
    expect(isSendShortcut({ ...press, metaKey: true })).toBe(true);
  });

  it('sends on Ctrl+Enter', () => {
    expect(isSendShortcut({ ...press, ctrlKey: true })).toBe(true);
  });

  it('leaves Enter alone as a newline', () => {
    expect(isSendShortcut(press)).toBe(false);
  });

  it('does not send on Cmd with another key', () => {
    expect(isSendShortcut({ ...press, key: 'a', metaKey: true })).toBe(false);
  });

  it('does not send while an input method is composing text', () => {
    expect(isSendShortcut({ ...press, metaKey: true, isComposing: true })).toBe(false);
  });
});
