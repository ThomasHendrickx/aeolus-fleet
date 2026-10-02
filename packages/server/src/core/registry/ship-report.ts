import { isOneLine, REPORT_NOTE_MAX_LENGTH, REPORT_STATES, type ReportState } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewOfLease } from './ports.js';

/**
 * A crew's latest word on its work (docs/blueprint.md, "Report"): working,
 * blocked or idle, with a short note, and when it last reported. It belongs to
 * the lease, so the ship's next crew starts with none. Plain data: Aeolus acts
 * on none of it.
 */
export interface ShipReport {
  state: ReportState;
  note: string | null;
  reportedAt: Date;
}

export type ReportRefusal = DomainError<'INVALID_REPORT_STATE' | 'INVALID_REPORT_NOTE'>;

function isReportState(value: string): value is ReportState {
  return REPORT_STATES.some((state) => state === value);
}

/** A note as it is kept: trimmed, none when empty, one line of at most 200 characters. */
function reportNote(raw: string | undefined): Result<string | null, ReportRefusal> {
  const note = raw?.trim() ?? '';
  if (note.length > REPORT_NOTE_MAX_LENGTH || !isOneLine(note)) {
    return refuse('INVALID_REPORT_NOTE', `A note is one line of at most ${String(REPORT_NOTE_MAX_LENGTH)} characters`);
  }
  return ok(note === '' ? null : note);
}

/**
 * The crew reports: its report now, and ShipReported caused by the ship when
 * the state or the note changed. Reporting the same again is a check-in: only
 * when it was reported moves, with no event.
 */
export function reportWork(
  current: ShipReport | null,
  input: { crew: CrewOfLease; state: string; note?: string; at: Date },
): Result<{ report: ShipReport; events: NewEvent[] }, ReportRefusal> {
  const { crew, at } = input;
  if (!isReportState(input.state)) {
    return refuse('INVALID_REPORT_STATE', 'A report state is working, blocked or idle');
  }
  const note = reportNote(input.note);
  if (!note.isOk) {
    return note;
  }
  const report: ShipReport = { state: input.state, note: note.value, reportedAt: at };
  if (current?.state === report.state && current.note === report.note) {
    return ok({ report, events: [] });
  }
  return ok({
    report,
    events: [
      {
        fleetId: crew.fleetId,
        type: 'ShipReported',
        occurredAt: at,
        actor: shipActor(crew.shipId),
        shipId: crew.shipId,
        details: { leaseId: crew.leaseId, state: report.state, note: report.note },
      },
    ],
  });
}
