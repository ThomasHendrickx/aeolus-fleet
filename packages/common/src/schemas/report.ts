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

/** Input of `report`: the crew's state and a short note on what it is doing, trimmed. Calling it is a check-in. */
export const reportInputSchema = z.object({
  state: reportStateSchema,
  note: z.string().trim().max(REPORT_NOTE_MAX_LENGTH, NOTE_MESSAGE).refine(isOneLine, NOTE_MESSAGE).optional(),
});

export type ReportInput = z.infer<typeof reportInputSchema>;

/** Output of `report`: nothing; the OK is the answer. */
export const reportOutputSchema = z.strictObject({});
