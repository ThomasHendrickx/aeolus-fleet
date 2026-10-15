import { plainHttpWarning } from '@aeolus-fleet/common/rules';

import { serverUrlFrom } from './server-url';

/**
 * What the web app warns of when it starts, one line each: a plain http
 * AEOLUS_SERVER_URL beyond localhost, where the browser calls the server and
 * drops its Secure session cookie. The address the browser opens the console
 * at is unknown here; the sign-in page tells of that one.
 */
export function startupWarnings(environment: Readonly<Record<string, string | undefined>>): string[] {
  const warning = plainHttpWarning('AEOLUS_SERVER_URL', serverUrlFrom(environment));
  return warning === undefined ? [] : [warning];
}
