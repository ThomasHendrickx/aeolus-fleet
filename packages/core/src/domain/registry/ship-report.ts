import {
  isOneLine,
  REPORT_DETAILS_MAX_BYTES,
  REPORT_NOTE_MAX_LENGTH,
  REPORT_STATES,
  reportDetailsBytes,
  type ReportState,
  type ReportStep,
  type ReportTask,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { shipActor, type NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewOfLease } from './ports.js';
import { isSameJson, mergePatch, type JsonObject } from './report-details.js';
import { isSameStep, reportStep, type ReportStepRefusal } from './report-step.js';
import { isSameTask, reportTask, type ReportTaskRefusal } from './report-task.js';

/**
 * A crew's latest word on its work (docs/blueprint.md, "Report"): working,
 * blocked or idle, with a short note, its task and step, its details, when it
 * last reported and when the report last changed.
 * It belongs to the lease, so the ship's next crew starts with none. Plain
 * data: Aeolus acts on none of it.
 */
export interface ShipReport {
  state: ReportState;
  note: string | null;
  /** What the crew works on, as a typed reference (report-task.ts); null when it names none. */
  task: ReportTask | null;
  /** Where the crew is in its task; null when it gives none. */
  step: ReportStep | null;
  /** When the crew last called report: last seen's own fact, moving on every call. */
  reportedAt: Date;
  /** When the state, note, task or step last changed; details alone do not move it (decision 0028). */
  reportChangedAt: Date;
  /** One JSON object the server stores without meaning (decision 0028); null when there are none. */
  details: JsonObject | null;
  /** Moves by one each time the details change, clearing included; 0 before any. */
  detailsVersion: number;
}

/** A report as one ship's page reads it: with the size of its details, counted as their limit counts them; null without details. */
export type ShownReport = ShipReport & { detailsBytes: number | null };

export function shownReportOf(report: ShipReport): ShownReport {
  return { ...report, detailsBytes: report.details === null ? null : reportDetailsBytes(report.details) };
}

export type ReportRefusal =
  | DomainError<'INVALID_REPORT_STATE' | 'INVALID_REPORT_NOTE' | 'INVALID_REPORT_DETAILS' | 'REPORT_DETAILS_TOO_LARGE'>
  | ReportTaskRefusal
  | ReportStepRefusal;

/** What a report does to the task and the step: left out they stay, null clears them. */
export interface ProgressInput {
  task?: ReportTask | null;
  step?: ReportStep | null;
}

/** A held value after a report: kept when left out, cleared with null, otherwise checked. */
function heldAfter<T, E>(held: { current: T | null; given: T | null | undefined }, check: (value: T) => Result<T, E>): Result<T | null, E> {
  if (held.given === undefined) {
    return ok(held.current);
  }
  return held.given === null ? ok(null) : check(held.given);
}

/** What a report does to the details: sets them whole (null clears them), or applies a JSON Merge Patch to them. Left out, they stay. */
export interface DetailsInput {
  details?: JsonObject | null;
  detailsPatch?: JsonObject | null;
}

/** The details after a report: set whole, merge-patched or kept, and at most 16 KB (decision 0028). */
function detailsAfter(current: JsonObject | null, input: DetailsInput): Result<JsonObject | null, ReportRefusal> {
  if (input.details !== undefined && input.detailsPatch !== undefined) {
    return refuse('INVALID_REPORT_DETAILS', 'Give details or detailsPatch, not both');
  }
  const details = detailsOf(current, input);
  if (details === null) {
    return ok(null);
  }
  const bytes = reportDetailsBytes(details);
  if (bytes > REPORT_DETAILS_MAX_BYTES) {
    return refuse(
      'REPORT_DETAILS_TOO_LARGE',
      `details is ${String(bytes)} bytes, the limit is ${String(REPORT_DETAILS_MAX_BYTES)} (decision 0028)`,
    );
  }
  return ok(details);
}

function detailsOf(current: JsonObject | null, input: DetailsInput): JsonObject | null {
  if (input.detailsPatch !== undefined) {
    // A patch of null clears the details; an object patch merges into them, starting from none as from {}.
    return input.detailsPatch === null ? null : mergePatchObject(current, input.detailsPatch);
  }
  return input.details === undefined ? current : input.details;
}

function mergePatchObject(current: JsonObject | null, patch: JsonObject): JsonObject {
  const patched = mergePatch(current ?? {}, patch);
  // An object patch on an object always gives an object (RFC 7386).
  return typeof patched === 'object' && patched !== null && !Array.isArray(patched) ? patched : {};
}

function isSameDetails(first: JsonObject | null, second: JsonObject | null): boolean {
  return first === null || second === null ? first === second : isSameJson(first, second);
}

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
 * the state, the note, the task, the step or the details changed, with the
 * details' version, never the details, and whether the report itself changed.
 * Only a change of state, note, task or step moves when the report changed.
 * Reporting the same again is a check-in: only when it was reported moves,
 * with no event.
 */
export function reportWork(
  current: ShipReport | null,
  input: { crew: CrewOfLease; state: string; note?: string; at: Date } & DetailsInput & ProgressInput,
): Result<{ report: ShipReport; events: NewEvent[] }, ReportRefusal> {
  const { crew, at } = input;
  if (!isReportState(input.state)) {
    return refuse('INVALID_REPORT_STATE', 'A report state is working, blocked or idle');
  }
  const note = reportNote(input.note);
  if (!note.isOk) {
    return note;
  }
  const task = heldAfter({ current: current?.task ?? null, given: input.task }, reportTask);
  if (!task.isOk) {
    return task;
  }
  const step = heldAfter({ current: current?.step ?? null, given: input.step }, reportStep);
  if (!step.isOk) {
    return step;
  }
  const currentDetails = current?.details ?? null;
  const details = detailsAfter(currentDetails, input);
  if (!details.isOk) {
    return details;
  }
  const currentVersion = current?.detailsVersion ?? 0;
  const isDetailsChanged = !isSameDetails(currentDetails, details.value);
  const isReportChanged =
    current?.state !== input.state ||
    current.note !== note.value ||
    !isSameTask(current.task, task.value) ||
    !isSameStep(current.step, step.value);
  const report: ShipReport = {
    state: input.state,
    note: note.value,
    task: task.value,
    step: step.value,
    reportedAt: at,
    reportChangedAt: current === null || isReportChanged ? at : current.reportChangedAt,
    details: details.value,
    detailsVersion: isDetailsChanged ? currentVersion + 1 : currentVersion,
  };
  if (!isReportChanged && !isDetailsChanged) {
    return ok({ report: { ...report, details: currentDetails }, events: [] });
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
        details: {
          leaseId: crew.leaseId,
          state: report.state,
          note: report.note,
          detailsVersion: report.detailsVersion,
          // Event details are flat: the task as its JSON text, the step as its two numbers.
          task: report.task === null ? null : JSON.stringify(report.task),
          stepAt: report.step?.at ?? null,
          stepOf: report.step?.of ?? null,
          isReportChanged,
        },
      },
    ],
  });
}
