import { relativeTime } from './relative-time';

/** What a known harness is, for its icon (docs/design/png/LocationTag.png): a coding agent, a chat session, a bot, or argo's console. */
export type HarnessKind = 'coding' | 'chat' | 'bot' | 'console';

/** The harnesses the console names (docs/blueprint.md, "Harness"); any other shows as stated. */
const KNOWN_HARNESSES: Readonly<Record<string, { word: string; kind: HarnessKind }>> = {
  'claude-code': { word: 'Claude Code', kind: 'coding' },
  codex: { word: 'Codex', kind: 'coding' },
  'claude-chat': { word: 'Claude chat', kind: 'chat' },
  chatgpt: { word: 'ChatGPT', kind: 'chat' },
  grok: { word: 'Grok', kind: 'chat' },
  grokbot: { word: 'Grokbot', kind: 'bot' },
  console: { word: 'Console', kind: 'console' },
};

/** A harness as the console words it: Claude Code, Codex, ChatGPT and the other known ones, or the free text the session stated. */
export function harnessWord(harness: string): string {
  return KNOWN_HARNESSES[harness]?.word ?? harness;
}

/** A known harness's kind, for its icon; none for free text, which shows as plain text. */
export function harnessKind(harness: string): HarnessKind | undefined {
  return KNOWN_HARNESSES[harness]?.kind;
}

/**
 * What a trierarch detected of a harness (#365), for its machine's card:
 * "2.1.293 · models confirmed 3 h ago", or "no model confirmed". Nothing for
 * a harness reported without a version, as a trierarch before 0.20.2 does.
 */
export function harnessDetection(harness: { version?: string; modelsConfirmedAt?: string | null }, now: Date): string | undefined {
  if (harness.version === undefined) {
    return undefined;
  }
  if (harness.modelsConfirmedAt === undefined || harness.modelsConfirmedAt === null) {
    return `${harness.version} · no model confirmed`;
  }
  const relative = relativeTime(new Date(harness.modelsConfirmedAt), now);
  return `${harness.version} · models confirmed ${relative === 'Just now' ? 'just now' : relative}`;
}

/** A crew line's harness as its switch words it: Chat for the line a chat client pastes, which no session states as its harness. */
export function crewLineHarnessWord(harness: string): string {
  return harness === 'chat' ? 'Chat' : harnessWord(harness);
}
