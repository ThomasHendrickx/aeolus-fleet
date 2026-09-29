import { createInterface, type Interface } from 'node:readline';
import { Writable, type Readable } from 'node:stream';

import type { CommandIo } from './io.js';

/** Where a server command reads and writes: standard input, output and error. */
export interface TerminalStreams {
  input: Readable & { isTTY?: boolean };
  output: Writable;
  errors: Writable;
}

/**
 * The operator's terminal for a server command. Answers are read a line at a
 * time from standard input, so they can also be piped in. A hidden answer is
 * not echoed on a terminal: readline's echo goes through an output that is
 * muted while it is typed. Each question is readline's prompt, so a line
 * redrawn after a correction keeps it.
 */
export function terminalIo(streams: TerminalStreams): CommandIo & { close(): void } {
  const { input, output, errors } = streams;
  const isTerminal = input.isTTY === true;
  let isMuted = false;
  let isClosed = false;
  let reader: { lines: Interface; answers: AsyncIterator<string> } | undefined;

  const echo = new Writable({
    writev: (chunks: readonly { chunk: unknown }[], done) => {
      for (const { chunk } of chunks) {
        if (!isMuted && (typeof chunk === 'string' || chunk instanceof Uint8Array)) {
          output.write(chunk);
        }
      }
      done();
    },
  });

  // Opened on the first question only: a command that asks nothing leaves the terminal alone.
  function open(): { lines: Interface; answers: AsyncIterator<string> } {
    if (!reader) {
      const lines = createInterface({ input, output: echo, terminal: isTerminal, historySize: 0 });
      lines.on('close', () => {
        isClosed = true;
      });
      reader = { lines, answers: lines[Symbol.asyncIterator]() };
    }
    return reader;
  }

  return {
    out: (text) => {
      output.write(`${text}\n`);
    },
    err: (text) => {
      errors.write(`${text}\n`);
    },
    ask: async (question, options) => {
      const { lines, answers } = open();
      // Once piped input has ended, readline is closed but may still hold answers it read.
      if (isClosed) {
        output.write(question);
      } else {
        lines.setPrompt(question);
        lines.prompt();
      }
      isMuted = options?.isHidden === true;
      const answer = await answers.next();
      // Nothing echoed the end of a hidden or piped answer: end its line here.
      if (isMuted || !isTerminal) {
        output.write('\n');
      }
      isMuted = false;
      return answer.done === true ? undefined : answer.value;
    },
    close: () => {
      reader?.lines.close();
    },
  };
}
