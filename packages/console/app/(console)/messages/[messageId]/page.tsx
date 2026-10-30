import { idSchema } from '@aeolus-fleet/common';
import { notFound } from 'next/navigation';

import { MessageTask } from '../../../../features/ship/state/message-task';

/** A task reference opens the message sheet in the viewer's current fleet. */
export default async function MessageTaskPage({ params }: { params: Promise<{ messageId: string }> }) {
  const messageId = idSchema('message').safeParse((await params).messageId);
  if (!messageId.success) {
    notFound();
  }
  return <MessageTask messageId={messageId.data} />;
}
