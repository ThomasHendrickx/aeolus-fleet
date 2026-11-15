import type { Theme } from '@aeolus-fleet/common/rules';

/**
 * The theme on <html> (docs/design/header-across-apps.md, T5): `data-theme`
 * names the choice and the `dark` class (docs/design/conventions.md, "Stack")
 * shows it, beside the tokens it switches.
 */

/**
 * The script each app's root layout puts in <head>, so the first paint shows
 * the browser's theme and never flashes another. System follows the
 * browser's setting and keeps in step when it changes, for as long as <html>
 * says system.
 */
export function themeScript(theme: Theme): string {
  return `(() => {
  const root = document.documentElement;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => root.classList.toggle('dark', root.dataset.theme === 'dark' || (root.dataset.theme === 'system' && query.matches));
  root.dataset.theme = ${JSON.stringify(theme)};
  apply();
  query.addEventListener('change', apply);
})();`;
}

/** Shows a theme picked in the avatar menu at once, as the script would on the next load. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
}
