import type { Baseline } from './baseline.ts';
import { measureRead } from './measure-read.ts';
import type { Read } from './read.ts';
import { reportOf, type ReadReport } from './report-of.ts';
import { requestOf } from './request-of.ts';
import type { Target } from './target.ts';

interface Request {
  url: string;
  headers: Record<string, string>;
}
interface Answer {
  isOk: boolean;
  body: unknown;
}

const SHIP = '<ship id>';
const MESSAGE = '<message id>';

/** The id of the first item of a paged answer in tRPC's JSON wire, if it has one. */
function firstIdOf(body: unknown): string | undefined {
  const items = (body as { result?: { data?: { items?: { id?: unknown }[] } } } | null)?.result?.data?.items;
  const id = items?.[0]?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Measures every read one at a time, `warmup` calls uncounted then `samples` timed, and answers the report of the run: each read against the
 * budget and beside its baseline. A read of a ship or a message is called on the first ship the target lists and the first message of
 * that ship; where the target has none, the report says the read was not measured. It reports and never refuses.
 */
export async function runReads(run: {
  reads: readonly Read[];
  target: Target;
  baseline: Baseline;
  samples: number;
  warmup: number;
  clock: () => number;
  fetcher: (request: Request) => Promise<Answer>;
}): Promise<string> {
  const { target, fetcher } = run;
  const found: Record<string, string> = {};
  const needs = (read: Read, placeholder: string): boolean => JSON.stringify(read.input ?? null).includes(placeholder);
  if (run.reads.some((read) => needs(read, SHIP) || needs(read, MESSAGE))) {
    const ship = firstIdOf((await fetcher(requestOf({ name: 'fleet.list', procedure: 'fleet.list', input: { limit: 1 }, credential: 'fleet' }, target)).catch(() => undefined))?.body);
    if (ship !== undefined) {
      found[SHIP] = ship;
      const message = firstIdOf(
        (await fetcher(requestOf({ name: 'fleet.shipMessages', procedure: 'fleet.shipMessages', input: { shipId: SHIP, limit: 1 }, credential: 'fleet' }, target, found)).catch(() => undefined))?.body,
      );
      if (message !== undefined) {
        found[MESSAGE] = message;
      }
    }
  }
  const rows: ReadReport[] = [];
  for (const read of run.reads) {
    if (needs(read, SHIP) && found[SHIP] === undefined) {
      rows.push({ name: read.name, measured: { notMeasured: 'the fleet has no ship to read' } });
      continue;
    }
    if (needs(read, MESSAGE) && found[MESSAGE] === undefined) {
      rows.push({ name: read.name, measured: { notMeasured: 'the ship has no message to read' } });
      continue;
    }
    const request = requestOf(read, target, found);
    const measured = await measureRead({ samples: run.samples, warmup: run.warmup, clock: run.clock, call: () => fetcher(request) });
    rows.push({ name: read.name, measured });
  }
  return reportOf(rows, run.baseline);
}
