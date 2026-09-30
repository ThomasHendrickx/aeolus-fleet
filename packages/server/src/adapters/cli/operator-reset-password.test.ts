import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it, vi } from 'vitest';

import type { ResetOperatorPassword } from '../../core/identity/reset-operator-password.js';
import type { Fleet } from '../../core/registry/fleet.js';
import { refuse } from '../../core/shared/errors.js';
import { ok } from '../../core/shared/result.js';
import type { CommandIo } from './io.js';
import { operatorResetPassword } from './operator-reset-password.js';

const newId = createIdGenerator();

/** An operator at the terminal who gives these answers, in order, then ends the input. */
function scriptedIo(answers: string[] = []): CommandIo & {
  stdout: string[];
  stderr: string[];
  questions: [string, boolean][];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const questions: [string, boolean][] = [];
  const remaining = [...answers];
  return {
    stdout,
    stderr,
    questions,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    ask: (question, options) => {
      questions.push([question, options?.isHidden ?? false]);
      return Promise.resolve(remaining.shift());
    },
  };
}

function fleet(): Fleet {
  return { id: newId('fleet'), name: 'home fleet', createdAt: new Date() };
}

const reset: ResetOperatorPassword = () => Promise.resolve(ok({ operatorId: newId('operator') }));

const answers = ['staple battery', 'staple battery'];

describe('operator:reset-password', () => {
  it('asks for the new password twice without showing it', async () => {
    const io = scriptedIo(answers);

    await operatorResetPassword([], { listFleets: () => Promise.resolve([fleet()]), resetOperatorPassword: reset, io });

    expect(io.questions).toEqual([
      ['New operator password: ', true],
      ['Repeat the password: ', true],
    ]);
  });

  it("resets the password of the installation's fleet and says every console session has ended", async () => {
    const io = scriptedIo(answers);
    const only = fleet();
    const resetOperatorPassword = vi.fn(reset);

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([only]), resetOperatorPassword, io }),
    ).resolves.toBe(0);

    expect(resetOperatorPassword).toHaveBeenCalledWith({ fleetId: only.id, password: 'staple battery' });
    expect(io.stdout).toEqual([
      `The operator password for fleet ${only.id} is reset. Every console session has ended: sign in with the new password.`,
    ]);
    expect(io.stderr).toEqual([]);
  });

  it('refuses two different passwords and changes nothing', async () => {
    const io = scriptedIo(['staple battery', 'staple batery']);
    const resetOperatorPassword = vi.fn(reset);

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([fleet()]), resetOperatorPassword, io }),
    ).resolves.toBe(1);

    expect(resetOperatorPassword).not.toHaveBeenCalled();
    expect(io.stderr).toEqual(['The two passwords differ. Nothing was changed.']);
  });

  it('stops when the input ends before both answers are given', async () => {
    const io = scriptedIo(['staple battery']);
    const resetOperatorPassword = vi.fn(reset);

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([fleet()]), resetOperatorPassword, io }),
    ).resolves.toBe(2);

    expect(resetOperatorPassword).not.toHaveBeenCalled();
    expect(io.stderr).toEqual(['operator:reset-password needs the new password twice. Nothing was changed.']);
  });

  it('refuses when there is no fleet yet, before asking anything', async () => {
    const io = scriptedIo(answers);

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([]), resetOperatorPassword: reset, io }),
    ).resolves.toBe(1);

    expect(io.stderr).toEqual(['There is no fleet yet. Run fleet:init first.']);
    expect(io.questions).toEqual([]);
  });

  it('refuses to choose between several fleets', async () => {
    const io = scriptedIo(answers);
    const resetOperatorPassword = vi.fn(reset);

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([fleet(), fleet()]), resetOperatorPassword, io }),
    ).resolves.toBe(1);

    expect(resetOperatorPassword).not.toHaveBeenCalled();
    expect(io.questions).toEqual([]);
  });

  it('reports a refusal from the domain and exits 1', async () => {
    const io = scriptedIo(['', '']);
    const refused: ResetOperatorPassword = () =>
      Promise.resolve(refuse('INVALID_PASSWORD', 'A password is 1 to 1024 characters'));

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([fleet()]), resetOperatorPassword: refused, io }),
    ).resolves.toBe(1);

    expect(io.stderr).toEqual(['A password is 1 to 1024 characters']);
    expect(io.stdout).toEqual([]);
  });

  it('takes no arguments', async () => {
    const io = scriptedIo(answers);

    await expect(
      operatorResetPassword(['--fleet', 'x'], {
        listFleets: () => Promise.resolve([fleet()]),
        resetOperatorPassword: reset,
        io,
      }),
    ).resolves.toBe(2);
  });

  it('refuses a new password holding U+0000, as the API does, and changes nothing', async () => {
    const io = scriptedIo(['staple\u0000battery', 'staple\u0000battery']);
    const resetOperatorPassword = vi.fn(reset);

    await expect(
      operatorResetPassword([], { listFleets: () => Promise.resolve([fleet()]), resetOperatorPassword, io }),
    ).resolves.toBe(1);

    expect(resetOperatorPassword).not.toHaveBeenCalled();
    expect(io.stderr).toEqual(['The operator password cannot hold the character U+0000 (NUL). Nothing was changed.']);
  });
});
