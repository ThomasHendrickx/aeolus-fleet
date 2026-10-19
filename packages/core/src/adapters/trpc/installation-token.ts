import { timingSafeEqual } from 'node:crypto';

import type { InstallationCredential } from './context.js';

/** The header a hosting service presents the installation token in: apart from a crew token and a console session. */
export const INSTALLATION_TOKEN_HEADER = 'x-aeolus-installation-token';

/** Whether the presented token is the configured one, compared in constant time. */
export function isInstallationToken(credential: InstallationCredential & { configured: string }): boolean {
  const configured = Buffer.from(credential.configured);
  const presented = Buffer.from(credential.presented ?? '');
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}
