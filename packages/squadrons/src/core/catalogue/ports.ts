/** A template or blueprint file in git: which one, at which version (its tag `<name>@<n>`), and what it holds. */
export interface SourceFile {
  /** The repository's name, as blueprints reference it: `github.com/<owner>/<repo>`. */
  repository: string;
  kind: 'template' | 'blueprint';
  name: string;
  version: number;
  /** The commit the tag points at. */
  commit: string;
  committedAt: Date;
  /** The YAML, parsed; whatever it holds is checked here. */
  content: unknown;
  /** Why the YAML could not be parsed, when it could not. */
  parseError?: string;
}

/**
 * Outbound port: every tagged template and blueprint version in the
 * configured repositories (docs/squadrons.md, "Files in git").
 */
export interface CatalogueSource {
  files(): Promise<SourceFile[]>;
}
