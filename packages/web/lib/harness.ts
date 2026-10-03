/** The harnesses the console names (docs/blueprint.md, "Harness"); any other shows as stated. */
const HARNESS_WORDS: Readonly<Record<string, string>> = {
  'claude-code': 'Claude Code',
  'claude-chat': 'Claude chat',
  codex: 'Codex',
};

/** A harness as the console words it: Claude Code, Claude chat or Codex, or the free text the session stated. */
export function harnessWord(harness: string): string {
  return HARNESS_WORDS[harness] ?? harness;
}
