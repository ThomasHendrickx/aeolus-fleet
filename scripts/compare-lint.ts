import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { z } from 'zod';

import { lintPasses } from './lint.ts';

const lintResults = z.array(z.object({
  filePath: z.string(),
  messages: z.array(z.object({
    ruleId: z.string().nullable(), severity: z.number(), message: z.string(),
    line: z.number().optional(), column: z.number().optional(),
    endLine: z.number().optional(), endColumn: z.number().optional(),
  })),
}));
type LintResults = z.infer<typeof lintResults>;

const directory = mkdtempSync(join(tmpdir(), 'compare-lint-'));

function run(targets: string[], name: string): LintResults {
  const output = join(directory, `${name}.json`);
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=12288', 'node_modules/eslint/bin/eslint.js',
    '--format', 'json', '--output-file', output, ...targets,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`ESLint failed: ${result.status}`);
  return lintResults.parse(JSON.parse(readFileSync(output, 'utf8')));
}

function normalise(results: LintResults) {
  return results.map((file) => ({
    path: relative(process.cwd(), file.filePath),
    messages: file.messages.map((message) => ({
      rule: message.ruleId, severity: message.severity, message: message.message,
      line: message.line, column: message.column, endLine: message.endLine, endColumn: message.endColumn,
    })),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

try {
  const before = normalise(run(['.'], 'before'));
  const after = normalise(lintPasses().flatMap((pass, index) => run(pass, `pass-${index}`)));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Lint paths or diagnostics differ');
  console.log(`Identical paths and diagnostics: ${before.length} files, ${before.reduce((count, file) => count + file.messages.length, 0)} diagnostics`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
