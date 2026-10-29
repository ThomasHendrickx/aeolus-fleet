import type { ListedPayload } from '../../domain/messaging/public.js';

/**
 * A payload as a list's output carries it (decision 0068, B9): plain, or
 * empty and marked unreadable when its data key cannot be had.
 */
export function listedPayloadOutputOf(payload: ListedPayload): { payload: string; isPayloadUnreadable: boolean } {
  return typeof payload === 'string' ? { payload, isPayloadUnreadable: false } : { payload: '', isPayloadUnreadable: true };
}
