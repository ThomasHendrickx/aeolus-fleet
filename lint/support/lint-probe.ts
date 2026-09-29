import { fileURLToPath } from 'node:url';

import { ESLint, type Linter } from 'eslint';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Lints source text as if it were a file at a path in the repository. */
export type Lint = (code: string, path: string) => Promise<Linter.LintMessage[]>;

/**
 * Lints with the repository's real ESLint config, so a test proves the rule
 * that runs in CI. The probe files do not exist on disk, so the only override
 * lets the TypeScript project service type them with the given tsconfig.
 * Fails the test when ESLint cannot parse the code.
 *
 * Create one per test file: typescript-eslint keeps a single project service
 * per process, set up by the first lint, so a second one's probes are unknown.
 */
export function createLint(options: { tsconfig: string; probes: readonly string[] }): Lint {
  const eslint = new ESLint({
    cwd: repositoryRoot,
    overrideConfig: {
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: [...options.probes],
            defaultProject: options.tsconfig,
            // Probes are small and made up; typing each one on its own is cheap here.
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: options.probes.length,
          },
        },
      },
    },
  });

  return async (code, path) => {
    const [result] = await eslint.lintText(code, { filePath: `${repositoryRoot}${path}` });
    const messages = result?.messages ?? [];
    const fatal = messages.find((message) => message.fatal === true);
    if (fatal) {
      throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
    }
    return messages;
  };
}

/** What one rule reported. */
export function reportsOf(messages: readonly Linter.LintMessage[], ruleId: string): string[] {
  return messages.filter((message) => message.ruleId === ruleId).map((message) => message.message);
}
