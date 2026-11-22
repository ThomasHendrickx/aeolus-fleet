import type { Locator, Page } from 'playwright';

/**
 * The part with the testid that is on screen. A page holds some parts twice,
 * one for desktop and one for phone, and shows one of them.
 */
export function visible(page: Page | Locator, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true });
}

/**
 * Whether the part is in a state the browser itself knows: focused, or focused
 * the way a keyboard focuses. One reading: wait with expect.poll.
 */
export async function isInState(part: Locator, state: ':focus' | ':focus-visible'): Promise<boolean> {
  // A function, not page source: the console's content security policy refuses the eval that reads source as a function.
  return part.evaluate((element: { matches(selector: string): boolean }, selector: string) => element.matches(selector), state);
}

/** The classes on the page's html element, such as the theme. One reading: wait with expect.poll. */
export async function pageClasses(page: Page): Promise<string[]> {
  const classes = await page.evaluate('document.documentElement.className');
  return typeof classes === 'string' ? classes.split(/\s+/).filter(Boolean) : [];
}

/**
 * Resolves once the browser has painted two frames: whatever the page started
 * in response to an earlier step, such as a request from an event handler, has
 * been sent by then and shows in the requests a test listens to.
 */
export async function afterFrames(page: Page): Promise<void> {
  await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
