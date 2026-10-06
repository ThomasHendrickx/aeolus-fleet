import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { terminalIo } from './terminal.js';

/** Standard input as a terminal or a pipe, and everything written to standard output. */
function streams(options: { isTerminal: boolean }) {
  const input = Object.assign(new PassThrough(), { isTTY: options.isTerminal });
  const output = new PassThrough();
  const errors = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => (written += chunk.toString()));
  return { input, output, errors, written: () => written };
}

describe('the terminal of a server command', () => {
  it('reads piped answers a line at a time, and nothing once the input ends', async () => {
    const terminal = streams({ isTerminal: false });
    const io = terminalIo(terminal);
    terminal.input.end('thomas@example.com\ncorrect horse\n');

    const answers = [await io.ask('Operator email: '), await io.ask('Operator password: ', { isHidden: true })];
    const afterTheEnd = await io.ask('Repeat the password: ', { isHidden: true });
    io.close();

    expect(answers).toEqual(['thomas@example.com', 'correct horse']);
    expect(afterTheEnd).toBeUndefined();
    expect(terminal.written()).toBe('Operator email: \nOperator password: \nRepeat the password: \n');
  });

  it('never shows a hidden answer typed on a terminal', async () => {
    const terminal = streams({ isTerminal: true });
    const io = terminalIo(terminal);

    const answer = io.ask('Operator password: ', { isHidden: true });
    terminal.input.write('hunter2\r');
    await expect(answer).resolves.toBe('hunter2');
    io.close();

    expect(terminal.written()).toContain('Operator password: ');
    expect(terminal.written()).not.toContain('hunter2');
  });

  it('keeps the question on the line when a typed answer is corrected on a terminal', async () => {
    const terminal = streams({ isTerminal: true });
    const io = terminalIo(terminal);

    const answer = io.ask('Operator email: ');
    terminal.input.write('thomaz');
    terminal.input.write('\x7f');
    terminal.input.write('s@example.com\r');
    await expect(answer).resolves.toBe('thomas@example.com');
    io.close();

    expect(terminal.written()).not.toContain('> ');
    expect(terminal.written()).toContain('Operator email: thoma');
  });
});
