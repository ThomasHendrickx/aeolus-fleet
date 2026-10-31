'use client';

import type { MessageDetail, MessageId } from '@aeolus-fleet/common';
import { CornerDownRight, MailQuestion, Reply } from 'lucide-react';
import type { ReactNode } from 'react';

import { formattedPayload, payloadLabel } from '../../../../lib/payload';
import { payloadSealingOf } from '../../../../lib/payload-sealing';
import { fullDateTime, relativeTime } from '../../../../lib/relative-time';
import { OPERATOR_NAME, ship, text, type SentencePart } from '../../../../lib/sentence';
import { CodeBlock } from '../../../../components/atoms/code-block';
import { Button, Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@aeolus-fleet/ui';
import { CopyButton } from '../../../../components/atoms/copy-button';
import { Skeleton } from '../../../../components/atoms/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/atoms/tabs';
import { EmptyState } from '../../../../components/molecules/empty-state';
import { PayloadNotReachable } from '../../../../components/molecules/payload-not-reachable';
import { SealedMark } from '../../../../components/molecules/sealed-mark';
import { Sentence } from '../molecules/sentence';
import { ShipName } from '../../../../components/molecules/ship-name';
import { statusLabel } from '../../../../components/molecules/status-badge';
import { messageWay, type WayMachine } from '../../services/message-way';
import { WayLines } from '../molecules/way-lines';
import { RecipientProgress } from '../molecules/recipient-progress';
import { DeliveryHistory } from './delivery-history';
import { labelSelectionWords, recipientGroupWords } from '../../../../lib/recipient';

interface MessageSheetProps {
  /** The message, once loaded. */
  message: MessageDetail | undefined;
  /** The id the sheet was opened with, shown when no such message exists. */
  messageId?: MessageId;
  state: 'ready' | 'loading' | 'not-found';
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Replies to the message as argo, to its sender; offered when someone other than argo sent it. */
  onReply?: (message: MessageDetail) => void;
  /** Opens another message in the sheet: a reply beneath this one. */
  onOpenMessage?: (messageId: MessageId) => void;
  now: Date;
  /** The trierarch plugin's machines, when it is on: a silent trierarch shows on the way. */
  machines?: readonly WayMachine[];
  /** The deliveries of a send to a label, a page at a time: MessageDeliveries. */
  deliveries?: ReactNode;
}

const SECTION_TITLE = 'text-section font-semibold text-foreground';

function recipientParts(message: MessageDetail): SentencePart[] {
  return message.recipient.kind === 'ship'
    ? [text('To '), ship(message.recipient.ship)]
    : [text(`To ${recipientGroupWords(message.recipient)}`)];
}

/** Where the message stands: its delivery's way, or for a label how many ships it went to, each delivery on its own. */
function standing(message: MessageDetail, at: { now: Date; machines: readonly WayMachine[] }): string {
  if ((message.recipient.kind === 'label' || message.recipient.kind === 'meeting')) {
    const count = message.deliveryCount;
    return `${count} ${count === 1 ? 'delivery' : 'deliveries'}`;
  }
  return statusLabel(messageWay(message, at).status);
}

function EnvelopeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <dt className="w-24 shrink-0 text-meta text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-body text-foreground">{children}</dd>
    </div>
  );
}

