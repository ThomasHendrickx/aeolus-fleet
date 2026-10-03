import { parse, YAMLParseError } from 'yaml';
import { z } from 'zod';

import type { GitRepository } from './adapters/git/git-catalogue-source.js';
import { ConfigError } from './config.js';

const DEFAULT_REFRESH_MINUTES = 5;
const MINUTES_PER_HOUR = 60;

const fileSchema = z
  .object({
    repositories: z
      .array(
        z.object({
          url: z.string().min(1),
          name: z.string().min(1).optional(),
          path: z.string().min(1).optional(),
          token: z.string().min(1).optional(),
        }),
      )
      .default([]),
    refresh: z
      .string()
      .regex(/^[1-9]\d*[mh]$/, 'must be a duration such as 5m or 1h')
      .transform((raw) => Number(raw.slice(0, -1)) * (raw.endsWith('h') ? MINUTES_PER_HOUR : 1))
      .optional(),
  })
  .nullable()
  .transform((file) => file ?? { repositories: [], refresh: undefined });

/** A repository's name when it gives none: its URL without the scheme and `.git`. */
function nameOf(url: string): string {
  return url.replace(/^[a-z+]+:\/\//, '').replace(/\.git$/, '');
}

/**
 * The repositories squadrons reads templates and blueprints from, and how
 * often it fetches them (docs/squadrons.md, "Configuration"). A token names
 * the environment variable holding it, never the token itself.
 */
export function readSquadronsFile(
  text: string,
  environment: Record<string, string | undefined>,
): { repositories: GitRepository[]; refreshMinutes: number } {
  let raw: unknown;
  try {
    raw = parse(text) ?? null;
  } catch (error) {
    if (error instanceof YAMLParseError) {
      throw new ConfigError(`squadrons.yaml is no valid YAML: ${error.message}`);
    }
    throw error;
  }
  const file = fileSchema.safeParse(raw);
  if (!file.success) {
    throw new ConfigError(
      file.error.issues.map((issue) => `squadrons.yaml ${issue.path.join('.')}: ${issue.message}`).join('\n'),
    );
  }
  const repositories = file.data.repositories.map(({ url, name, path, token }) => {
    const value = token === undefined ? undefined : environment[token];
    if (token !== undefined && value === undefined) {
      throw new ConfigError(`squadrons.yaml names ${token} as the token of ${url}, but the environment does not hold it`);
    }
    return { url, name: name ?? nameOf(url), path, token: value };
  });
  return { repositories, refreshMinutes: file.data.refresh ?? DEFAULT_REFRESH_MINUTES };
}
