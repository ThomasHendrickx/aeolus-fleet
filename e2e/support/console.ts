import type { Page } from 'playwright';

/** Signs in to the console by pasting the secret, once the button is ready for it. */
export async function signIn(page: Page, withSecret: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel("argo's secret").fill(withSecret);
  const button = page.getByRole('button', { name: 'Sign in' });
  await button.and(page.locator(':enabled')).waitFor();
  await button.click();
}
