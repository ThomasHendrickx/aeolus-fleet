import type { MessageId } from '@aeolus-fleet/common';

import type { Selector } from '../shared/selector.js';

/** What a send asks for, its key aside: what a repeat of the key must ask for too. */
export interface SendRequest {
  selector: Selector;
  payload: string;
  contentType: string;
  inReplyTo: MessageId | undefined;
}

/**
 * The request as one text, the same for the same request whatever order its
 * fields came in: the selector as sent (one ship by id and by name are two
 * requests), the payload, the content type and the message it replies to.
 * Its hash is kept with the message to tell a repeat from a reused key.
 */
export function sendRequestText(request: SendRequest): string {
  return JSON.stringify([selectorFields(request.selector), request.payload, request.contentType, request.inReplyTo ?? null]);
}

function selectorFields(selector: Selector): string[] {
  switch (selector.kind) {
    case 'ship':
      return 'shipId' in selector ? ['ship', 'id', selector.shipId] : ['ship', 'name', selector.name];
    case 'type':
      return ['type', selector.type];
  }
}
