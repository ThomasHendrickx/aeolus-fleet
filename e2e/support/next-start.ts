import { createRequire } from 'node:module';

// Runs `next start` with the arguments it is given after the path of Next's
// command, and stops it once the process that started it is gone: standard
// input, a pipe from that process, then ends. A killed test run so leaves no
// next start behind, holding its port after the run ends (#514 was the same
// leftover, then holding the lock on packages/console/.next). Run as a script,
// not with --eval: Next hands the Node options of its own process on to a
// server it forks, and a forked --eval would start without the script.

const [node = process.execPath, , nextBin, ...nextArgs] = process.argv;
if (nextBin === undefined) {
  throw new Error('usage: node next-start.ts <path of next> start [options]');
}

process.stdin.on('end', () => process.kill(process.pid, 'SIGTERM'));
process.stdin.resume();

process.argv = [node, nextBin, ...nextArgs];
createRequire(import.meta.url)(nextBin);