function Envelope({ message }: { message: MessageDetail }) {
  const recipient = message.recipient;
  return (
    <dl aria-label="Envelope" className="overflow-hidden rounded-lg border border-border bg-card">
      <EnvelopeRow label="Message id">
        <span className="truncate font-mono text-id">{message.id}</span>
        <CopyButton value={message.id} label="Copy message id" />
      </EnvelopeRow>
      <EnvelopeRow label="From">
        <ShipName
          name={message.sender.name}
          shipId={message.sender.id}
          isSuffixShown={message.sender.name !== OPERATOR_NAME}
        />
      </EnvelopeRow>
      <EnvelopeRow label="To">
        {recipient.kind === 'ship' ? (
          <ShipName
            name={recipient.ship.name}
            shipId={recipient.ship.id}
            isSuffixShown={recipient.ship.name !== OPERATOR_NAME}
          />
        ) : recipient.kind === 'type' ? (
          <span>
            Any ship of type <span className="font-mono text-id">{recipient.type}</span>
          </span>
        ) : recipient.kind === 'meeting' ? (
          <span>
            Every other participant of meeting <span className="font-mono text-id">{recipient.meetingId}</span>
          </span>
        ) : (
          <span>
            Every ship carrying <span className="font-mono text-id">{labelSelectionWords(recipient.values)}</span>
          </span>
        )}
      </EnvelopeRow>
      <EnvelopeRow label="Sent">
        <time dateTime={message.sentAt} className="tabular-nums">
          {fullDateTime(new Date(message.sentAt))}
        </time>
      </EnvelopeRow>
      {message.model === null ? null : (
        <EnvelopeRow label="Model">
          <span className="truncate font-mono text-id" data-testid="message-model">
            {message.model}
          </span>
        </EnvelopeRow>
      )}
      {message.inReplyTo ? (
        <EnvelopeRow label="In reply to">
          <span className="truncate font-mono text-id">{message.inReplyTo}</span>
        </EnvelopeRow>
      ) : null}
    </dl>
  );
}

/**
 * The payload, Formatted for JSON or Raw; in a sealed fleet marked Sealed,
 * and while its company key is not reachable a panel in its place (decision
 * 0068, N1, scenario 25).
 */
function Payload({ message }: { message: MessageDetail }) {
  const sealing = payloadSealingOf(message);
  const mark = sealing === 'plain' ? null : <SealedMark testId="message-sealed" />;
  if (sealing === 'keyNotReachable') {
    return (
      <section aria-label="Payload" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={SECTION_TITLE}>Payload</h3>
          {mark}
        </div>
        <PayloadNotReachable testId="message-payload-not-reachable" />
      </section>
    );
  }
  const label = payloadLabel(message.payload, message.contentType);
  const formatted = formattedPayload(message.payload, message.contentType);
  const raw = <CodeBlock label={label} code={message.payload} isWrapped copyLabel="Copy payload" codeTestId="message-payload" />;
  if (formatted === undefined) {
    return (
      <section aria-label="Payload" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={SECTION_TITLE}>Payload</h3>
          {mark}
        </div>
        {raw}
      </section>
    );
  }
  return (
    <section aria-label="Payload" className="flex flex-col gap-2">
      <Tabs defaultValue="formatted" className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={SECTION_TITLE}>Payload</h3>
          <span className="flex items-center gap-3">
            {mark}
            <TabsList className="max-sm:w-auto">
              <TabsTrigger value="formatted">Formatted</TabsTrigger>
              <TabsTrigger value="raw">Raw</TabsTrigger>
            </TabsList>
          </span>
        </div>
        <TabsContent value="formatted">
          <CodeBlock label={label} code={formatted} copyValue={message.payload} copyLabel="Copy payload" codeTestId="message-payload" />
        </TabsContent>
        <TabsContent value="raw">{raw}</TabsContent>
      </Tabs>
    </section>
  );
}

