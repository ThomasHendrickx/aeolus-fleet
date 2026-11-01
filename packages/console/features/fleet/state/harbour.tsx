'use client';

import { useHarbour } from '../hooks/harbour';
import { HarbourView } from '../ui/organisms/harbour-view';

/** Harbour on the fleet overview (docs/design/fleet-overview): every active ship the session reads whole, live. */
export function Harbour() {
  const { harbour, isFailed, retry } = useHarbour();
  const state = isFailed ? 'error' : harbour === undefined ? 'loading' : 'ready';
  return <HarbourView harbour={harbour} state={state} onRetry={retry} />;
}
