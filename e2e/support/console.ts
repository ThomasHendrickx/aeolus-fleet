import type { Page, Request } from 'playwright';
import { onTestFailed } from 'vitest';

/**
 * Signs in to the console with an email and a password, once the button is
 * ready for it. Should the test then fail, its error goes on with what the
 * browser saw from the click on, so a sign-in that never reaches the console
 * says where it stopped, not only that a wait ran out (#654).
 */
export async function signIn(page: Page, login: { email: string; password: string }): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password').fill(login.password);
  const button = page.getByRole('button', { name: 'Sign in' });
  await button.and(page.locator(':enabled')).waitFor();
  const trail = signInTrail(page);
  onTestFailed(({ task }) => {
    // The failure's own error, before the reporter prints it: it carries the trail.
    const [error] = task.result?.errors ?? [];
    if (error) {
      error.message += `\n\nSign in, as the browser saw it from the click on:\n${trail.join('\n') || '(nothing)'}`;
    }
  });
  await button.click();
}

/** Whether a request is the sign-in call, or the web app's own navigation: a page or the payload of a client-side one. */
function isSignInStep(request: Request): boolean {
  const url = new URL(request.url());
  return url.pathname.endsWith('/console.signIn') || request.isNavigationRequest() || url.searchParams.has('_rsc');
}

/** Lists, each with the milliseconds since it started listing, the sign-in call and the navigations, their answers, and the page's errors. */
function signInTrail(page: Page): string[] {
  const startedAt = Date.now();
  const trail: string[] = [];
  const note = (line: string) => {
    trail.push(`+${String(Date.now() - startedAt)} ms ${line}`);
  };
  page.on('request', (request) => {
    if (isSignInStep(request)) {
      note(`sent ${request.method()} ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    if (isSignInStep(response.request())) {
      note(`answered ${String(response.status())} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (isSignInStep(request)) {
      note(`failed ${request.url()}: ${request.failure()?.errorText ?? 'no reason given'}`);
    }
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      note(`navigated to ${frame.url()}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      note(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    note(`page error: ${error.message}`);
  });
  return trail;
}

/** Opens a fleet row's actions menu; its items render in a portal, so find them on the page. */
export async function openRowMenu(page: Page, shipName: string): Promise<void> {
  await page.getByTestId(`fleet-row-${shipName}`).getByTestId('fleet-actions').click();
}

/** How long Sign out's answer is held on its way back to the console: a slow way out. */
const SLOW_SIGN_OUT_MS = 2_000;

/** Whether a request is a call the console sends: a tRPC call or a console read. */
function isConsoleCall(pathname: string): boolean {
  return pathname.startsWith('/trpc/') || pathname.startsWith('/api/reads/');
}

/**
 * Holds Sign out's answer on its way back to the console for a while, and
 * lists every call the console sends once it has sent Sign out, Sign out
 * aside. started settles as Sign out is sent, answered as the console hears
 * its answer.
 */
export function holdSignOutSlow(page: Page): { callsSent: string[]; started: Promise<undefined>; answered: Promise<undefined> } {
  const callsSent: string[] = [];
  const started = Promise.withResolvers<undefined>();
  const answered = Promise.withResolvers<undefined>();
  let hasStarted = false;
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/console.signOut')) {
      hasStarted = true;
      started.resolve(undefined);
    } else if (hasStarted && isConsoleCall(pathname)) {
      callsSent.push(pathname);
    }
  });
  void page.route(
    (url) => url.pathname.endsWith('/console.signOut'),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SLOW_SIGN_OUT_MS));
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, SLOW_SIGN_OUT_MS));
      await route.fulfill({ response });
      answered.resolve(undefined);
    },
  );
  return { callsSent, started: started.promise, answered: answered.promise };
}
