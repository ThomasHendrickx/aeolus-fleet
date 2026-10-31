/**
 * A reply core refused because the fleet's company key is not reachable
 * (decision 0068, B8): the reader says so by the reply field, which keeps the
 * draft. Every other failure stays a toast.
 */
export function replyRefusalOf(refusal: string | undefined): { title: string; description: string } | undefined {
  return refusal === 'KEY_UNAVAILABLE' ? { title: 'Couldn’t send your reply', description: 'Your company key is not reachable. Nothing was sent; your reply is kept.' } : undefined;
}
