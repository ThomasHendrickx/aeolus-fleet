import type { Page } from 'playwright';

/** Signs in to the console with an email and a password, once the button is ready for it. */
export async function signIn(page: Page, login: { email: string; password: string }): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(login.email);
  await page.getByLabel('Password').fill(login.password);
  const button = page.getByRole('button', { name: 'Sign in' });
  await button.and(page.locator(':enabled')).waitFor();
  await button.click();
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
