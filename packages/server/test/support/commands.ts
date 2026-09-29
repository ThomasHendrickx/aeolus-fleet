import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));

export interface CommandRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a server command exactly as the operator does: through npm, from the
 * repository root. Its questions are answered from `answers`, one line each,
 * on standard input, which then ends.
 */
export async function runServerCommand(command: {
  script: string;
  args?: string[];
  answers?: string[];
  env: Record<string, string>;
}): Promise<CommandRun> {
  const { script, args = [], answers = [], env } = command;
  const child = spawn('npm', ['run', '--silent', script, '-w', '@aeolus-fleet/server', '--', ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdin.end(answers.map((answer) => `${answer}\n`).join(''));

  const [code] = await once(child, 'close');
  return { code: typeof code === 'number' ? code : -1, stdout, stderr };
}
