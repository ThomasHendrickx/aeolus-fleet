import type { ReactNode } from 'react';

/** A Settings section as the page draws them: a card with its heading, an optional line under it, then its content. */
export function SettingsSection({ id, title, line, children }: { id: string; title: string; line?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby={id} data-testid={id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={id} className="text-body font-semibold text-foreground">
          {title}
        </h2>
        {line === undefined ? null : <p className="text-meta text-muted-foreground max-sm:text-body-touch">{line}</p>}
      </div>
      {children}
    </section>
  );
}

/** A row of a Settings section: 44 px, its icon, its words and what it leads to, a line between rows. */
export const SETTINGS_ROW =
  'flex min-h-(--size-control-touch) w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-body font-medium text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:text-muted-foreground max-sm:text-body-touch [&_svg]:size-(--size-icon) [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

/** The rows of a section, a line between each. */
export function SettingsRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y divide-border">{children}</ul>;
}
