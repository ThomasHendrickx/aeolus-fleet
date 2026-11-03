import type { HarbourOutput } from '@aeolus-fleet/common';
import type { HarbourState } from '@aeolus-fleet/common/rules';
import { Ship } from 'lucide-react';
import type { ReactNode } from 'react';

import { classNames } from '../class-names.js';
import { HARBOUR_STATE_WORDS, HarbourStateIcon } from './harbour-state.js';

/** Harbour's numbers: the ships, and how many are in each state. */
export type HarbourCounts = NonNullable<HarbourOutput['counts']>;

/** The states in the order the numbers show them. */
const STATES: readonly HarbourState[] = ['alert', 'waiting', 'working', 'idle'];

/** A number's colour above 0; only Alert fills its card. */
const NUMBER_TONES: Record<HarbourState, { text: string; card?: string }> = {
  alert: {
    text: 'text-tone-attention-fg',
    card: 'border-tone-attention-border bg-tone-attention-bg',
  },
  waiting: { text: 'text-tone-waiting-fg' },
  working: { text: 'text-tone-ok-fg' },
  idle: { text: '' },
};

function HarbourNumber({ value, word, icon, testId, tone }: { value: number | undefined; word: string; icon: ReactNode; testId: string; tone?: { text: string; card?: string } }) {
  return (
    <div data-testid={testId} className={classNames('flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5 @max-[35rem]:items-center @max-[35rem]:px-1 @max-[35rem]:py-2', tone?.card)}>
      {value === undefined ? (
        <span aria-hidden className="block h-8 w-10 animate-pulse rounded-md bg-secondary [animation-duration:var(--duration-pulse)] motion-reduce:animate-none @max-[35rem]:size-6.5" />
      ) : (
        <span className={classNames('text-[28px] leading-8.5 font-semibold text-foreground tabular-nums @max-[35rem]:text-[22px] @max-[35rem]:leading-6.5', tone?.text)}>{value}</span>
      )}
      <span className="inline-flex min-w-0 items-center gap-1.5 text-meta whitespace-nowrap text-muted-foreground @max-[35rem]:gap-0.75 @max-[35rem]:text-[11px] [&_svg]:size-3.5 @max-[35rem]:[&_svg]:size-3">
        {icon}
        {word}
      </span>
    </div>
  );
}

/**
 * Harbour's numbers (docs/design/fleet-overview): the ships, then Alert,
 * Waiting, Working and Idle, each with its icon and word; only Alert is
 * filled in its tone, and a number at 0 carries no tone at all. Large
 * numbers, small ones when Harbour is narrow (under 35rem: a phone, Bridge's
 * column at 1440). Undefined draws the shape that is coming.
 */
export function HarbourNumbers({ counts }: { counts: HarbourCounts | undefined }) {
  return (
    // Its own container, so the numbers size by their own width wherever an app puts them.
    <div className="@container min-w-0" data-testid="harbour-numbers">
      <div className="grid grid-cols-5 gap-3 @max-[35rem]:gap-1.5">
        <HarbourNumber value={counts?.ships} word="Ships" icon={<Ship aria-hidden />} testId="harbour-number-ships" />
        {STATES.map((state) => {
          const value = counts?.[state];
          const tone = value !== undefined && value > 0 ? NUMBER_TONES[state] : undefined;
          return <HarbourNumber key={state} value={value} word={HARBOUR_STATE_WORDS[state]} icon={<HarbourStateIcon state={state} className={classNames('shrink-0', tone?.text)} />} testId={`harbour-number-${state}`} tone={tone} />;
        })}
      </div>
    </div>
  );
}
