import { describe, expect, it } from 'vitest';

import { type CiRun, releaseRefusal } from './release-gate.ts';

const MAIN = 'refs/heads/main';
const SHA = '2008806c3eb14be4b6c3fae7fefdfdb9c4969453';

function aCiRun(run: Partial<CiRun> = {}): CiRun {
  return { status: 'completed', conclusion: 'success', url: 'https://github.com/acme/aeolus/actions/runs/1', ...run };
}

describe('the release gate', () => {
  it('lets a commit on main whose CI run passed be released', () => {
    expect(releaseRefusal({ ref: MAIN, sha: SHA, runs: [aCiRun()] })).toBeUndefined();
  });

  it('refuses any ref but main, naming it', () => {
    expect(releaseRefusal({ ref: 'refs/heads/feature', sha: SHA, runs: [aCiRun()] })).toBe('A release runs only from main, not from refs/heads/feature');
  });

  it('refuses a tag, even of a commit whose CI run passed', () => {
    expect(releaseRefusal({ ref: 'refs/tags/v0.17.3', sha: SHA, runs: [aCiRun()] })).toBe('A release runs only from main, not from refs/tags/v0.17.3');
  });

  it('refuses a commit CI never ran on', () => {
    expect(releaseRefusal({ ref: MAIN, sha: SHA, runs: [] })).toBe(`CI has not run on ${SHA} on main, so it cannot be released`);
  });

  it('refuses a commit whose CI run failed, linking the run', () => {
    expect(releaseRefusal({ ref: MAIN, sha: SHA, runs: [aCiRun({ conclusion: 'failure' })] })).toBe(
      `CI on ${SHA} did not pass (failure): https://github.com/acme/aeolus/actions/runs/1`,
    );
  });

  it('refuses a commit whose CI run has not finished, linking the run', () => {
    expect(releaseRefusal({ ref: MAIN, sha: SHA, runs: [aCiRun({ status: 'in_progress', conclusion: '' })] })).toBe(
      `CI on ${SHA} has not finished yet: https://github.com/acme/aeolus/actions/runs/1`,
    );
  });

  it('judges by the newest CI run, so a failed rerun refuses an earlier pass', () => {
    const runs = [aCiRun({ conclusion: 'failure', url: 'https://github.com/acme/aeolus/actions/runs/2' }), aCiRun()];
    expect(releaseRefusal({ ref: MAIN, sha: SHA, runs })).toBe(`CI on ${SHA} did not pass (failure): https://github.com/acme/aeolus/actions/runs/2`);
  });
});