function Replies({ message, now, onOpenMessage }: { message: MessageDetail; now: Date; onOpenMessage?: (messageId: MessageId) => void }) {
  if (message.replies.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Replies" data-testid="message-replies" className="flex flex-col gap-1 border-t border-border pt-3">
      {message.replies.map((reply) => (
        <li key={reply.id} className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground max-sm:text-body-touch">
          <CornerDownRight aria-hidden className="size-3.5 shrink-0" />
          <span>Reply from</span>
          <ShipName name={reply.sender.name} shipId={reply.sender.id} isSuffixShown={reply.sender.name !== OPERATOR_NAME} />
          <time dateTime={reply.sentAt} title={fullDateTime(new Date(reply.sentAt))}>
            {relativeTime(new Date(reply.sentAt), now)}
          </time>
          {onOpenMessage ? (
            <Button
              size="xs"
              variant="ghost"
              data-testid="message-reply-open"
              onClick={() => {
                onOpenMessage(reply.id);
              }}
            >
              Open
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Delivery({
  message,
  now,
  machines,
  onOpenMessage,
  deliveries,
}: {
  message: MessageDetail;
  now: Date;
  machines: readonly WayMachine[];
  onOpenMessage?: (messageId: MessageId) => void;
  deliveries?: ReactNode;
}) {
  if ((message.recipient.kind === 'label' || message.recipient.kind === 'meeting')) {
    return (
      <section aria-label="Deliveries" className="flex flex-col gap-2 max-sm:order-first">
        <h3 className={SECTION_TITLE}>Deliveries</h3>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
          {deliveries}
          <Replies message={message} now={now} {...(onOpenMessage ? { onOpenMessage } : {})} />
        </div>
      </section>
    );
  }
  const way = messageWay(message, { now, machines });
  return (
    <section aria-label="Delivery" className="flex flex-col gap-2 max-sm:order-first">
      <h3 className={SECTION_TITLE}>Delivery</h3>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <WayLines status={way.status} lines={way.lines} />
        <RecipientProgress progress={message.progress} now={now} />
        <div className="border-t border-border pt-3">
          <DeliveryHistory entries={message.delivery.history} recipient={message.recipient} />
        </div>
        <Replies message={message} now={now} {...(onOpenMessage ? { onOpenMessage } : {})} />
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <span className="sr-only">Loading the message</span>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

/**
 * One message without leaving the page (docs/design/png/MessageSheet.png):
 * envelope, payload (Formatted for JSON, or Raw) and its delivery: where it
 * stands on its way, its DeliveryHistory and the replies beneath it; a send
 * to a label lists its deliveries with their ship and state instead, a page
 * at a time (decision 0065), each delivery on its own. A
 * 560 px side sheet on desktop; full width on phone, where the delivery comes
 * first. Reply answers its sender as argo, through Compose with the
 * recipient and the reply already set.
 */
export function MessageSheet({ message, messageId, state, isOpen, onOpenChange, onReply, onOpenMessage, now, machines = [], deliveries }: MessageSheetProps) {
  const isReady = state === 'ready' && message !== undefined;
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" data-testid="message-sheet">
        <SheetHeader>
          {isReady ? (
            <>
              <SheetTitle className="flex min-w-0 items-baseline gap-1.5">
                <span>Message from</span>
                <ShipName
                  name={message.sender.name}
                  shipId={message.sender.id}
                  isSuffixShown={message.sender.name !== OPERATOR_NAME}
                  className="text-heading"
                />
              </SheetTitle>
              <SheetDescription>
                <Sentence parts={recipientParts(message)} />. {standing(message, { now, machines })}.
              </SheetDescription>
              {onReply && message.sender.name !== OPERATOR_NAME ? (
                <div>
                  <Button
                    size="xs"
                    icon={<Reply />}
                    data-testid="message-reply"
                    onClick={() => {
                      onReply(message);
                    }}
                  >
                    Reply to {message.sender.name}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <SheetTitle>Message</SheetTitle>
              <SheetDescription>{state === 'not-found' ? 'Couldn’t open this message' : 'Loading'}</SheetDescription>
            </>
          )}
        </SheetHeader>
        <SheetBody className="flex flex-col gap-5">
          {state === 'loading' ? <Loading /> : null}
          {state === 'not-found' ? (
            <EmptyState
              variant="section"
              icon={<MailQuestion />}
              title="Message not found"
              description={
                <>
                  No message with this id exists in this fleet, or the link is incomplete.
                  {messageId ? <span className="mt-2 block font-mono text-id">{messageId}</span> : null}
                </>
              }
            />
          ) : null}
          {isReady ? (
            <>
              <Envelope message={message} />
              <Payload message={message} />
              <Delivery message={message} now={now} machines={machines} deliveries={deliveries} {...(onOpenMessage ? { onOpenMessage } : {})} />
            </>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
