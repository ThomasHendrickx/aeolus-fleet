'use client';

/** Connects a message task URL to the existing message sheet, including paged recipient progress. */
import type { MessageId } from '@aeolus-fleet/common';
import { useRouter } from 'next/navigation';

import { Button } from '@aeolus-fleet/ui';
import { InlineError } from '../../../components/molecules/inline-error';
import { LoadMore } from '../../../components/molecules/load-more';
import { trpcErrorCode } from '../../../lib/errors';
import { useNow } from '../../../lib/now';
import { useMessage, useMessageDeliveries } from '../../../lib/ship';
import { MessageDeliveries } from '../ui/organisms/message-deliveries';
import { MessageSheet } from '../ui/organisms/message-sheet';

export function MessageTask({ messageId }: { messageId: MessageId }) {
  const router = useRouter();
  const message = useMessage(messageId);
  const deliveries = useMessageDeliveries((message.data?.recipient.kind === 'label' || message.data?.recipient.kind === 'meeting') ? messageId : undefined);
  const now = useNow();
  const isNotFound = trpcErrorCode(message.error) === 'NOT_FOUND';
  if (message.isError && !isNotFound) {
    return <div className="flex flex-col gap-3"><InlineError title="Couldn’t load the message" description="Try again in a moment." /><Button isLoading={message.isFetching} onClick={() => { void message.refetch(); }}>{message.isFetching ? 'Loading...' : 'Try again'}</Button></div>;
  }
  return (
    <MessageSheet
      message={message.data}
      messageId={messageId}
      state={isNotFound ? 'not-found' : message.data ? 'ready' : 'loading'}
      isOpen
      onOpenChange={(isOpen) => { if (!isOpen) { router.push('/'); } }}
      onOpenMessage={(id) => { router.push(`/messages/${id}`); }}
      now={now}
      deliveries={<MessageDeliveries deliveries={deliveries.items ?? []} state={deliveries.isFailed ? 'error' : deliveries.items ? 'ready' : 'loading'} onRetry={deliveries.retry} now={now} more={deliveries.hasMore ? <LoadMore what="more deliveries" isLoading={deliveries.isLoadingMore} isFailed={deliveries.isLoadMoreFailed} onLoad={deliveries.loadMore} area="message-deliveries" /> : null} />}
    />
  );
}
