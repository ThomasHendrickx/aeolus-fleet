import {
  CREW_STATUSES,
  FIRST_PROMPT_MAX_BYTES,
  FLEET_SCOPES,
  LABEL_HANDLE_MAX_LENGTH,
  LABEL_VALUES_MAX,
  NO_MACHINE_MATCHES_REASON,
  REPORT_STATES,
  SHIP_HANDLE_MAX_LENGTH,
  SHIP_LABELS_MAX,
  THEMES,
} from '@aeolus-fleet/common';

import type { ConsoleConstants } from './console-constants';

/** The values from common the browser shows, read on the web app's server for the root layout to hand down. */
export function consoleConstantsOf(): ConsoleConstants {
  return {
    themes: THEMES,
    fleetScopes: FLEET_SCOPES,
    crewStatuses: CREW_STATUSES,
    reportStates: REPORT_STATES,
    noMachineMatchesReason: NO_MACHINE_MATCHES_REASON,
    shipHandleMaxLength: SHIP_HANDLE_MAX_LENGTH,
    shipLabelsMax: SHIP_LABELS_MAX,
    labelHandleMaxLength: LABEL_HANDLE_MAX_LENGTH,
    labelValuesMax: LABEL_VALUES_MAX,
    firstPromptMaxBytes: FIRST_PROMPT_MAX_BYTES,
  };
}
