'use client';

import type { MessageDetail, MessageId } from '@aeolus-fleet/common';
import { MailQuestion } from 'lucide-react';
import type { ReactNode } from 'react';

import { formattedPayload, payloadLabel } from '../../lib/payload';
import { fullDateTime } from '../../lib/relative-time';
import { OPERATOR_NAME, ship, text, type SentencePart } from '../../lib/sentence';
import { CodeBlock } from '../atoms/code-block';
import { CopyButton } from '../atoms/copy-button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../atoms/sheet';
import { Skeleton } from '../atoms/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../atoms/tabs';
import { EmptyState } from '../molecules/empty-state';
import { Sentence } from '../molecules/sentence';
import { ShipName } from '../molecules/ship-name';
import { statusLabel } from '../molecules/status-badge';
import { DeliveryHistory } from './delivery-history';

interface MessageSheetProps {
  /** The message, once loaded. */
  message: MessageDetail | undefined;
  /** The id the sheet was opened with, shown when no such message exists. */
  messageId?: MessageId;
  state: 'ready' | 'loading' | 'not-found';
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const SECTION_TITLE = 'text-section font-semibold text-foreground';

function recipientParts(message: MessageDetail): SentencePart[] {
  return message.recipient.kind === 'ship'
    ? [text('To '), ship(message.recipient.ship)]
    : [text(`To any ship of type ${message.recipient.type}`)];
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
        ) : (
          <span>
            Any ship of type <span className="font-mono text-id">{recipient.type}</span>
          </span>
        )}
      </EnvelopeRow>
      <EnvelopeRow label="Sent">
        <time dateTime={message.sentAt} className="tabular-nums">
          {fullDateTime(new Date(message.sentAt))}
        </time>
      </EnvelopeRow>
      {message.inReplyTo ? (
        <EnvelopeRow label="In reply to">
          <span className="truncate font-mono text-id">{message.inReplyTo}</span>
        </EnvelopeRow>
      ) : null}
    </dl>
  );
}

function Payload({ message }: { message: MessageDetail }) {
  const label = payloadLabel(message.payload, message.contentType);
  const formatted = formattedPayload(message.payload, message.contentType);
  const raw = <CodeBlock label={label} code={message.payload} isWrapped copyLabel="Copy payload" codeTestId="message-payload" />;
  if (formatted === undefined) {
    return (
      <section aria-label="Payload" className="flex flex-col gap-2">
        <h3 className={SECTION_TITLE}>Payload</h3>
        {raw}
      </section>
    );
  }
  return (
    <section aria-label="Payload" className="flex flex-col gap-2">
      <Tabs defaultValue="formatted" className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={SECTION_TITLE}>Payload</h3>
          <TabsList className="max-sm:w-auto">
            <TabsTrigger value="formatted">Formatted</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="formatted">
          <CodeBlock label={label} code={formatted} copyValue={message.payload} copyLabel="Copy payload" codeTestId="message-payload" />
        </TabsContent>
        <TabsContent value="raw">{raw}</TabsContent>
      </Tabs>
    </section>
  );
}

function Delivery({ message }: { message: MessageDetail }) {
  return (
    <section aria-label="Delivery" className="flex flex-col gap-2 max-sm:order-first">
      <h3 className={SECTION_TITLE}>Delivery</h3>
      <div className="rounded-lg border border-border bg-card p-3">
        <DeliveryHistory entries={message.delivery.history} recipient={message.recipient} />
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
 * envelope, payload (Formatted for JSON, or Raw) and its DeliveryHistory. A
 * 560 px side sheet on desktop; full width on phone, where the delivery comes
 * first. Resend and Dismiss come with Needs attention.
 */
export function MessageSheet({ message, messageId, state, isOpen, onOpenChange }: MessageSheetProps) {
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
                <Sentence parts={recipientParts(message)} />. {statusLabel(message.delivery.state)}.
              </SheetDescription>
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
              <Delivery message={message} />
            </>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
