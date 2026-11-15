/**
 * The measured run of the holding scale design (decisions 1 and 3): every read of the performance design, called on a
 * staging seeded at the target (10,000,000 messages, 3,000 ships in one fleet) with its containers capped to production's
 * size, and reported against the budget beside S1's baseline. Started by hand when Thomas asks for it, never in CI or a walk.
 * It reports and never refuses: a read over budget is an issue of its own. It writes nothing; the numbers are its output.
 *
 * Usage: AEOLUS_URL=<staging core> AEOLUS_FLEET_TOKEN=<crew token of argo> AEOLUS_INSTALLATION_TOKEN=<token> \
 *          AEOLUS_FLEET_ID=<the seeded fleet> node scripts/measure-reads.ts [--samples 200] [--warmup 5] [--baseline <S1 baseline.json>]
 * The baseline is JSON by read name: {"fleet.health":{"p95Ms":2100,"p99Ms":3000,"errorRate":0}}.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { measureRead, reportOf, baselineOf, type ReadReport } from './support/read-measurement.ts';
import { READS, requestOf, type Target } from './support/read-request.ts';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Set ${name}; see the usage at the top of scripts/measure-reads.ts`);
  }
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { samples: { type: 'string', default: '200' }, warmup: { type: 'string', default: '5' }, baseline: { type: 'string' } } });
  const samples = Number(values.samples);
  const warmup = Number(values.warmup);
  if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(warmup) || warmup < 0) {
    throw new Error('--samples is a whole number of at least 1 and --warmup a whole number');
  }
  const baseline = values.baseline === undefined ? {} : baselineOf(readFileSync(values.baseline, 'utf8'));
  const target: Target = {
    url: required('AEOLUS_URL'),
    fleetToken: required('AEOLUS_FLEET_TOKEN'),
    installationToken: required('AEOLUS_INSTALLATION_TOKEN'),
    fleetId: required('AEOLUS_FLEET_ID'),
  };
  const rows: ReadReport[] = [];
  for (const read of READS) {
    const { url, headers } = requestOf(read, target);
    const measured = await measureRead(read, {
      samples,
      warmup,
      clock: () => performance.now(),
      call: async () => {
        const response = await fetch(url, { headers });
        await response.arrayBuffer();
        return { isOk: response.ok };
      },
    });
    rows.push({ name: read.name, measured });
    console.error(`${read.name}: p95 ${String(Math.round(measured.p95Ms))} ms`);
  }
  console.log(`Measured ${new Date().toISOString()}, ${String(samples)} calls per read after ${String(warmup)} warm-up calls, one at a time. The seeded scale and the container caps are the staging's, not checked here.\n`);
  console.log(reportOf(rows, baseline));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
