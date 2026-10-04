/**
 * Where a hosted console's operator signs in: the hosting service's sign-in
 * page, from AEOLUS_HOSTED_SIGN_IN_URL, read by the web app's server. Set, the
 * console serves no password form of its own: /sign-in redirects there, and a
 * failed hand-off points back to it. Unset, or not an http(s) URL, the console
 * signs in with a password, as a self-hosted one does.
 */
export function hostedSignInUrlFrom(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  const configured = environment.AEOLUS_HOSTED_SIGN_IN_URL;
  if (configured === undefined || configured === '' || !URL.canParse(configured)) {
    return undefined;
  }
  const { protocol } = new URL(configured);
  return protocol === 'https:' || protocol === 'http:' ? configured : undefined;
}
