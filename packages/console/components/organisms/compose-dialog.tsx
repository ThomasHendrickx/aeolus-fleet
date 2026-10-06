'use client';

import { PAYLOAD_MAX_BYTES, payloadBytes, type ListedShip } from '@aeolus-fleet/common';
import { Send } from 'lucide-react';
import { useId, useState } from 'react';

import { sendShortcutAria, submitOnSendShortcut, useShortcutPlatform } from '../../lib/send-shortcut';
import { Button } from '../atoms/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../atoms/dialog';
import { dialogSurface } from '../atoms/dialog-surface';
import { Label } from '../atoms/label';
import { Textarea } from '../atoms/textarea';
import { InlineError } from '../molecules/inline-error';
import { LimitNotice } from '../molecules/limit-notice';
import { composeRefusedNotice } from '../../lib/limits';
import { SelectorPicker, type SelectorMode, type SelectorValue } from '../molecules/selector-picker';
import { SendShortcutHint } from '../molecules/send-shortcut-hint';

interface ComposeDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  ships: readonly ListedShip[];
  types: readonly string[];
  state: 'editing' | 'sending' | 'failed';
  /** The server's refusal to show, kept with the operator's input. */
  error?: string;
  /** The daily message limit that refused it: the dialog says so instead (canvas 12.3). */
  messageLimit?: { limit: number; resetsAt: string };
  /** Where the hosted account lists the limits, for View limits. */
  accountUrl?: string;
  onSend: (message: { selector: SelectorValue; payload: string }) => void;
  /** What the form starts with when it opens; empty when not given. */
  draft?: { selector: SelectorValue; payload: string };
}

type ComposeFormProps = Omit<ComposeDialogProps, 'isOpen' | 'onOpenChange'>;

/**
 * The fields, mounted only while the dialog is open, so each opening starts
 * empty while a failed send keeps what the operator wrote.
 */
function ComposeForm({ ships, types, state, error, messageLimit, accountUrl, onSend, draft }: ComposeFormProps) {
  const payloadId = useId();
  const sizeErrorId = useId();
  const [mode, setMode] = useState<SelectorMode>(draft?.selector.kind ?? 'ship');
  const [selector, setSelector] = useState<SelectorValue | null>(draft?.selector ?? null);
  const [payload, setPayload] = useState(draft?.payload ?? '');
  const isTooLarge = payloadBytes(payload) > PAYLOAD_MAX_BYTES;
  const isSending = state === 'sending';
  const canSend = selector !== null && payload.trim() !== '' && !isTooLarge && !isSending;
  const platform = useShortcutPlatform();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) {
          onSend({ selector, payload });
        }
      }}
    >
      <SelectorPicker
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setSelector(null);
        }}
        value={selector}
        onChange={setSelector}
        ships={ships}
        types={types}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={payloadId}>Message</Label>
        <Textarea
          id={payloadId}
          isMono
          rows={6}
          value={payload}
          onChange={(event) => {
            setPayload(event.target.value);
          }}
          onKeyDown={submitOnSendShortcut}
          placeholder="What the ship should do, and where the work lives"
          aria-invalid={isTooLarge}
          aria-describedby={isTooLarge ? sizeErrorId : undefined}
          data-testid="compose-payload"
        />
        {isTooLarge ? (
          <InlineError variant="field" id={sizeErrorId} title="A message is at most 64 KB. Send a reference to where the content lives." />
        ) : (
          <p className="text-meta text-muted-foreground">Sent as plain text from argo, stored before the fleet says OK.</p>
        )}
      </div>
      {state === 'failed' && messageLimit !== undefined ? (
        <LimitNotice {...composeRefusedNotice(messageLimit)} accountUrl={accountUrl} testId="compose-message-limit" />
      ) : state === 'failed' && error !== undefined ? (
        <InlineError
          title="Couldn’t send the message"
          description={`${error} Nothing was sent; your message is kept here.`}
        />
      ) : null}
      <DialogFooter>
        <DialogClose render={<Button disabled={isSending} />}>Cancel</DialogClose>
        <Button
          type="submit"
          variant="primary"
          icon={<Send aria-hidden />}
          disabled={!canSend && !isSending}
          isLoading={isSending}
          aria-keyshortcuts={platform === null ? undefined : sendShortcutAria(platform)}
          data-testid="compose-send"
        >
          Send
          {platform === null ? null : <SendShortcutHint platform={platform} />}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Compose: a new message from argo to one ship or any ship of a type. A
 * dialog on desktop, the full screen on phone, as a form dialog is
 * (docs/design/conventions.md). Send stays disabled until it has a recipient
 * and a message; while sending, only Send shows progress. A refusal keeps the
 * operator's input and says nothing was sent.
 */
export function ComposeDialog({ isOpen, onOpenChange, ...form }: ComposeDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="compose-dialog" className={dialogSurface.phoneFullScreen}>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>From argo. The ship receives it the next time its session asks for work.</DialogDescription>
        </DialogHeader>
        <ComposeForm {...form} />
      </DialogContent>
    </Dialog>
  );
}
