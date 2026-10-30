import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { reportStepText, reportTaskLabel } from './report-task';

const VIEWER_FLEET: FleetId = 'flt_01m66p4k2v9qz8f7x3n57acm';
const OTHER_FLEET: FleetId = 'flt_01m5aa4k2v9qz8f7x3n59q2d';
const MESSAGE_ID = 'msg_01m66p4k2v9qz8f7x3n5k2q9';

describe('reportTaskLabel: the task per kind, as the overview and the ship page show it', () => {
  it('shows a GitHub pull request as PR and its number, linked in a new tab', () => {
    const url = 'https://github.com/acme/ops/pull/1391';

    expect(reportTaskLabel({ kind: 'url', url }, VIEWER_FLEET)).toEqual({ icon: 'pullRequest', label: 'PR #1391', title: url, href: url });
  });

  it('shows a GitHub issue as its number, linked in a new tab', () => {
    const url = 'https://github.com/acme/ops/issues/1407';

    expect(reportTaskLabel({ kind: 'url', url }, VIEWER_FLEET)).toEqual({ icon: 'issue', label: '#1407', title: url, href: url });
  });

  it('shows any other URL as its host and path, linked in a new tab', () => {
    const url = 'https://linear.app/acme/issue/OPS-12?view=board#top';

    expect(reportTaskLabel({ kind: 'url', url }, VIEWER_FLEET)).toEqual({ icon: 'link', label: 'linear.app/acme/issue/OPS-12', title: url, href: url });
  });

  it('shows a message in the viewer\'s fleet as "a message", with its ids in the title', () => {
    expect(reportTaskLabel({ kind: 'message', fleetId: VIEWER_FLEET, messageId: MESSAGE_ID }, VIEWER_FLEET)).toEqual({
      icon: 'message',
      label: 'a message',
      title: `${VIEWER_FLEET} · ${MESSAGE_ID}`,
      href: null,
    });
  });

  it('shows a message in another fleet by its shortened fleet id, as text', () => {
    expect(reportTaskLabel({ kind: 'message', fleetId: OTHER_FLEET, messageId: MESSAGE_ID }, VIEWER_FLEET)).toEqual({
      icon: 'message',
      label: 'a message in flt_01m5aa…9q2d',
      title: `${OTHER_FLEET} · ${MESSAGE_ID}`,
      href: null,
    });
  });

  it('shows a kind it does not know as a task of unknown type, as text, its kind in the title', () => {
    expect(reportTaskLabel({ kind: 'deploy', environment: 'staging' }, VIEWER_FLEET)).toEqual({
      icon: 'unknown',
      label: 'a task of unknown type',
      title: 'kind: deploy',
      href: null,
    });
  });
});

describe('reportStepText', () => {
  it('says the step short in a row and in words on the ship page', () => {
    expect(reportStepText({ at: 3, of: 5 }, 'row')).toBe('3/5');
    expect(reportStepText({ at: 2, of: 3 }, 'full')).toBe('step 2 of 3');
  });
});
