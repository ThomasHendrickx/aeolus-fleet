/** Where an account goes when it holds no scope in the fleet, or in any (accounts design, F1). */
export const NO_RIGHTS_PATH = '/sign-in/no-rights';

/** Where an account goes when pagasae does not answer. */
export const UNREACHABLE_PATH = '/sign-in/unreachable';

/** Where an account goes once signed out of argo: into the fleet again as itself, with no sign-in step (accounts design, A7). */
export const AFTER_ARGO_SIGN_OUT_PATH = '/sign-in/enter?returnTo=%2F';

/** Where an account holding no fleet:read goes (accounts design, A8). */
export const NOTHING_TO_MANAGE_PATH = '/sign-in/nothing-to-manage';

/**
 * Where an account goes when its sign-in ended (accounts design, A6): the
 * sign-in page says "Your sign-in ended." and signs in again back to the page
 * it was on.
 */
export function signInEndedPathOf(returnTo: string): string {
  return `/sign-in?${new URLSearchParams({ notice: 'ended', returnTo }).toString()}`;
}
