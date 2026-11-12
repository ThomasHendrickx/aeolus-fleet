import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

const SWEEPER = new URL('../../src/testing/container-sweeper.ts', import.meta.url).href;

/** A test run's process: it starts the sweeper for its run, then waits to be killed, as a run interrupted mid-test. */
export async function startRunProcess(run: string): Promise<ChildProcess> {
  const script = `import { startContainerSweeper } from ${JSON.stringify(SWEEPER)}; startContainerSweeper(process.argv[1]); console.log('sweeping'); setInterval(() => {}, 60_000);`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script, run], { stdio: ['ignore', 'pipe', 'inherit'] });
  for await (const line of createInterface({ input: child.stdout })) {
    if (line !== 'sweeping') {
      throw new Error(`The process of test run ${run} said ${line} instead of sweeping`);
    }
    break;
  }
  return child;
}
