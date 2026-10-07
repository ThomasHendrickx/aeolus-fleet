import type { Party } from '@aeolus-fleet/common';
import { CircleX, Clock, KeyRound, ListChecks, LoaderCircle, Pen, Power, RotateCcw, ShipWheel } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { crewRequestAction, isRestartable, type CrewRequestStage } from '../../lib/crew-request';
import type { SettingsRow } from '../../lib/crew-settings-form';
import { harnessWord } from '../../lib/harness';
import { clockTime, fullDateTime, relativeTime, shortDateTime } from '../../lib/relative-time';
import { capitalised, OPERATOR_NAME } from '../../lib/sentence';
import { Button } from '../atoms/button';
import { InlineError } from '../molecules/inline-error';
import { StatusBadge } from '../molecules/status-badge';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the card is doing: the action whose call is out. */
export type CrewRequestBusy = 'request' | 'remove' | 'restart' | undefined;

interface CrewRequestCardProps {
  stage: CrewRequestStage;
  /** Who asked for it: the actor of its latest CrewRequested event; null while unknown. */
  requestedBy: Party | null;
  /** When its crew status last changed: when it stopped, crashed or was asked to release. */
  statusChangedAt?: string;
  now: Date;
  /** Whether the session may write crew requests (fleet:manage); a viewer reads only. */
  canManage: boolean;
  /** Whether the ship awaits crew, so a starting prompt crews it by hand. */
  isAwaitingCrew: boolean;
  /**
   * Whether the trierarch plugin is on: Request crew then asks for settings,
   * Edit changes them, the trierarch links to its machine, and no starting
   * prompt is offered on the card (the ship header still offers it).
   */
  hasTrierarchs?: boolean;
  /** The request's settings as rows, when they are crew settings. */
  settingsRows?: readonly SettingsRow[];
  /** Edit the request's settings (decision 3); none without the plugin. */
  onEdit?: () => void;
  busy?: CrewRequestBusy;
  /** The last action that failed, with why: nothing changed. */
  error?: { action: Exclude<CrewRequestBusy, undefined>; message: string };
  onRequest: () => void;
  onRemove: () => void;
  /** Opens the release confirm. */
  onRelease: () => void;
  onRestart: () => void;
  onGetStartingPrompt: () => void;
}

const FAILED: Record<Exclude<CrewRequestBusy, undefined>, string> = {
  request: 'Couldn’t request crew',
  remove: 'Couldn’t remove the request',
  restart: 'Couldn’t restart the crew',
};

/** "10:20" today, "28 Sep, 14:21" once over a day ago. */
function since(at: string, now: Date): string {
  const when = new Date(at);
  return now.getTime() - when.getTime() < DAY_MS ? clockTime(when) : shortDateTime(when);
}

function Time({ at, now, children }: { at: string; now: Date; children?: ReactNode }) {
  return (
    <time dateTime={at} title={fullDateTime(new Date(at))} className="tabular-nums">
      {children ?? since(at, now)}
    </time>
  );
}

/** A trierarch as the card names it: a link to its machine in the Trierarchs section, or to its ship without it. */
function TrierarchLink({ trierarch, hasTrierarchs }: { trierarch: Party; hasTrierarchs: boolean }) {
  return (
    <Link
      href={hasTrierarchs ? `/trierarchs/${trierarch.id}` : `/ships/${trierarch.id}`}
      data-testid="crew-request-trierarch"
      className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground underline decoration-input underline-offset-3 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
    >
      <ShipWheel aria-hidden />
      <span className="truncate">{trierarch.name}</span>
    </Link>
  );
}

/** "Requested by you 6 min ago." argo reads "you". */
function RequestedBy({ requestedBy, requestedAt, now }: { requestedBy: Party | null; requestedAt: string; now: Date }) {
  const who = requestedBy === null ? null : requestedBy.name === OPERATOR_NAME ? 'you' : requestedBy.name;
  return (
    <span data-testid="crew-request-requested-by">
      {who === null ? 'Requested ' : `Requested by ${who} `}
      <Time at={requestedAt} now={now}>
        {relativeTime(new Date(requestedAt), now)}
      </Time>
      .
    </span>
  );
}

const NOTE_TONES = {
  note: 'border-border bg-muted text-muted-foreground',
  waiting: 'border-tone-waiting-border bg-tone-waiting-bg text-tone-waiting-fg',
  attention: 'border-tone-attention-border bg-tone-attention-bg text-tone-attention-fg',
} as const;

