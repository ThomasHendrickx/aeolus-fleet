import { createRequire } from 'node:module';

// Runs `next dev` with the arguments it is given after the path of Next's
// command, and stops it once the process that started it is gone: standard
// input, a pipe from that process, then ends. A killed test run so leaves no
// next dev behind, holding the lock on packages/console/.next that would keep
// the next run's from starting (#514). Run as a script, not with --eval:
// next dev hands its own Node options on to the server it forks.

const [node = process.execPath, , nextBin, ...nextArgs] = process.argv;
if (nextBin === undefined) {
  throw new Error('usage: node next-dev.ts <path of next> dev [options]');
}

process.stdin.on('end', () => process.kill(process.pid, 'SIGTERM'));
process.stdin.resume();

process.argv = [node, nextBin, ...nextArgs];
createRequire(import.meta.url)(nextBin);
