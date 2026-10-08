import { classNames } from '../../lib/class-names';
import type { MemberHealth } from '../../lib/squadrons-api';

const HEALTHS: Record<MemberHealth, { label: string; dot: string; text: string }> = {
  'on-time': { label: 'On time', dot: 'bg-tone-ok-fg', text: 'text-tone-ok-fg' },
  late: { label: 'Late', dot: 'bg-tone-waiting-fg', text: 'text-tone-waiting-fg' },
  silent: { label: 'Silent', dot: 'bg-tone-attention-fg', text: 'text-tone-attention-fg' },
  // A removed member, until its crew is released and its ship retired (#343).
  'standing-down': { label: 'Standing down', dot: 'bg-tone-active-fg', text: 'text-tone-active-fg' },
  // Not on station is a dashed ring, no tone (docs/design/conventions.md, "Colour").
  'not-on-station': { label: 'Not on station', dot: 'border border-dashed border-muted-foreground', text: 'text-foreground' },
};

function Dot({ health }: { health: MemberHealth }) {
  return <span aria-hidden className={classNames('size-2 shrink-0 rounded-full', HEALTHS[health].dot)} />;
}

/**
 * Is a squadron member checking in on time (docs/design/png/HealthIndicator.png):
 * On time, Late (past its check-in interval), Silent (three intervals),
 * Standing down (removed, its crew being released), or Not on station. Dot plus word, never the dot alone, with an optional detail
 * such as when it was last seen.
 */
export function HealthIndicator({ health, detail, className }: { health: MemberHealth; detail?: string; className?: string }) {
  return (
    <span data-slot="health-indicator" data-health={health} className={classNames('inline-flex items-center gap-1.5 text-meta', className)}>
      <Dot health={health} />
      <span className={classNames('font-medium', HEALTHS[health].text)}>{HEALTHS[health].label}</span>
      {detail !== undefined && <span className="text-muted-foreground">{detail}</span>}
    </span>
  );
}

/** A squadron's members per health: "2 on time, 1 late, 1 silent". */
export function HealthSummary({ counts, className }: { counts: readonly { health: MemberHealth; count: number }[]; className?: string }) {
  return (
    <span data-slot="health-summary" className={classNames('inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-meta', className)}>
      {counts.map(({ health, count }) => (
        <span key={health} className="inline-flex items-center gap-1.5">
          <Dot health={health} />
          <span>
            {count} {HEALTHS[health].label.toLowerCase()}
          </span>
        </span>
      ))}
    </span>
  );
}
