'use client';

import type { AnswerChoice, DeliveryId } from '@aeolus-fleet/common';
import { ChevronRight, CircleCheck, CircleHelp, CircleSlash, Pencil, Replace, Send } from 'lucide-react';
import { useId, useState } from 'react';

import { classNames } from '../../../../lib/class-names';
import type { QuestionEntry } from '../../../../lib/inbox-entry';
import { clockTime, duration, fullDateTime, shortDateTime } from '../../../../lib/relative-time';
import { counted } from '../../../../lib/sentence';
import { isSendShortcut, sendShortcutAria, useShortcutPlatform } from '../../../../lib/send-shortcut';
import { Badge } from '../../../../components/atoms/badge';
import { Button } from '../../../../components/atoms/button';
import { Input } from '../../../../components/atoms/input';
import { Label } from '../../../../components/atoms/label';
import { RadioGroup, RadioGroupItem } from '../../../../components/atoms/radio-group';
import { Textarea } from '../../../../components/atoms/textarea';
import { SendShortcutHint } from '../../../../components/molecules/send-shortcut-hint';
import { ShipName } from '../../../../components/molecules/ship-name';
import { answerLabelOf, type QuestionPosition } from '../../services/inbox-moves';

export interface QuestionReaderProps {
  question: QuestionEntry;
  position: QuestionPosition;
  isPhone: boolean;
  onAnswer: (answer: AnswerChoice) => void;
  /** Opens another question: the next open one, a replacement, or the question a replacement replaces. */
  onSelect: (deliveryId: DeliveryId) => void;
  isPending: boolean;
  now: Date;
  /** A session that may not receive (a viewer's): no answer, and a note that says so. */
  isReadOnly?: boolean;
}

type Option = QuestionEntry['question']['options'][number];

function QuestionLink({ deliveryId, title, onSelect, testId }: { deliveryId: DeliveryId; title: string; onSelect: (deliveryId: DeliveryId) => void; testId: string }) {
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

/** "You answered 2. 14 days at 20:31. implementer-c receives it as a reply." */
function AnsweredNotice({ question }: { question: QuestionEntry }) {
  const { answer, options } = question.question;
  if (answer === null) {
    return null;
  }
  const answeredAt = new Date(answer.sentAt);
  const option = options.find(({ key }) => key === answer.option);
  return (
    <div data-testid="inbox-answered" className="flex flex-col gap-1 rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-meta text-tone-ok-fg max-sm:text-body">
      <p className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
        <CircleCheck aria-hidden />
        <span>
          You answered {option === undefined ? 'with a note' : <span className="font-semibold">{`${String(option.key)}. ${option.label}`}</span>} at{' '}
          <time dateTime={answer.sentAt} title={fullDateTime(answeredAt)}>
            {clockTime(answeredAt)}
          </time>
          . {question.sender.name} receives it as a reply.
        </span>
      </p>
      {answer.note === null ? null : <p className="pl-6 whitespace-pre-wrap [overflow-wrap:anywhere]">{answer.note}</p>}
    </div>
  );
}

function StaleNotice({ question, onSelect }: { question: QuestionEntry; onSelect: (deliveryId: DeliveryId) => void }) {
  const { stale } = question;
  if (stale === null) {
    return null;
  }
  const at = new Date(stale.sentAt);
  return (
    <div role="status" data-testid="inbox-stale" className="flex flex-col gap-1 rounded-md border border-tone-ended-border bg-tone-ended-bg px-3 py-2 text-meta text-tone-ended-fg">
      <p className="flex items-center gap-2 [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0">
        {stale.kind === 'withdrawn' ? <CircleSlash aria-hidden /> : <Replace aria-hidden />}
        <span>
          {stale.kind === 'withdrawn' ? 'Withdrawn' : 'Replaced'} by {question.sender.name} at{' '}
          <time dateTime={stale.sentAt} title={fullDateTime(at)}>
            {clockTime(at)}
          </time>
          . It can’t be answered.
        </span>
      </p>
      {stale.kind === 'replaced' ? (
        <p className="flex flex-wrap items-baseline gap-1">
          Answer the new question: <QuestionLink deliveryId={stale.deliveryId} title={stale.by.title} onSelect={onSelect} testId="inbox-replacement" />
        </p>
      ) : null}
    </div>
  );
}

function OptionText({ option, question, isChosen }: { option: Option; question: QuestionEntry; isChosen: boolean }) {
  const { pick } = question.question;
  const isPicked = option.key === pick.option;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2 text-body font-medium text-foreground max-sm:text-body-touch">
        {option.label}
        {isPicked ? <Badge variant="outline">{question.sender.name}’s pick</Badge> : null}
      </span>
      {option.detail === '' ? null : <span className="text-meta text-muted-foreground max-sm:text-body">{option.detail}</span>}
      {isPicked && isChosen ? (
        <span className="mt-1.5 rounded-md bg-muted px-3 py-2 text-meta text-foreground max-sm:text-body">
          <span className="font-semibold">Why:</span> {pick.why}
        </span>
      ) : null}
    </span>
  );
}

