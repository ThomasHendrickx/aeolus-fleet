/** The console address that redeems a sign-in ticket: the console's own hand-off page. */
export function signInLinkOf(consoleOrigin: string, ticket: string): string {
  const link = new URL('/sign-in/ticket', consoleOrigin);
  link.search = new URLSearchParams({ ticket }).toString();
  return link.toString();
}

/** What the terminal says with a link: how long it works and how to get another. */
export const SIGN_IN_LINK_NOTE = 'The link works once, for 15 minutes. For a new one, run npx aeolus-core sign-in.';
