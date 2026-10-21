import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it, vi } from 'vitest';

import type { IssueSignInLink } from '../../domain/identity/issue-sign-in-link.js';
import type { Fleet } from '../../domain/registry/fleet.js';
import { refuse } from '../../domain/shared/errors.js';
import { ok } from '../../domain/shared/result.js';
import type { CommandIo } from './io.js';
import { signIn } from './sign-in.js';

const newId = createIdGenerator();

const CONSOLE_ORIGIN = 'http://localhost:3000';

const TICKET = 'aeolus_st_v1_fresh';

/** The terminal, which answers nothing: the command asks nothing. */
function recordingIo(): CommandIo & { stdout: string[]; stderr: string[]; questions: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const questions: string[] = [];
  return {
    stdout,
    stderr,
    questions,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    ask: (question) => {
      questions.push(question);
      return Promise.resolve(undefined);
    },
  };
}

function fleet(): Fleet {
  return { id: newId('fleet'), name: 'home fleet', createdAt: new Date() };
}

const linked: IssueSignInLink = () => Promise.resolve(ok({ ticket: TICKET, expiresAt: new Date('2026-10-21T12:15:00.000Z') }));

describe('sign-in', () => {
  it("prints a fresh one-use link that signs in to the installation's fleet as argo, asking nothing", async () => {
    const io = recordingIo();
    const only = fleet();
    const issueSignInLink = vi.fn(linked);

    await expect(signIn([], { listFleets: () => Promise.resolve([only]), issueSignInLink, consoleOrigin: CONSOLE_ORIGIN, io })).resolves.toBe(0);

    expect(issueSignInLink).toHaveBeenCalledWith({ fleetId: only.id });
    expect(io.questions).toEqual([]);
    expect(io.stdout).toEqual([
      `Open ${CONSOLE_ORIGIN}/sign-in/ticket?ticket=${TICKET} to sign in to the console as argo.\nThe link works once, for 15 minutes. For a new one, run npx aeolus-core sign-in.`,
    ]);
    expect(io.stderr).toEqual([]);
  });

  it('says to run fleet:init first when there is no fleet', async () => {
    const io = recordingIo();

    await expect(signIn([], { listFleets: () => Promise.resolve([]), issueSignInLink: linked, consoleOrigin: CONSOLE_ORIGIN, io })).resolves.toBe(1);

    expect(io.stderr).toEqual(['There is no fleet yet. Run fleet:init first.']);
  });

  it('refuses an installation of several fleets: argo of which is not said', async () => {
    const io = recordingIo();

    await expect(
      signIn([], { listFleets: () => Promise.resolve([fleet(), fleet()]), issueSignInLink: linked, consoleOrigin: CONSOLE_ORIGIN, io }),
    ).resolves.toBe(1);

    expect(io.stderr).toEqual(['This installation hosts 2 fleets; sign-in handles one.']);
  });

  it('reports a refusal from the domain and exits 1', async () => {
    const io = recordingIo();
    const refused: IssueSignInLink = () => Promise.resolve(refuse('FLEET_NOT_FOUND', 'The installation hosts no fleet'));

    await expect(signIn([], { listFleets: () => Promise.resolve([fleet()]), issueSignInLink: refused, consoleOrigin: CONSOLE_ORIGIN, io })).resolves.toBe(1);

    expect(io.stderr).toEqual(['The installation hosts no fleet']);
    expect(io.stdout).toEqual([]);
  });

  it('takes no arguments', async () => {
    const io = recordingIo();

    await expect(signIn(['--fleet', 'x'], { listFleets: () => Promise.resolve([fleet()]), issueSignInLink: linked, consoleOrigin: CONSOLE_ORIGIN, io })).resolves.toBe(2);

    expect(io.stderr.join('\n')).toContain('Usage: aeolus-core sign-in');
  });
});
