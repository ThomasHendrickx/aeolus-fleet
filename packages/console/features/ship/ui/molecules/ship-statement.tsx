import type { DiscoveredStatement } from '@aeolus-fleet/common';

/**
 * What a ship is and offers (decision 0047): its crew's summary and each
 * capability it offers, else the note it was commissioned with, saying
 * which. A claim its crew makes, never checked.
 */
export function ShipStatement({ statement, testId }: { statement: DiscoveredStatement; testId?: string }) {
  if (statement === null) {
    return (
      <span data-testid={testId} className="text-meta text-muted-foreground">
        No statement
      </span>
    );
  }
  if (statement.by === 'commission') {
    return (
      <span data-testid={testId} className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body text-foreground">{statement.note}</span>
        <span className="text-meta text-muted-foreground">Commission note, until a crew states one</span>
      </span>
    );
  }
  return (
    <span data-testid={testId} className="flex min-w-0 flex-col gap-1.5">
      <span className="text-body text-foreground">{statement.summary}</span>
      {statement.capabilities.length === 0 ? null : (
        <ul aria-label="Offers" className="flex min-w-0 flex-col gap-1">
          {statement.capabilities.map((capability) => (
            <li key={capability.name} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-meta">
              <span className="font-mono text-id text-foreground">{capability.name}</span>
              {capability.title === undefined ? null : <span className="text-foreground">{capability.title}</span>}
              {capability.description === undefined ? null : <span className="text-muted-foreground">{capability.description}</span>}
            </li>
          ))}
        </ul>
      )}
      <span className="text-meta text-muted-foreground">Stated by its crew · version {statement.version}</span>
    </span>
  );
}
