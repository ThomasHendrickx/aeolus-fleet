/**
 * The shape of a message to argo, as the ship protocol states it: the first
 * line is its headline, which the operator inbox shows as the row, then a
 * blank line and the body. Senders build it here so every headline fits.
 */

/** The longest headline a message to argo opens with: one row in the operator inbox. */
export const ARGO_HEADLINE_MAX_LENGTH = 80;

/** The content type of a message whose body holds lists or links. */
export const MARKDOWN_CONTENT_TYPE = 'text/markdown';

const ELLIPSIS = '…';

export function argoMessage(message: { readonly headline: string; readonly body: string }): string {
  return `${headlineOf(message.headline)}\n\n${message.body}`;
}

/** The headline on one line, cut to fit with an ellipsis when longer. */
function headlineOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= ARGO_HEADLINE_MAX_LENGTH ? line : `${line.slice(0, ARGO_HEADLINE_MAX_LENGTH - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}
