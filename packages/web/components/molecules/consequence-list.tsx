import type { LucideIcon } from 'lucide-react';

/** One fact a confirm states: what will happen, with an icon that says what kind of thing it is. */
export interface Consequence {
  icon: LucideIcon;
  text: string;
}

/**
 * What a ship action will do, as facts on a muted panel
 * (docs/design/png/ReleaseDialog.png): the confirm's body, so the operator
 * reads exactly what happens before choosing.
 */
export function ConsequenceList({ consequences }: { consequences: readonly Consequence[] }) {
  return (
    <ul className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3 text-meta text-foreground">
      {consequences.map(({ icon: Icon, text }) => (
        <li key={text} className="flex gap-2">
          <Icon aria-hidden className="mt-0.5 size-(--size-icon-sm) shrink-0 text-muted-foreground" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
