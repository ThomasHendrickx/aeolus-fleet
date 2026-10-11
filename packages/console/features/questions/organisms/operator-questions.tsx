'use client';

import type { AnswerChoice, DeliveryId } from '@aeolus-fleet/common';
import { ChevronLeft, CircleCheck, CircleHelp, CircleSlash, Replace, Send } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../../lib/class-names';
import type { QuestionFilter, QuestionMessage } from '../../../lib/questions';
import { clockTime, fullDateTime, shortDateTime } from '../../../lib/relative-time';
import { sendShortcutAria, submitOnSendShortcut, useShortcutPlatform } from '../../../lib/send-shortcut';
import { Badge } from '../../../components/atoms/badge';
import { Button } from '../../../components/atoms/button';
import { Label } from '../../../components/atoms/label';
import { RadioGroup, RadioGroupItem } from '../../../components/atoms/radio-group';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '../../../components/atoms/tabs';
import { Textarea } from '../../../components/atoms/textarea';
import { EmptyState } from '../../../components/molecules/empty-state';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadingSkeleton } from '../../../components/molecules/loading-skeleton';
import { SendShortcutHint } from '../../../components/molecules/send-shortcut-hint';
import { ShipName } from '../../../components/molecules/ship-name';

type Question = QuestionMessage;

interface OperatorQuestionsProps {
  /** Already filtered and newest first, from the server. */
  questions: readonly Question[];
  filter: QuestionFilter;
  onFilterChange: (filter: QuestionFilter) => void;
  /** Counts for the segmented filter; undefined hides a count. */
  counts: Partial<Record<QuestionFilter, number>>;
  /** The open question, from the URL. */
  selectedId: DeliveryId | undefined;
  /** Opens a question, also one the filter leaves out (a replacement or the question it replaces); undefined goes back to the list on phone. */
  onSelect: (deliveryId: DeliveryId | undefined) => void;
  state: 'loading' | 'error' | 'ready';
  onRetry: () => void;
  onAnswer: (answer: { deliveryId: DeliveryId; answer: AnswerChoice }) => void;
  /** Questions whose answer is in flight. */
  pendingIds: ReadonlySet<DeliveryId>;
  now: Date;
  /** A session that may not receive (a viewer's): no answer form, and a note that says so. */
  isReadOnly?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

const FILTERS: readonly { value: QuestionFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'stale', label: 'Stale' },
  { value: 'all', label: 'All' },
];

const EMPTY_OPEN = {
  title: 'No questions for you',
  description: 'When a ship asks argo a question, it shows up here with its options. You answer it from the question.',
};

const EMPTY: Record<QuestionFilter, { title: string; description: string }> = {
  open: EMPTY_OPEN,
  answered: { title: 'Nothing answered yet', description: 'Questions you answer show up here.' },
  stale: { title: 'Nothing stale', description: 'Questions their ship withdrew or replaced before you answered show up here.' },
  all: EMPTY_OPEN,
};

/** What a question's row says it is, for a screen reader; its icon shows it. */
function stateOf(question: Question): 'Open' | 'Answered' | 'Withdrawn' | 'Replaced' {
  if (question.question.answer !== null) {
    return 'Answered';
  }
  switch (question.stale?.kind) {
    case 'withdrawn':
      return 'Withdrawn';
    case 'replaced':
      return 'Replaced';
    case undefined:
      return 'Open';
  }
}

function StateIcon({ state }: { state: ReturnType<typeof stateOf> }) {
  const className = 'size-(--size-icon-sm) shrink-0 text-muted-foreground';
  switch (state) {
    case 'Answered':
      return <CircleCheck aria-hidden className={className} />;
    case 'Withdrawn':
      return <CircleSlash aria-hidden className={className} />;
    case 'Replaced':
      return <Replace aria-hidden className={className} />;
    case 'Open':
      return null;
  }
}

/** "14:30" today, "28 Sep, 14:30" before. */
function listTime(at: Date, now: Date): string {
  return now.getTime() - at.getTime() < DAY_MS ? clockTime(at) : shortDateTime(at);
}