/** A fact about the crew under the card's head: muted, or in its alert tone (docs/design/conventions.md, "Colour"). */
function Note({ tone, icon, children }: { tone: keyof typeof NOTE_TONES; icon: ReactNode; children: ReactNode }) {
  const role = tone === 'attention' ? 'alert' : tone === 'waiting' ? 'status' : 'note';
  return (
    <div
      role={role}
      data-testid="crew-request-note"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-meta [&_svg]:mt-0.5 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0 ${NOTE_TONES[tone]}`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

/** The note an assigned request shows for its status; none while it runs. */
function statusNote(stage: Extract<CrewRequestStage, { kind: 'assigned' }>, at: { statusChangedAt?: string; now: Date }): ReactNode {
  const { trierarch } = stage;
  const when = at.statusChangedAt === undefined ? null : <Time at={at.statusChangedAt} now={at.now} />;
  switch (stage.status) {
    case 'crewing':
      return (
        <Note tone="note" icon={<LoaderCircle aria-hidden />}>
          {trierarch.name} is starting the session.
        </Note>
      );
    case 'running':
      return null;
    case 'restarting':
      return (
        <Note tone="waiting" icon={<RotateCcw aria-hidden />}>
          <strong className="font-medium">{when === null ? 'The session stopped.' : <>The session stopped at {when}.</>}</strong> {trierarch.name} is
          starting it again. Once its restarts are used up it stops trying and the request shows Crashed.
        </Note>
      );
    case 'crashed':
      return (
        <Note tone="attention" icon={<CircleX aria-hidden />}>
          <strong className="font-medium">{when === null ? 'Crashed.' : <>Crashed at {when}.</>}</strong> The session kept stopping and {trierarch.name}{' '}
          stopped trying. The lease still holds, so new deliveries wait in the inbox. Restart crews it again with the same settings.
        </Note>
      );
    case 'releasing':
      return (
        <Note tone="note" icon={<Power aria-hidden />}>
          Releasing: {trierarch.name} is stopping the session and cleaning up. The request goes away once it confirms.
        </Note>
      );
  }
}

/** A request's settings, as a grid of label and value (canvas CrewRequest, with the plugin). */
function SettingsGrid({ rows }: { rows: readonly SettingsRow[] }) {
  return (
    <dl data-testid="crew-request-settings" className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-5 gap-y-3 border-t border-border pt-3">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-caption font-medium text-muted-foreground">{row.label}</dt>
          <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-body font-medium">
            {row.value === null ? (
              <span className="font-normal text-muted-foreground">None</span>
            ) : (
              <span className={row.isMono ? 'truncate font-mono text-id' : 'truncate'}>{row.label === 'Harness' ? harnessWord(row.value) : row.value}</span>
            )}
            {row.meta === undefined ? null : <span className="text-meta font-normal text-muted-foreground">{row.meta}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Heading() {
  return (
    <span className="inline-flex items-center gap-2">
      <ListChecks aria-hidden className="size-(--size-icon) text-muted-foreground" />
      <h2 className="text-section font-semibold">Crew request</h2>
    </span>
  );
}

/**
 * A ship's crew request on its page (canvas CrewRequest, layout A; #245):
 * between the ship's head and its meta strip, its state, the trierarch that
 * crews it as a link to its machine (to its ship without the Trierarchs section), and its one action, Remove request before a
 * crew and Release once crewed, with Restart on a crashed request. Without a
 * request it offers Request crew, which puts the ship on the operator's to-do
 * to crew by hand. A viewer reads it without actions.
 */
export function CrewRequestCard(props: CrewRequestCardProps) {
  const { stage, requestedBy, now, canManage, isAwaitingCrew, busy, error } = props;
  const failed = error === undefined ? null : <InlineError title={FAILED[error.action]} description={`${error.message} Nothing changed.`} />;

  if (stage.kind === 'none') {
    return (
      <section aria-label="Crew request" data-testid="crew-request" className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3.5">
          <Heading />
          <p className="min-w-0 flex-1 text-meta text-muted-foreground">
            {props.hasTrierarchs
              ? 'No crew request. A crew request keeps this ship crewed: a trierarch starts a session for it and restarts it when it stops.'
              : 'No crew request. A crew request puts this ship on your Needs crew list until you crew it by hand.'}
          </p>
          {canManage ? (
            <Button size="sm" icon={<ListChecks />} isLoading={busy === 'request'} onClick={props.onRequest} data-testid="crew-request-request">
              Request crew
            </Button>
          ) : null}
        </div>
        {failed}
      </section>
    );
  }

  const action = crewRequestAction(stage);
  const isBusy = busy !== undefined;
  return (
    <section aria-label="Crew request" data-testid="crew-request" className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Heading />
        <span className="inline-flex min-w-0 items-center gap-2" data-testid="crew-request-state">
          {stage.kind === 'assigned' ? <StatusBadge status={stage.status} /> : <StatusBadge status={stage.kind} />}
          {stage.kind === 'needsCrew' ? (
            <span className="text-meta text-muted-foreground">
              {props.hasTrierarchs ? (
                'not assigned yet'
              ) : (
                stage.reason ?? (
                  <>
                    since <Time at={stage.requestedAt} now={now} />
                  </>
                )
              )}
            </span>
          ) : null}
          {stage.kind === 'crewedByHand' && stage.since !== null ? (
            <span className="text-meta text-muted-foreground">
              since <Time at={stage.since} now={now} />
            </span>
          ) : null}
          {stage.kind === 'assigned' && stage.status === 'releasing' && props.statusChangedAt !== undefined ? (
            <span className="text-meta text-muted-foreground">
              asked <Time at={props.statusChangedAt} now={now} />
            </span>
          ) : null}
        </span>
        {stage.kind === 'assigned' ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-meta">
            on <TrierarchLink trierarch={stage.trierarch} hasTrierarchs={props.hasTrierarchs ?? false} />
          </span>
        ) : null}
        <span className="flex-1" />
        {stage.kind === 'assigned' && stage.status === 'releasing' ? (
          <span className="text-meta text-muted-foreground">Waiting for {stage.trierarch.name}</span>
        ) : null}
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {action === 'remove' ? (
              <Button size="sm" variant="ghost" isLoading={busy === 'remove'} disabled={isBusy} onClick={props.onRemove} data-testid="crew-request-remove">
                Remove request
              </Button>
            ) : null}
            {isRestartable(stage) ? (
              <Button size="sm" icon={<RotateCcw />} isLoading={busy === 'restart'} disabled={isBusy} onClick={props.onRestart} data-testid="crew-request-restart">
                Restart
              </Button>
            ) : null}
            {props.onEdit !== undefined && action !== undefined ? (
              <Button size="sm" icon={<Pen />} disabled={isBusy} onClick={props.onEdit} data-testid="crew-request-edit">
                Edit…
              </Button>
            ) : null}
            {action === 'release' ? (
              <Button size="sm" icon={<Power />} disabled={isBusy} onClick={props.onRelease} data-testid="crew-request-release">
                Release…
              </Button>
            ) : null}
            {stage.kind === 'needsCrew' && isAwaitingCrew && !props.hasTrierarchs ? (
              <Button size="sm" variant="primary" icon={<KeyRound />} disabled={isBusy} onClick={props.onGetStartingPrompt} data-testid="crew-request-prompt">
                Get starting prompt
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {stage.kind === 'assigned' ? statusNote(stage, { statusChangedAt: props.statusChangedAt, now }) : null}
      {stage.kind === 'needsCrew' && props.hasTrierarchs ? (
        stage.reason === null ? (
          <Note tone="note" icon={<LoaderCircle aria-hidden />}>
            Waiting for the trierarch plugin to assign a trierarch.
          </Note>
        ) : (
          <Note tone="waiting" icon={<Clock aria-hidden />}>
            <strong className="font-medium">{capitalised(stage.reason)}.</strong> The plugin assigns a trierarch as soon as one fits. Until then this ship is on Needs crew.
          </Note>
        )
      ) : null}
      {failed}
      {props.settingsRows === undefined ? null : <SettingsGrid rows={props.settingsRows} />}
      <p className="text-meta text-muted-foreground">
        {stage.kind === 'needsCrew' && !props.hasTrierarchs
          ? 'On your Needs crew list. Crew it by hand: get a starting prompt and start a session with it. Crewing it fulfils the request; the request stays until you remove it. '
          : null}
        {stage.kind === 'crewedByHand'
          ? `${stage.crewedBy.name === OPERATOR_NAME ? 'You' : stage.crewedBy.name} crewed it by hand. The request stands: if the lease ends, the ship is back on Needs crew until you crew it again or release it. `
          : null}
        <RequestedBy requestedBy={requestedBy} requestedAt={stage.requestedAt} now={now} />
        {stage.kind === 'assigned' && stage.status !== 'releasing' ? ' The trierarch keeps it crewed until you release it.' : null}
      </p>
    </section>
  );
}
