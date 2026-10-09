import { THEMES } from '@aeolus-fleet/common';

import type { ConsoleConstants } from './console-constants';

/** The values from common the browser shows, read on the web app's server for the root layout to hand down. */
export function consoleConstantsOf(): ConsoleConstants {
  return { themes: THEMES };
}
