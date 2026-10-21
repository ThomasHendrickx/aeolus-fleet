'use client';

import { Check, CircleCheck, ExternalLink, GitPullRequest, Send, Server, CircleDot } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button, classNames, Kbd } from '@aeolus-fleet/common/header';
import type { MessageEntry } from '../../../../lib/inbox-entry';
import type { ThreadMessage } from '../../../../lib/inbox-thread';
import type { KnownLink } from '../../../../lib/message-document';
import { clockTime, fullDateTime, shortDateTime } from '../../../../lib/relative-time';
import { sendShortcutAria, submitOnSendShortcut, useShortcutPlatform } from '../../../../lib/send-shortcut';
import { Badge } from '../../../../components/atoms/badge';
import { Textarea } from '../../../../components/atoms/textarea';
import { SendShortcutHint } from '../../../../components/molecules/send-shortcut-hint';
import { ShipName } from '../../../../components/molecules/ship-name';
import { MessageBody } from '../molecules/message-body';
import { MessageMenu } from '../molecules/message-menu';

/** The reply field the R key focuses. */
export const REPLY_FIELD_SELECTOR = '[data-reply-field]';

export interface MessageReaderProps {
  message: MessageEntry;
  /** The messages it replies to, oldest first; undefined while they load or when they could not be read. */
  thread: readonly ThreadMessage[] | undefined;
  isPhone: boolean;
  onReply: (payload: string) => void;
  onMarkDone: () => void;
  onMarkUnread: () => void;
  isPending: boolean;
  /** A session that may not receive (a viewer's): nothing that changes the message. */
  isReadOnly?: boolean;
}

function LinkRow({ link }: { link: KnownLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid="inbox-link-row"
      className="flex max-w-md items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      {link.kind === 'pull' ? <GitPullRequest aria-hidden className="size-(--size-icon) shrink-0" /> : <CircleDot aria-hidden className="size-(--size-icon) shrink-0" />}
      <span className="flex min-w-0 grow flex-col">
        <span className="text-meta font-medium text-foreground">{link.kind === 'pull' ? 'Pull request' : 'Issue'}</span>
        <span className="truncate font-mono text-id text-muted-foreground">
          {link.repository} #{link.number}
        </span>
      </span>
      <ExternalLink aria-hidden className="size-(--size-icon-sm) shrink-0 text-muted-foreground" />
    </a>
  );
}

function ThreadBubble({ name, isArgo, sentAt, children }: { name: string; isArgo: boolean; sentAt: string; children: ReactNode }) {
  const at = new Date(sentAt);
  return (
    <li
      data-testid="inbox-thread-message"
      className={classNames('flex flex-col gap-1 rounded-lg border px-3.5 py-2.5', isArgo ? 'ml-10 border-transparent bg-muted max-sm:ml-8' : 'mr-10 border-border bg-card max-sm:mr-0')}
    >
      <p className="text-meta text-muted-foreground">
        <span className="font-medium text-foreground">{isArgo ? 'argo (you)' : name}</span> ·{' '}
        <time dateTime={sentAt} title={fullDateTime(at)}>
          {shortDateTime(at)}
        </time>
      </p>
      {children}
    </li>
  );
}

