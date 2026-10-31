/**
 * How a reader shows an alert message (docs/design/monitoring, 4.8, 4.9,
 * N10): by its `headline` and its `body` as markdown, whatever its signal,
 * so a new signal changes no reader. A payload without both is no alert and
 * shows as a plain message. No zod: the console's browser reads it too.
 */

const ALERT_CONTENT_TYPE = 'application/vnd.aeolus.alert+json';

/** A content type's essence: media types compare without case and without their parameters (RFC 9110). */
function essenceOf(contentType: string): string {
  const [essence = ''] = contentType.split(';');
  return essence.trim().toLowerCase();
}

function jsonOf(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** The headline and the markdown body an alert message shows by; null for any other message. */
export function alertTextOf({ contentType, payload }: { contentType: string; payload: string }): { headline: string; body: string } | null {
  if (essenceOf(contentType) !== ALERT_CONTENT_TYPE) {
    return null;
  }
  const alert = jsonOf(payload);
  if (typeof alert !== 'object' || alert === null || !('headline' in alert) || !('body' in alert)) {
    return null;
  }
  const { headline, body } = alert;
  return typeof headline === 'string' && headline !== '' && typeof body === 'string' ? { headline, body } : null;
}
