import type { TrierarchWorkspace } from '@aeolus-fleet/common';
import type { z } from 'zod';

/** A value an option may hold: anything JSON. */
export type OptionValue = z.infer<ReturnType<typeof z.json>>;

/**
 * Crew settings as a template or a blueprint role gives them (#343;
 * docs/squadrons.md, "Crew settings"): the fields of common's crew settings,
 * each optional, with machine labels as the `key=value` names a file writes,
 * so a file works in any fleet. A member's settings merge them, nearest wins.
 */
export interface CrewDraft {
  harness?: string;
  workspace?: TrierarchWorkspace;
  firstPrompt?: string;
  options?: Record<string, OptionValue>;
  machineLabels?: { key: string; value: string }[];
}

/** One version of a ship template, as its tag holds it (docs/squadrons.md, "Ship template"). */
export interface TemplateVersion {
  repository: string;
  name: string;
  version: number;
  /** Its path within its repository at its commit. */
  file: string;
  commit: string;
  committedAt: Date;
  description: string;
  /** How often a member reports; late after one interval, silent after three. */
  checkInMinutes: number;
  /** The exact model id a member of this role runs, shown with the launch note; null when it pins none. */
  model: string | null;
  launchNote: string | null;
  charter: string;
  /** The hand-offs its charter refers to, with what each carries. */
  handoffs: { name: string; carries: string }[];
  /** The crew settings its members get unless their role sets its own. */
  crew: CrewDraft;
  /** What its `{{name}}` placeholders stand for: a blueprint role or the form fills them. */
  parameters: { name: string; description: string }[];
}

/** Where a role's template comes from: a repository, a template's name and its version. */
export interface TemplateReference {
  repository: string;
  name: string;
  version: number;
}

/** One version of a squadron blueprint (docs/squadrons.md, "Squadron blueprint"). */
export interface BlueprintVersion {
  repository: string;
  name: string;
  version: number;
  /** Its path within its repository at its commit. */
  file: string;
  commit: string;
  committedAt: Date;
  description: string;
  /**
   * Its roles: each a template version and how many ships run it, and what
   * the role sets over its template: a model (null when it pins none), crew
   * settings, and the template's parameters it fills, by name.
   */
  roles: { name: string; template: TemplateReference; count: number; model: string | null; crew: CrewDraft; parameters: Record<string, string> }[];
  /** Where each role's hand-off goes: another role, or the flagship. */
  handoffs: { role: string; handoff: string; to: string }[];
  memberNames: 'plain' | 'prefixed';
}

/** A version left out of the catalogue, or a version tag at which nothing was read, and why. */
export interface CatalogueProblem {
  repository: string;
  kind: 'template' | 'blueprint' | 'tag';
  name: string;
  version: number;
  message: string;
}

export interface Catalogue {
  templates: TemplateVersion[];
  blueprints: BlueprintVersion[];
  problems: CatalogueProblem[];
}

/**
 * The longest charter, in UTF-8 bytes: the role message carries it, and 48 KB
 * leaves 16 KB of the 64 KB payload limit for the rest of it.
 */
export const CHARTER_MAX_BYTES = 48 * 1024;

/** Where a hand-off goes when it goes to no role. */
export const FLAGSHIP = 'flagship';
