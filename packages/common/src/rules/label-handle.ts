/** The most characters a label's key or one of its values may have (decision 0031). */
export const LABEL_HANDLE_MAX_LENGTH = 63;

/** A label's key or value: lowercase letters, digits and hyphens, at least one. */
export const LABEL_HANDLE_PATTERN = /^[a-z0-9-]+$/;

/** Whether a text is a label's key or value as decision 0031 allows it. */
export function isLabelHandle(text: string): boolean {
  return text.length <= LABEL_HANDLE_MAX_LENGTH && LABEL_HANDLE_PATTERN.test(text);
}