/** No option chosen: options are numbered from 1 (decision 0038), so none has it. */
const NO_OPTION = 0;

const OPTION_CARD = 'flex items-start gap-3 rounded-lg border px-4 py-3.5';

/** The options to read, for a question answered, stale or seen read-only: the answer marked. */
function OptionList({ question }: { question: QuestionEntry }) {
  const { options, answer } = question.question;
  return (
    <ol aria-label="Options" className="flex flex-col gap-2">
      {options.map((option) => {
        const isAnswer = answer?.option === option.key;
        return (
          <li key={option.key} data-testid={`inbox-option-${String(option.key)}`} className={classNames(OPTION_CARD, isAnswer ? 'border-2 border-primary bg-card' : 'border-border bg-card')}>
            <OptionText option={option} question={question} isChosen={isAnswer} />
          </li>
        );
      })}
    </ol>
  );
}

function AnswerForm({ question, isPhone, onAnswer, isPending }: Pick<QuestionReaderProps, 'question' | 'isPhone' | 'onAnswer' | 'isPending'>) {
  const id = useId();
  const noteId = `${id}-note`;
  const { options, pick } = question.question;
  const [option, setOption] = useState<number | undefined>(pick.option);
  const [note, setNote] = useState('');
  const [isNoteOpen, setIsNoteOpen] = useState(!isPhone);
  const platform = useShortcutPlatform();
  const asker = question.sender.name;
  const trimmed = note.trim();
  const chosen = options.find(({ key }) => key === option);
  const label = answerLabelOf({ option: chosen?.label, hasNote: trimmed !== '' });
  return (
    <form
      className="flex min-h-0 grow flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (label === undefined || isPending) {
          return;
        }
        onAnswer(option === undefined ? { note: trimmed } : { option, ...(trimmed === '' ? {} : { note: trimmed }) });
      }}
    >
      <div className="flex flex-col gap-4 px-5 pb-5 max-sm:px-0">
        <RadioGroup<number>
          aria-label="Options"
          value={option ?? NO_OPTION}
          onValueChange={(next) => {
            setOption(next);
          }}
          onClickCapture={(event) => {
            // A second tap on the chosen option takes it back, so a note can go alone.
            const tapped = event.target instanceof Element ? event.target.closest('[data-option-key]')?.getAttribute('data-option-key') : undefined;
            if (tapped !== undefined && tapped !== null && Number(tapped) === option) {
              event.preventDefault();
              event.stopPropagation();
              setOption(undefined);
            }
          }}
          className="flex flex-col gap-2"
        >
          {options.map((each) => {
            const itemId = `${id}-option-${String(each.key)}`;
            const isChosen = each.key === option;
            return (
              <div
                key={each.key}
                data-testid={`inbox-option-${String(each.key)}`}
                data-option-key={each.key}
                className={classNames(OPTION_CARD, 'bg-card', isChosen ? 'border-2 border-primary' : 'border-border')}
              >
                <RadioGroupItem
                  id={itemId}
                  value={each.key}
                  className="mt-0.5"
                />
                <label htmlFor={itemId} className="min-w-0 grow cursor-pointer">
                  <OptionText option={each} question={question} isChosen={isChosen} />
                </label>
              </div>
            );
          })}
        </RadioGroup>
        {isPhone && isNoteOpen ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>Note to {asker}</Label>
            <Textarea
              id={noteId}
              rows={3}
              size="touch"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              data-testid="inbox-note"
            />
            <p className="text-body text-muted-foreground">Optional with an option. On its own, it asks for more context or says none fits.</p>
          </div>
        ) : null}
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-border bg-background px-5 py-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+var(--spacing)*3)]">
        {isPhone ? (
          isNoteOpen ? null : (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              icon={<Pencil aria-hidden />}
              data-testid="inbox-add-note"
              onClick={() => {
                setIsNoteOpen(true);
              }}
            >
              Add a note
            </Button>
          )
        ) : (
          <Input
            id={noteId}
            aria-label={`Note to ${asker}`}
            placeholder={`Add a note to ${asker} (optional)`}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter alone never sends an answer; the shortcut does, as in every message field.
              if (event.key === 'Enter') {
                event.preventDefault();
                if (isSendShortcut(event.nativeEvent)) {
                  event.currentTarget.form?.requestSubmit();
                }
              }
            }}
            className="grow"
            data-testid="inbox-note"
          />
        )}
        <Button
          type="submit"
          variant="primary"
          size={isPhone ? 'touch' : 'md'}
          icon={<Send aria-hidden />}
          isLoading={isPending}
          disabled={label === undefined && !isPending}
          aria-keyshortcuts={platform === null ? undefined : sendShortcutAria(platform)}
          className={isPhone ? 'grow' : undefined}
          data-testid="inbox-answer"
        >
          {label ?? 'Pick an option or write a note'}
          {platform === null || isPhone ? null : <SendShortcutHint platform={platform} />}
        </Button>
      </div>
    </form>
  );
}

