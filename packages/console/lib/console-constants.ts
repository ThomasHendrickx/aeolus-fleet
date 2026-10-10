'use client';

import type { CrewStatus, FleetScope, ReportState, Theme, WhileUnavailable } from '@aeolus-fleet/common';
import { createContext, useContext } from 'react';

/**
 * The values from @aeolus-fleet/common the browser shows: limits and the
 * closed sets it lists. The root layout reads them from common on the web
 * app's server and hands them down (decision 0033), so common stays out of
 * the browser and the console copies none of them.
 */
export interface ConsoleConstants {
  themes: readonly Theme[];
  fleetScopes: readonly FleetScope[];
  crewStatuses: readonly CrewStatus[];
  reportStates: readonly ReportState[];
  /** The reason the trierarch plugin writes when no machine carries a request's machine labels. */
  noMachineMatchesReason: string;
  shipHandleMaxLength: number;
  shipLabelsMax: number;
  labelHandleMaxLength: number;
  labelValuesMax: number;
  firstPromptMaxBytes: number;
  /** The most network rules a fleet holds (decision 0034). */
  networkRulesMax: number;
  /** What a networking plugin may declare for while it is unavailable, and the bounds of after how long it is not responding (decision 0035). */
  whileUnavailable: readonly WhileUnavailable[];
  notRespondingAfterMinSeconds: number;
  notRespondingAfterMaxSeconds: number;
}

export const ConsoleConstantsContext = createContext<ConsoleConstants | undefined>(undefined);

export function useConsoleConstants(): ConsoleConstants {
  const constants = useContext(ConsoleConstantsContext);
  if (constants === undefined) {
    throw new Error('useConsoleConstants runs inside the root layout, which provides them');
  }
  return constants;
}
