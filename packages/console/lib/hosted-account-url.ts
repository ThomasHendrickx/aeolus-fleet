/** The hosting service's account page, from AEOLUS_HOSTED_ACCOUNT_URL: an http(s) URL, or none. */
export function hostedAccountUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_HOSTED_ACCOUNT_URL;
  if (configured === undefined || configured === '' || !URL.canParse(configured)) {
    return undefined;
  }
  const { protocol } = new URL(configured);
  return protocol === 'https:' || protocol === 'http:' ? configured : undefined;
}
