'use client';

import { useHarbourShips } from '../hooks/harbour-ships';
import { harbourOf } from '../services/harbour';
import { HarbourView } from '../ui/organisms/harbour-view';

/** Harbour on the fleet overview (docs/design/fleet-overview): every active ship the session reads whole, live. */
export function Harbour() {
  const { ships, isFailed, retry } = useHarbourShips();
  const state = isFailed ? 'error' : ships === undefined ? 'loading' : 'ready';
  return <HarbourView harbour={ships && harbourOf(ships)} state={state} onRetry={retry} />;
}
