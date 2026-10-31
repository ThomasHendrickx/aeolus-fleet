'use client';

import type { MessageId, ShipId } from '@aeolus-fleet/common';
import { Copy, Ellipsis, MailOpen, Ship } from 'lucide-react';
import Link from 'next/link';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@aeolus-fleet/ui';
import { showToast } from '../../../../components/atoms/toast';

interface MessageMenuProps {
  messageId: MessageId;
  shipId: ShipId;
  shipName: string;
  /** Brings back the dot; none for a message that is done or a read-only session. */
  onMarkUnread?: () => void;
  size: 'sm' | 'touch';
}

/** The open message's menu (#849): Mark as unread, Copy message id and Open its ship. */
export function MessageMenu({ messageId, shipId, shipName, onMarkUnread, size }: MessageMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size={size} isIconOnly aria-label="Message actions" icon={<Ellipsis />} data-testid="inbox-message-menu" />} />
      <DropdownMenuContent align="end">
        {onMarkUnread === undefined ? null : (
          <DropdownMenuItem onClick={onMarkUnread} data-testid="inbox-mark-unread">
            <MailOpen aria-hidden />
            Mark as unread
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          data-testid="inbox-copy-message-id"
          onClick={() => {
            navigator.clipboard.writeText(messageId).then(
              () => {
                showToast({ title: 'Message id copied' });
              },
              () => {
                showToast({ title: 'Couldn’t copy the message id', description: messageId, tone: 'error' });
              },
            );
          }}
        >
          <Copy aria-hidden />
          Copy message id
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/ships/${shipId}`} />} data-testid="inbox-open-ship">
          <Ship aria-hidden />
          Open {shipName}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