function FilterTabs({ filter, onFilterChange, counts }: Pick<OperatorQuestionsProps, 'filter' | 'onFilterChange' | 'counts'>) {
  return (
    <Tabs
      value={filter}
      onValueChange={(next: unknown) => {
        const chosen = FILTERS.find((each) => each.value === next);
        if (chosen) {
          onFilterChange(chosen.value);
        }
      }}
    >
      <TabsList aria-label="Show" className="max-sm:w-full">
        {FILTERS.map(({ value, label }) => (
          <TabsTrigger key={value} value={value} data-testid={`questions-filter-${value}`} className="max-sm:grow">
            {label}
            {counts[value] === undefined ? null : <TabsCount>{counts[value]}</TabsCount>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function QuestionList({ questions, selectedId, onSelect, now }: Pick<OperatorQuestionsProps, 'questions' | 'selectedId' | 'onSelect' | 'now'>) {
  return (
    <ul aria-label="Questions to argo" className="flex flex-col max-sm:gap-2">
      {questions.map((question) => {
        const sentAt = new Date(question.message.sentAt);
        const state = stateOf(question);
        const isOpen = state === 'Open';
        const isSelected = question.deliveryId === selectedId;
        return (
          <li key={question.deliveryId}>
            <button
              type="button"
              data-testid="questions-row"
              data-delivery-id={question.deliveryId}
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => {
                onSelect(question.deliveryId);
              }}
              className="relative flex w-full min-w-0 flex-col gap-1 border-b border-border py-2.5 pr-3 pl-5 text-left transition-colors duration-(--duration-fast) outline-none hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-[current=true]:bg-accent max-sm:rounded-lg max-sm:border max-sm:bg-card max-sm:py-3"
            >
              {isOpen ? <span aria-hidden className="absolute top-4 left-2 size-1.5 rounded-full bg-primary max-sm:top-4.5" /> : null}
              <span className="flex min-w-0 items-center gap-2">
                <StateIcon state={state} />
                <ShipName
                  name={question.message.sender.name}
                  shipId={question.message.sender.id}
                  isSuffixShown
                  className={classNames('min-w-0', isOpen ? 'font-semibold' : 'text-muted-foreground')}
                />
                <time dateTime={question.message.sentAt} title={fullDateTime(sentAt)} className="ml-auto shrink-0 text-meta text-muted-foreground tabular-nums">
                  {listTime(sentAt, now)}
                </time>
              </span>
              <span
                className={classNames(
                  'block min-w-0 truncate text-meta max-sm:text-body',
                  question.stale === null ? 'text-foreground' : 'text-muted-foreground line-through',
                )}
              >
                {question.question.title}
              </span>
              <span className="sr-only">{state}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Answered at 14:02: 2. Move to 4000", with the note below. */
function AnsweredNotice({ question }: { question: Question }) {
  const { answer, options } = question.question;
  if (answer === null) {
    return null;
  }
  const answeredAt = new Date(answer.sentAt);
  const option = options.find(({ key }) => key === answer.option);
  return (
    <div
      data-testid="questions-answered"
      className="flex flex-col gap-1 rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-meta text-tone-ok-fg"
    >
      <p className="flex items-center gap-2 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
        <CircleCheck aria-hidden />
        <span>
          Answered at{' '}
          <time dateTime={answer.sentAt} title={fullDateTime(answeredAt)}>
            {clockTime(answeredAt)}
          </time>
          {option === undefined ? ' with a note.' : `: ${option.key}. ${option.label}`}
        </span>
      </p>
      {answer.note === null ? null : <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{answer.note}</p>}
    </div>
  );
}

/** A link that opens another question: the replacement, or the question a replacement replaces. */
function QuestionLink({ deliveryId, title, onSelect, testId }: { deliveryId: DeliveryId; title: string; onSelect: OperatorQuestionsProps['onSelect']; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        onSelect(deliveryId);
      }}
      className="min-w-0 text-left font-medium text-foreground underline underline-offset-2 [overflow-wrap:anywhere] hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
    >
      {title}
    </button>
  );
}

/** "Withdrawn by implementer-b at 14:05." or "Replaced at 14:05 by: <the new question>"; nothing while not stale. */
function StaleNotice({ question, onSelect }: { question: Question; onSelect: OperatorQuestionsProps['onSelect'] }) {
  const { stale } = question;
  if (stale === null) {
    return null;
  }
  const at = new Date(stale.sentAt);
  const time = (
    <time dateTime={stale.sentAt} title={fullDateTime(at)}>
      {clockTime(at)}
    </time>
  );
  return (
    <div
      role="status"
      data-testid="questions-stale"
      className="flex flex-col gap-1 rounded-md border border-tone-ended-border bg-tone-ended-bg px-3 py-2 text-meta text-tone-ended-fg"
    >
      <p className="flex items-center gap-2 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
        {stale.kind === 'withdrawn' ? <CircleSlash aria-hidden /> : <Replace aria-hidden />}
        <span>
          {stale.kind === 'withdrawn' ? 'Withdrawn' : 'Replaced'} by {question.message.sender.name} at {time}. It can’t be answered.
        </span>
      </p>
      {stale.kind === 'replaced' ? (
        <p className="flex flex-wrap items-baseline gap-1">
          Answer the new question:{' '}
          <QuestionLink deliveryId={stale.deliveryId} title={stale.by.title} onSelect={onSelect} testId="questions-replacement" />
        </p>
      ) : null}
    </div>
  );
}

function OptionText({ option, pick, asker }: { option: Question['question']['options'][number]; pick: Question['question']['pick']; asker: string }) {
  const isPicked = option.key === pick.option;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
        {option.key}. {option.label}
        {isPicked ? <Badge variant="outline">{asker}’s pick</Badge> : null}
      </span>
      {option.detail === '' ? null : <span className="text-meta text-muted-foreground">{option.detail}</span>}
      {isPicked ? <span className="text-meta text-muted-foreground">Why: {pick.why}</span> : null}
    </span>
  );
}

/** The options as a list to read, for an answered question or a read-only session. */
function OptionList({ question }: { question: Question }) {
  const { options, pick, answer } = question.question;
  return (
    <ol aria-label="Options" className="flex flex-col gap-2">
      {options.map((option) => (
        <li
          key={option.key}
          data-testid={`questions-option-${option.key}`}
          className={classNames(
            'rounded-md border px-3 py-2.5',
            answer?.option === option.key ? 'border-primary bg-accent' : 'border-border bg-card',
          )}
        >
          <OptionText option={option} pick={pick} asker={question.message.sender.name} />
        </li>
      ))}
    </ol>
  );
}

function AnswerForm({
  question,
  onAnswer,
  isPending,
  isPhone,
}: {
  question: Question;
  onAnswer: OperatorQuestionsProps['onAnswer'];
  isPending: boolean;
  isPhone: boolean;
}) {
  const noteId = useId();
  const hintId = useId();
  const [option, setOption] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const platform = useShortcutPlatform();
  const { options, pick } = question.question;
  const asker = question.message.sender.name;
  const isEmpty = option === undefined && note.trim() === '';
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (isEmpty || isPending) {
          return;
        }
        const trimmed = note.trim();
        onAnswer({
          deliveryId: question.deliveryId,
          answer: option === undefined ? { note: trimmed } : { option, ...(trimmed === '' ? {} : { note: trimmed }) },
        });
      }}
    >
      <RadioGroup<number>
        aria-label="Options"
        onValueChange={(next) => {
          setOption(next);
        }}
      >
        {options.map((each) => {
          const itemId = `${noteId}-option-${each.key}`;
          return (
            <div
              key={each.key}
              data-testid={`questions-option-${each.key}`}
              className="flex items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 has-data-checked:border-primary"
            >
              <RadioGroupItem id={itemId} value={each.key} className="mt-0.5" />
              <label htmlFor={itemId} className="min-w-0 grow cursor-pointer">
                <OptionText option={each} pick={pick} asker={asker} />
              </label>
            </div>
          );
        })}
      </RadioGroup>
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <Label htmlFor={noteId}>Note to {asker}</Label>
        <Textarea
          id={noteId}
          rows={3}
          size={isPhone ? 'touch' : 'md'}
          placeholder="Optional with an option; on its own, ask for more context or say none fits"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          onKeyDown={submitOnSendShortcut}
          aria-describedby={hintId}
          data-testid="questions-note"
        />
        <div className="flex items-center justify-between gap-3">
          <p id={hintId} className="text-meta text-muted-foreground">
            Sent as a reply to {asker}; also marks the message done.
          </p>
          <Button
            type="submit"
            variant="primary"
            size={isPhone ? 'touch' : 'sm'}
            icon={<Send aria-hidden />}
            isLoading={isPending}
            disabled={isEmpty && !isPending}
            aria-keyshortcuts={platform === null ? undefined : sendShortcutAria(platform)}
            data-testid="questions-send"
          >
            Send answer
            {platform === null ? null : <SendShortcutHint platform={platform} />}
          </Button>
        </div>
      </div>
    </form>
  );
}

function QuestionPane({
  question,
  onAnswer,
  onSelect,
  pendingIds,
  isPhone,
  isReadOnly = false,
}: Pick<OperatorQuestionsProps, 'onAnswer' | 'onSelect' | 'pendingIds' | 'isReadOnly'> & { question: Question; isPhone: boolean }) {
  const sentAt = new Date(question.message.sentAt);
  const sender = question.message.sender;
  const isAnswerable = question.question.answer === null && question.stale === null;
  return (
    <article
      aria-label={question.question.title}
      data-testid="questions-question"
      className={classNames('flex min-h-0 flex-col gap-3', isPhone ? 'grow' : 'h-full')}
    >
      <header className="flex min-w-0 flex-col gap-0.5">
        <h2 className="min-w-0 text-heading font-semibold [overflow-wrap:anywhere]">{question.question.title}</h2>
        <p className="flex flex-wrap items-center gap-1 text-meta text-muted-foreground">
          From <ShipName name={sender.name} shipId={sender.id} isSuffixShown /> ·{' '}
          <time dateTime={question.message.sentAt} title={fullDateTime(sentAt)}>
            {shortDateTime(sentAt)}
          </time>
        </p>
        {question.replaces === null ? null : (
          <p className="flex flex-wrap items-baseline gap-1 text-meta text-muted-foreground">
            Replaces{' '}
            <QuestionLink deliveryId={question.replaces.deliveryId} title={question.replaces.title} onSelect={onSelect} testId="questions-replaces" />
          </p>
        )}
      </header>
      <AnsweredNotice question={question} />
      <StaleNotice question={question} onSelect={onSelect} />
      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto">
        {question.question.context === '' ? null : (
          <p className="text-body whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] max-sm:text-body-touch">{question.question.context}</p>
        )}
        {!isAnswerable || isReadOnly ? (
          <OptionList question={question} />
        ) : (
          <AnswerForm question={question} onAnswer={onAnswer} isPending={pendingIds.has(question.deliveryId)} isPhone={isPhone} />
        )}
      </div>
      {isReadOnly && isAnswerable ? (
        <p data-testid="questions-read-only" className="border-t border-border pt-3 text-meta text-muted-foreground">
          Read-only: you see argo’s questions, and can’t answer them.
        </p>
      ) : null}
    </article>
  );
}

/**
 * Questions to argo (decision 0038): the messages in argo's inbox that ask
 * the operator a question, each with its context, numbered options and the
 * asker's pick and why. A question is open until it is answered, whatever its
 * delivery's state. Answering picks one option with an optional note, or sends
 * a note alone, as a reply to the asking ship. A question its asker withdrew
 * or replaced is stale: it can't be answered and links to its replacement,
 * which links back. Laid out as the operator inbox:
 * two panes on desktop, the list and a pushed page on phone. Read-only, for a
 * viewer session, it shows the questions and nothing that answers them.
 */
export function OperatorQuestions({
  questions,
  filter,
  onFilterChange,
  counts,
  selectedId,
  onSelect,
  state,
  onRetry,
  now,
  ...actions
}: OperatorQuestionsProps) {
  if (state === 'loading') {
    return (
      <div data-slot="operator-questions" data-state="loading" className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <LoadingSkeleton variant="list" rows={5} label="Loading the questions" />
        <LoadingSkeleton variant="detail" label="Loading the question" className="max-sm:hidden" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div data-slot="operator-questions" data-state="error" data-testid="questions-error">
        <InlineError
          variant="page"
          title="Couldn’t load the questions"
          description="This page couldn’t reach the fleet server. Questions to argo are stored on the server, so nothing is lost."
          onRetry={onRetry}
        />
      </div>
    );
  }

  const selected = questions.find((question) => question.deliveryId === selectedId);
  const filterTabs = <FilterTabs filter={filter} onFilterChange={onFilterChange} counts={counts} />;
  const empty = (
    <div data-testid="questions-empty">
      <EmptyState
        icon={<CircleHelp />}
        title={EMPTY[filter].title}
        description={EMPTY[filter].description}
      />
    </div>
  );

  return (
    <div data-slot="operator-questions" data-state="ready">
      <div className="grid min-h-128 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden rounded-lg border border-border bg-card max-sm:hidden">
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="border-b border-border p-2.5">{filterTabs}</div>
          {questions.length === 0 ? (
            <div className="p-4">{empty}</div>
          ) : (
            <QuestionList questions={questions} selectedId={selectedId} onSelect={onSelect} now={now} />
          )}
        </div>
        <div className="flex min-h-0 flex-col bg-background p-5">
          {selected ? (
            <QuestionPane question={selected} isPhone={false} onSelect={onSelect} {...actions} />
          ) : (
            <p className="m-auto text-meta text-muted-foreground">
              {questions.length === 0 ? null : actions.isReadOnly === true ? 'Choose a question to read it.' : 'Choose a question to answer it.'}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:hidden">
        {selected ? (
          <>
            <Button
              variant="ghost"
              size="touch"
              icon={<ChevronLeft aria-hidden />}
              className="-ml-2 self-start"
              data-testid="questions-back"
              onClick={() => {
                onSelect(undefined);
              }}
            >
              Questions
            </Button>
            <QuestionPane question={selected} isPhone onSelect={onSelect} {...actions} />
          </>
        ) : (
          <>
            {filterTabs}
            {questions.length === 0 ? empty : <QuestionList questions={questions} selectedId={selectedId} onSelect={onSelect} now={now} />}
          </>
        )}
      </div>
    </div>
  );
}
