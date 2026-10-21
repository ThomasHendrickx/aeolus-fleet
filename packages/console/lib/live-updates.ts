'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * The live updates' WebSocket, reopened after an account's token is renewed
 * (accounts design, A4): the socket carries the token cookie it was opened
 * with, so a fresh token needs a fresh socket. Closing it makes the tRPC
 * client open a new one at once and send the last event's number, so the
 * server replays whatever committed meanwhile. While it reopens, the live
 * status stays Live: nothing is missed.
 */
export interface LiveUpdates {
  reopen: () => void;
  isReopening: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createLiveUpdates(socket: { close: () => void }): LiveUpdates & { opened: () => void } {
  let isReopening = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    reopen: () => {
      isReopening = true;
      notify();
      socket.close();
    },
    opened: () => {
      if (isReopening) {
        isReopening = false;
        notify();
      }
    },
    isReopening: () => isReopening,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const LiveUpdatesContext = createContext<LiveUpdates | undefined>(undefined);

const NEVER_REOPENING: LiveUpdates = { reopen: () => undefined, isReopening: () => false, subscribe: () => () => undefined };

export function useLiveUpdates(): LiveUpdates {
  return useContext(LiveUpdatesContext) ?? NEVER_REOPENING;
}

/** Whether the live updates are reopening after a renewal. */
export function useIsReopening(): boolean {
  const live = useLiveUpdates();
  return useSyncExternalStore(live.subscribe, live.isReopening, () => false);
}