/** The bar after an answer: how many questions are left, and Next question. */
function NextBar({ position, onSelect, isPhone }: { position: QuestionPosition; onSelect: (deliveryId: DeliveryId) => void; isPhone: boolean }) {
  const { next } = position;
  if (next === undefined) {
    return null;
  }
  return (
    <div className="mt-auto flex flex-col items-stretch gap-2 border-t border-border bg-background px-5 py-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+var(--spacing)*3)] sm:flex-row sm:items-center sm:justify-end">
      <p className="text-center text-meta text-muted-foreground max-sm:text-body">{counted(position.left, { one: 'question left', many: 'questions left' })}</p>
      <Button
        variant="primary"
        size={isPhone ? 'touch' : 'md'}
        data-testid="inbox-next-question"
        onClick={() => {
          onSelect(next);
        }}
      >
        Next question
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}

/**
 * An open question to argo (#849, decision 0038): how long it has waited, the
 * title, who asks, the context and the options as large targets, with the
 * asker's pick chosen and its why under it. Answer names what it sends; a
 * second tap on the chosen option takes it back, so a note goes alone. After
 * the answer, the question says what was sent and offers the next question.
 * A stale question says why it can't be answered.
 */
export function QuestionReader({ question, position, isPhone, onAnswer, onSelect, isPending, now, isReadOnly = false }: QuestionReaderProps) {
  const sentAt = new Date(question.sentAt);
  const { title, context, answer } = question.question;
  const isAnswerable = answer === null && question.stale === null;
  return (
    <article aria-label={title} data-testid="inbox-question" className="flex min-h-0 grow flex-col">
      <div className={classNames('flex min-h-0 grow flex-col overflow-y-auto', isPhone ? undefined : 'pt-5')}>
        <div className="flex flex-col gap-4 px-5 pb-5 max-sm:px-0 max-sm:pt-3.5">
          <AnsweredNotice question={question} />
          <StaleNotice question={question} onSelect={onSelect} />
          <header className="flex flex-col gap-1.5">
            {isAnswerable ? (
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <CircleHelp aria-hidden className="size-(--size-icon-sm)" />
                  Question
                </Badge>
                <span className="text-meta text-muted-foreground">waiting {duration(sentAt, now)}</span>
              </span>
            ) : null}
            <h2 className="text-heading font-semibold [overflow-wrap:anywhere] max-sm:text-title-touch">{title}</h2>
            <p className="flex flex-wrap items-center gap-1 text-meta text-muted-foreground">
              <ShipName name={question.sender.name} shipId={question.sender.id} isSuffixShown={question.sender.isNameShared} size="meta" className="[&>span:first-child]:text-foreground" />
              asks ·{' '}
              <time dateTime={question.sentAt} title={fullDateTime(sentAt)}>
                {shortDateTime(sentAt)}
              </time>
            </p>
            {question.replaces === null ? null : (
              <p className="flex flex-wrap items-baseline gap-1 text-meta text-muted-foreground">
                Replaces <QuestionLink deliveryId={question.replaces.deliveryId} title={question.replaces.title} onSelect={onSelect} testId="inbox-replaces" />
              </p>
            )}
          </header>
          {context === '' ? null : <p className="text-body whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] max-sm:text-body-touch">{context}</p>}
          {!isAnswerable || isReadOnly ? <OptionList question={question} /> : null}
        </div>
        {isAnswerable && !isReadOnly ? <AnswerForm key={question.deliveryId} question={question} isPhone={isPhone} onAnswer={onAnswer} isPending={isPending} /> : null}
      </div>
      {isReadOnly && isAnswerable ? (
        <p data-testid="inbox-read-only" className="border-t border-border px-5 py-3 text-meta text-muted-foreground">
          Read-only: you see argo’s questions, and can’t answer them.
        </p>
      ) : null}
      {isAnswerable ? null : <NextBar position={position} onSelect={onSelect} isPhone={isPhone} />}
    </article>
  );
}
