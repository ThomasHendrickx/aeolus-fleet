import { classNames } from '../../lib/class-names';

export type LiveState = 'live' | 'reconnecting' | 'offline';

const STATES: Record<LiveState, { label: string; dot: string }> = {
  live: { label: 'Live', dot: 'bg-tone-ok-fg' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-tone-waiting-fg' },
  offline: { label: 'Offline', dot: 'bg-tone-attention-fg' },
};

/**
 * The live connection status in Header and TopBar (docs/design/png/Header.png):
 * a dot that always has its word, so it never reads by colour alone. Changes
 * are announced politely.
 */
export function LiveStatus({ state, className }: { state: LiveState; className?: string }) {
  const { label, dot } = STATES[state];
  return (
    <span
      data-slot="live-status"
      data-state={state}
      aria-live="polite"
      className={classNames('inline-flex items-center gap-1.5 text-meta text-muted-foreground', className)}
    >
      <span aria-hidden className={classNames('size-2 shrink-0 rounded-full', dot)} />
      {label}
    </span>
  );
}
