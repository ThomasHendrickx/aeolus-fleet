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
