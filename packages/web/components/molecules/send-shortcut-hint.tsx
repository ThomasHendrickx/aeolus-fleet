import { sendShortcutKeys, type ShortcutPlatform } from '../../lib/send-shortcut';
import { Kbd } from '../atoms/kbd';

/**
 * The send shortcut's keys inside a primary Send button: ⌘↵ on a Mac, Ctrl ↵
 * elsewhere. Desktop only, as every Kbd. Hidden from assistive technology:
 * the button names its shortcut with aria-keyshortcuts instead.
 */
export function SendShortcutHint({ platform }: { platform: ShortcutPlatform }) {
  return (
    <Kbd
      aria-hidden
      data-testid="send-shortcut-hint"
      className="border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground"
    >
      {sendShortcutKeys(platform)}
    </Kbd>
  );
}
