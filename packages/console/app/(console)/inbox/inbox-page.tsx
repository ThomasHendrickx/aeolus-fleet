'use client';

import type { DeliveryId } from '@aeolus-fleet/common';

import { InboxContainer } from '../../../features/inbox/state/inbox-container';

/** argo's one inbox, with its questions on top (#849): the page's client part. */
export function InboxPageFor({ filterParameter, selectedId }: { filterParameter?: string; selectedId?: DeliveryId }) {
  return <InboxContainer {...(filterParameter === undefined ? {} : { filterParameter })} {...(selectedId === undefined ? {} : { selectedId })} />;
}
