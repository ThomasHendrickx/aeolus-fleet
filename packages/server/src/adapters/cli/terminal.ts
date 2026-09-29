import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';

import type { CommandIo } from './io.js';

/**
 * The operator's terminal for a server command. Answers are read a line at a
 * time from standard input, so they can also be piped in. A hidden answer is
 * not echoed on a terminal: readline's echo goes through an output that is
 * muted while it is typed.
 */
export function terminalIo(): CommandIo & { close(): void } {
  const isTerminal = process.stdin.isTTY;
  let isMuted = false;
  let reader: { lines: Interface; answers: AsyncIterator<string> } | undefined;

  const echo = new Writable({
    writev: (chunks: readonly { chunk: unknown }[], done) => {
      for (const { chunk } of chunks) {
        if (!isMuted && (typeof chunk === 'string' || chunk instanceof Uint8Array)) {
          process.stdout.write(chunk);
        }
      }
      done();
    },
  });

  // Opened on the first question only: a command that asks nothing leaves the terminal alone.
  function answers(): AsyncIterator<string> {
    if (!reader) {
      const lines = createInterface({ input: process.stdin, output: echo, terminal: isTerminal });
      reader = { lines, answers: lines[Symbol.asyncIterator]() };
    }
    return reader.answers;
  }

  return {
    out: (text) => {
      process.stdout.write(`${text}\n`);
    },
    err: (text) => {
      process.stderr.write(`${text}\n`);
    },
    ask: async (question, options) => {
      const next = answers();
      process.stdout.write(question);
      isMuted = options?.isHidden === true;
      const answer = await next.next();
      // Nothing echoed the end of a hidden or piped answer: end its line here.
      if (isMuted || !isTerminal) {
        process.stdout.write('\n');
      }
      isMuted = false;
      return answer.done === true ? undefined : answer.value;
    },
    close: () => {
      reader?.lines.close();
    },
  };
}
