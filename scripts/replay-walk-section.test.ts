import { describe, expect, it } from 'vitest';

import { replayProblems } from './support/walk-replay.ts';

const WALK = (steps: string) => `## Summary\n\nx\n\n## Walk\n\nStart state: any.\n\n${steps}\n\n## Merge danger\n\nnone`;

describe('replaying a Walk section against the ship contract', () => {
  it('passes a Walk whose API steps are calls with arguments that fit, placeholders included', () => {
    const body = WALK('1. Call `fleet_setExpectations` with `{"shipId":"<target id>","taskDoneBy":null}`.\n   Shows: OK.');
    expect(replayProblems(body)).toEqual([]);
  });

  it('names a call the ship contract does not have', () => {
    expect(replayProblems(WALK('1. Call `fleet_noSuchCall` with `{"shipId":"<id>"}`.'))).toEqual([
      'Walk step 1: `fleet_noSuchCall` is not a call of the ship contract. Mark the step "staging only" if it is not one.',
    ]);
  });

  it('names a field the call does not take and a required field it lacks', () => {
    const problems = replayProblems(WALK('1. Call `fleet_setExpectations` with `{"ship":"<id>"}`.'));
    expect(problems).toEqual([
      'Walk step 1: `fleet_setExpectations` shipId is required',
      'Walk step 1: `fleet_setExpectations` ship is not a field of the call',
    ]);
  });

  it('leaves out a step marked staging only', () => {
    expect(replayProblems(WALK('1. Staging only: call `fleet_noSuchCall` with `{}`.'))).toEqual([]);
  });

  it('passes a body without a Walk', () => {
    expect(replayProblems('## Summary\n\nx')).toEqual([]);
  });
});

// CI sets PR_BODY to the pull request's body (the Guardrails job).
describe.skipIf(process.env.PR_BODY === undefined)('the pull request Walk', () => {
  it('replays against the ship contract', () => {
    expect(replayProblems(process.env.PR_BODY ?? '')).toEqual([]);
  });
});