function Thread({ thread, message }: { thread: readonly ThreadMessage[] | undefined; message: MessageEntry }) {
  if ((thread === undefined || thread.length === 0) && message.replies.length === 0) {
    return null;
  }
  return (
    <section aria-label="In this thread" className="flex max-w-xl flex-col gap-2">
      {thread === undefined || thread.length === 0 ? null : (
        <>
          <h2 className="text-meta text-muted-foreground">In this thread</h2>
          <ul className="flex flex-col gap-2">
            {thread.map((each) => (
              <ThreadBubble key={each.id} name={each.sender.name} isArgo={each.isArgo} sentAt={each.sentAt}>
                <p className="text-body font-medium text-foreground [overflow-wrap:anywhere]">{each.text.headline}</p>
                <MessageBody blocks={each.text.body} lineCount={each.text.lineCount} />
              </ThreadBubble>
            ))}
          </ul>
        </>
      )}
      {message.replies.length === 0 ? null : (
        <>
          <h2 className="text-meta text-muted-foreground">Your replies</h2>
          <ul className="flex flex-col gap-2">
            {message.replies.map((reply) => (
              <ThreadBubble key={reply.id} name="argo" isArgo sentAt={reply.sentAt}>
                <p className="text-body text-foreground [overflow-wrap:anywhere]">{reply.text.headline}</p>
                <MessageBody blocks={reply.text.body} lineCount={reply.text.lineCount} />
              </ThreadBubble>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DoneNotice({ message }: { message: MessageEntry }) {
  if (message.doneAt === null) {
    return null;
  }
  const doneAt = new Date(message.doneAt);
  return (
    <p
      data-testid="inbox-done-notice"
      className="flex items-center gap-2 rounded-md border border-tone-ok-border bg-tone-ok-bg px-3 py-2 text-meta text-tone-ok-fg [&_svg]:size-(--size-icon-sm) [&_svg]:shrink-0"
    >
      <CircleCheck aria-hidden />
      Done at{' '}
      <time dateTime={message.doneAt} title={fullDateTime(doneAt)}>
        {clockTime(doneAt)}
      </time>
      {message.repliedWith === null ? '.' : ', when you replied.'}
    </p>
  );
}

/** The bar pinned to the bottom: a reply field and Done, which turns into Send reply once something is written. */
function ActionBar({ message, onReply, onMarkDone, isPending, isPhone }: Pick<MessageReaderProps, 'message' | 'onReply' | 'onMarkDone' | 'isPending' | 'isPhone'>) {
  const [draft, setDraft] = useState('');
  const platform = useShortcutPlatform();
  const isDone = message.state === 'acknowledged';
  const hasDraft = draft.trim() !== '';
  const sender = message.sender.name;
  return (
    <form
      data-testid="inbox-action-bar"
      className="flex items-end gap-2 border-t border-border bg-background px-5 py-3 max-sm:px-4 max-sm:pb-[calc(env(safe-area-inset-bottom)+var(--spacing)*3)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (hasDraft && !isPending) {
          onReply(draft);
        }
      }}
    >
      <Textarea
        data-reply-field
        rows={hasDraft ? 3 : 1}
        size={isPhone ? 'touch' : 'md'}
        aria-label={`Reply to ${sender}`}
        placeholder={`Reply to ${sender}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={submitOnSendShortcut}
        data-testid="inbox-reply"
      />
      {hasDraft || isDone ? (
        <Button
          type="submit"
          variant="primary"
          size={isPhone ? 'touch' : 'md'}
          icon={<Send aria-hidden />}
          isLoading={isPending}
          disabled={!hasDraft && !isPending}
          aria-keyshortcuts={platform === null ? undefined : sendShortcutAria(platform)}
          data-testid="inbox-reply-send"
        >
          Send reply
          {platform === null || isPhone ? null : <SendShortcutHint platform={platform} />}
        </Button>
      ) : (
        <Button
          type="button"
          variant="primary"
          size={isPhone ? 'touch' : 'md'}
          icon={<Check aria-hidden />}
          isLoading={isPending}
          aria-keyshortcuts="E"
          data-testid="inbox-mark-done"
          onClick={onMarkDone}
        >
          Done
          {isPhone ? null : (
            <Kbd aria-hidden className="border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground">
              E
            </Kbd>
          )}
        </Button>
      )}
    </form>
  );
}

/**
 * An open message to argo (#849): its headline as the title, the ship, time
 * and model, the body rendered (paragraphs, lists, links), a row for each
 * GitHub pull request or issue it links to, and the thread it answers. A
 * plugin ship's message carries the plugin mark and its type. The bar at the
 * bottom holds the reply field and Done. Read-only for a viewer.
 */
export function MessageReader({ message, thread, isPhone, onReply, onMarkDone, onMarkUnread, isPending, isReadOnly = false }: MessageReaderProps) {
  const sentAt = new Date(message.sentAt);
  const { sender, text } = message;
  const isDone = message.state === 'acknowledged';
  return (
    <article aria-label={text.headline === '' ? `Message from ${sender.name}` : text.headline} data-testid="inbox-message" className="flex min-h-0 grow flex-col">
      {isPhone ? null : (
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          <span className="text-meta text-muted-foreground">Message</span>
          <span className="ml-auto flex items-center gap-1">
            {isDone || isReadOnly ? null : (
              <Button variant="ghost" size="sm" disabled={isPending} onClick={onMarkUnread} data-testid="inbox-mark-unread">
                Mark as unread
              </Button>
            )}
            <MessageMenu messageId={message.messageId} shipId={sender.id} shipName={sender.name} size="sm" />
          </span>
        </div>
      )}
      <div className="flex min-h-0 grow flex-col gap-5 overflow-y-auto px-5 py-5 max-sm:px-0 max-sm:py-3.5">
        <header className="flex flex-col gap-1.5">
          {message.isFromPlugin ? (
            <span className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted">
                <Server aria-hidden className="size-(--size-icon-sm)" />
              </span>
              {sender.type === null ? null : <Badge variant="outline">{sender.type}</Badge>}
            </span>
          ) : null}
          <h2 className="text-heading font-semibold [overflow-wrap:anywhere] max-sm:text-title-touch">{text.headline === '' ? 'No text' : text.headline}</h2>
          <p className="flex flex-wrap items-center gap-1 text-meta text-muted-foreground">
            <ShipName name={sender.name} shipId={sender.id} isSuffixShown={sender.isNameShared} size="meta" className="[&>span:first-child]:text-foreground" />
            <span aria-hidden>·</span>
            <time dateTime={message.sentAt} title={fullDateTime(sentAt)}>
              {shortDateTime(sentAt)}
            </time>
            {message.model === null ? null : (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono text-id">{message.model}</span>
              </>
            )}
          </p>
        </header>
        <DoneNotice message={message} />
        <MessageBody blocks={text.body} lineCount={text.lineCount} />
        {text.links.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            {text.links.map((link) => (
              <LinkRow key={link.url} link={link} />
            ))}
          </div>
        )}
        <Thread thread={thread} message={message} />
      </div>
      {isReadOnly ? (
        <p data-testid="inbox-read-only" className="border-t border-border px-5 py-3 text-meta text-muted-foreground">
          Read-only: you see argo’s inbox, and can’t reply or mark messages done.
        </p>
      ) : (
        <div className={isPhone ? 'sticky bottom-0 -mx-4' : undefined}>
          <ActionBar
            // A message that becomes done starts a fresh reply; a failed reply keeps its draft.
            key={`${message.deliveryId}-${message.state}`}
            message={message}
            onReply={onReply}
            onMarkDone={onMarkDone}
            isPending={isPending}
            isPhone={isPhone}
          />
        </div>
      )}
    </article>
  );
}
