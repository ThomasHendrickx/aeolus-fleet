/** One version of a ship template, as its tag holds it (docs/squadrons.md, "Ship template"). */
export interface TemplateVersion {
  repository: string;
  name: string;
  version: number;
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
  commit: string;
  committedAt: Date;
  description: string;
  roles: { name: string; template: TemplateReference; count: number }[];
  /** Where each role's hand-off goes: another role, or the flagship. */
  handoffs: { role: string; handoff: string; to: string }[];
  memberNames: 'plain' | 'prefixed';
}

/** A version left out of the catalogue, and why. */
export interface CatalogueProblem {
  repository: string;
  kind: 'template' | 'blueprint';
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
