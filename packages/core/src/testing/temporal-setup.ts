// Some Node 26 builds ship without Temporal (Homebrew's, for one), which the
// cron code reads as a global; the official builds CI runs have it.
if (!('Temporal' in globalThis)) {
  await import('temporal-polyfill/global');
}
