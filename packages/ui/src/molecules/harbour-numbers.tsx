import type { HarbourOutput } from '@aeolus-fleet/common';
import type { HarbourState } from '@aeolus-fleet/common/rules';
import { Ship } from 'lucide-react';
import type { ReactNode } from 'react';

import { ShipState } from '../atoms/ship-state.js';
import { classNames } from '../class-names.js';

/** Harbour's numbers: the ships, and how many are in each state. */
export type HarbourCounts = NonNullable<HarbourOutput['counts']>;

/** The states in the order the numbers show them (docs/design/state-colours, "Five states"). */
const STATES: readonly HarbourState[] = ['alert', 'awaitingCrew', 'blocked', 'working', 'idle'];

/** At 0 a state's number carries no tone: its word is muted, its value in the foreground. */
const NO_TONE = 'text-muted-foreground';

/** Only Alert fills its card, above 0. */
const ALERT_CARD = 'border-tone-attention-border bg-tone-attention-bg';

/** A number's value in its state's tone, above 0; Idle has none and stays in the foreground. */
const VALUE_TONES: Record<HarbourState, string> = {
  alert: 'text-tone-attention-fg',
  awaitingCrew: 'text-tone-waiting-fg',
  blocked: 'text-tone-blocked-fg',
  working: 'text-tone-active-fg',
  idle: '',
};

function HarbourNumber({ value, word, testId, valueTone, card }: { value: number | undefined; word: ReactNode; testId: string; valueTone?: string; card?: string }) {
  return (
    <div data-testid={testId} className={classNames('flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5 @max-[35rem]:items-center @max-[35rem]:px-1 @max-[35rem]:py-2 @max-[35rem]:text-center', card)}>
      {value === undefined ? (
        <span aria-hidden className="block h-8 w-10 animate-pulse rounded-md bg-secondary [animation-duration:var(--duration-pulse)] motion-reduce:animate-none @max-[35rem]:size-6.5" />
      ) : (
        <span className={classNames('text-[28px] leading-8.5 font-semibold text-foreground tabular-nums @max-[35rem]:text-[22px] @max-[35rem]:leading-6.5', valueTone)}>{value}</span>
      )}
      {word}
    </div>
  );
}

/** The word under a number, smaller when Harbour is narrow; "Awaiting crew" may wrap there (Thomas, 3 Nov). */
const WORD = 'min-w-0 items-start @max-[35rem]:gap-0.75 @max-[35rem]:text-[11px] @max-[35rem]:leading-3.5 [&_svg]:mt-0.5 @max-[35rem]:[&_svg]:mt-px @max-[35rem]:[&_svg]:size-3';

/**
 * Harbour's numbers (docs/design/fleet-overview, docs/design/state-colours):
 * the ships, then Alert, Awaiting crew, Blocked, Working and Idle, each a
 * ShipState in its tone; only Alert is filled, and a number at 0 carries no
 * tone at all. Large numbers, small ones when Harbour is narrow (under
 * 35rem: a phone, Bridge's column at 1440). Undefined draws the shape that
 * is coming.
 */
export function HarbourNumbers({ counts }: { counts: HarbourCounts | undefined }) {
  return (
    // Its own container, so the numbers size by their own width wherever an app puts them.
    <div className="@container min-w-0" data-testid="harbour-numbers">
      <div className="grid grid-cols-6 gap-3 @max-[35rem]:gap-1.5">
        <HarbourNumber
          value={counts?.ships}
          word={
            <span className={classNames('inline-flex gap-1.25 text-meta font-medium text-muted-foreground', WORD)}>
              <Ship aria-hidden className="size-3.5 shrink-0" />
              Ships
            </span>
          }
          testId="harbour-number-ships"
        />
        {STATES.map((state) => {
          const value = counts?.[state];
          const isToned = value !== undefined && value > 0;
          return (
            <HarbourNumber
              key={state}
              value={value}
              word={<ShipState state={state} className={classNames(WORD, isToned ? undefined : NO_TONE)} />}
              testId={`harbour-number-${state}`}
              valueTone={isToned ? VALUE_TONES[state] : undefined}
              card={isToned && state === 'alert' ? ALERT_CARD : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
