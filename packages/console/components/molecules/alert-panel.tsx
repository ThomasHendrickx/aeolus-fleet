import { TriangleAlert } from 'lucide-react';

/** One line of an alert panel: the ship it is on where the panel names several, what parted, and since when. */
export interface AlertPanelLine {
  key: string;
  ship?: string;
  text: string;
  caption: string;
}

/**
 * Open alerts in the attention tone (docs/design/monitoring, 4.8; mockups:
 * the overview's Open alerts and the ship page's open alert): a heading with
 * the alert icon, then a line per alert, its caption saying since when and
 * that it clears by itself. Status in words and icon, never colour alone.
 */
export function AlertPanel({ heading, lines, testId }: { heading: string; lines: readonly AlertPanelLine[]; testId?: string }) {
  return (
    <section aria-label={heading} data-testid={testId} className="flex flex-col gap-1.5 rounded-lg border border-tone-attention-border bg-tone-attention-bg px-3.5 py-2.5 text-tone-attention-fg">
      <h2 className="flex items-center gap-1.5 text-meta font-semibold">
        <TriangleAlert aria-hidden className="size-(--size-icon-sm) shrink-0" />
        {heading}
      </h2>
      {lines.map((line) => (
        <p key={line.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-foreground">
          {line.ship === undefined ? null : <span className="font-semibold">{line.ship}</span>}
          {line.text === '' ? null : <span>{line.text}</span>}
          <span className="text-muted-foreground sm:ml-auto">{line.caption}</span>
        </p>
      ))}
    </section>
  );
}
