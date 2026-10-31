import { idSchema, type ReportTask } from '@aeolus-fleet/common';

/** The fleet the stories' viewer signs in to. */
export const VIEWER_FLEET_ID = idSchema('fleet').parse('flt_01m66p4k2v9qz8f7x3n5c17acm');

/** One report task per kind the console labels (docs/design/monitoring, 4.2). */
export const REPORT_TASKS = {
  pullRequest: { kind: 'url', url: 'https://github.com/acme/ops/pull/1391' },
  issue: { kind: 'url', url: 'https://github.com/acme/ops/issues/1407' },
  otherUrl: { kind: 'url', url: 'https://linear.app/acme/issue/OPS-12' },
  message: { kind: 'message', fleetId: VIEWER_FLEET_ID, messageId: 'msg_01m66p4k2v9qz8f7x3n5c1k2q9' },
  messageInAnotherFleet: { kind: 'message', fleetId: 'flt_01m5aa4k2v9qz8f7x3n5c19q2d', messageId: 'msg_01m5aa4k2v9qz8f7x3n5c1w4hn' },
  unknown: { kind: 'deploy', environment: 'staging' },
} as const satisfies Record<string, ReportTask>;
