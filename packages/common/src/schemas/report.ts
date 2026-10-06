import { z } from 'zod';

/** What a crew says it is doing: working, blocked or idle. Plain data: nothing acts on it. */
export const REPORT_STATES = ['working', 'blocked', 'idle'] as const;
export const reportStateSchema = z.enum(REPORT_STATES);
export type ReportState = z.infer<typeof reportStateSchema>;

/** The longest a report's note may be. */
export const REPORT_NOTE_MAX_LENGTH = 200;

const NOTE_MESSAGE = `A note is one line of at most ${String(REPORT_NOTE_MAX_LENGTH)} characters`;

/** Whether a note fits on one line. */
export function isOneLine(text: string): boolean {
  return !/[\r\n]/.test(text);
}

/**
 * The most a report's details may hold: 16 KB as the UTF-8 bytes of their
 * serialized JSON (decision 0028). Status, not storage: content goes
 * elsewhere, by reference.
 */
export const REPORT_DETAILS_MAX_BYTES = 16 * 1024;

const utf8 = new TextEncoder();

/** The size of a report's details: the UTF-8 bytes of their serialized JSON. */
export function reportDetailsBytes(details: ReportDetails): number {
  return utf8.encode(JSON.stringify(details)).byteLength;
}

/** A report's details: one JSON object, whose meaning lives outside the server (decision 0028). */
export const reportDetailsSchema = z.record(z.string(), z.json());

export type ReportDetails = z.infer<typeof reportDetailsSchema>;

/**
 * Input of `report`: the crew's state and a short note on what it is doing,
 * trimmed, and optionally its details. `details` sets them whole, null clears
 * them; `detailsPatch` applies a JSON Merge Patch (RFC 7386) to them; never
 * both. Left out, the details stay as they are. Calling it is a check-in.
 */
export const reportInputSchema = z
  .object({
    state: reportStateSchema,
    note: z.string().trim().max(REPORT_NOTE_MAX_LENGTH, NOTE_MESSAGE).refine(isOneLine, NOTE_MESSAGE).optional(),
    details: reportDetailsSchema.nullable().optional(),
    detailsPatch: reportDetailsSchema.nullable().optional(),
  })
  .refine((input) => input.details === undefined || input.detailsPatch === undefined, {
    message: 'Give details or detailsPatch, not both',
    path: ['detailsPatch'],
  });

export type ReportInput = z.infer<typeof reportInputSchema>;

/** Output of `report`: nothing; the OK is the answer. */
export const reportOutputSchema = z.strictObject({});

/**
 * A crew's report as the fleet list shows it (ISO 8601 in UTC): its state,
 * its note, when it last reported, and the version of its details, which
 * moves each time they change (0 before any).
 */
export const listedReportSchema = z.object({
  state: reportStateSchema,
  note: z.string().nullable(),
  reportedAt: z.iso.datetime(),
  detailsVersion: z.int().min(0),
});

/** A crew's report whole: as the fleet list shows it, with its details; null when it has none. */
export const reportSchema = listedReportSchema.extend({ details: reportDetailsSchema.nullable() });

export type ShipReportOutput = z.infer<typeof reportSchema>;

/**
 * Output of `reportLog`: the crew's own report, and the last report of the
 * ship's previous crew, read-only (the crew log of the previous crew). Each
 * null when there is none.
 */
export const reportLogOutputSchema = z.object({
  report: reportSchema.nullable(),
  previousCrew: reportSchema.nullable(),
});

export type ReportLogOutput = z.infer<typeof reportLogOutputSchema>;
