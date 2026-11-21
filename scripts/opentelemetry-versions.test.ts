import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('OpenTelemetry dependencies', () => {
  it('installs one API and one trace SDK at the 0.300 exporter line', () => {
    const lock = z.object({ packages: z.record(z.string(), z.object({ version: z.string().optional() })) }).parse(
      JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')),
    );
    const versions = (name: string) => Object.entries<{ version?: string }>(lock.packages)
      .filter(([path]) => path.endsWith(`/node_modules/@opentelemetry/${name}`) || path === `node_modules/@opentelemetry/${name}`)
      .map(([, pkg]) => pkg.version);

    expect(new Set(versions('api'))).toEqual(new Set(['1.10.0']));
    expect(new Set(versions('sdk-trace'))).toEqual(new Set(['3.0.0']));
    expect(new Set(versions('sdk-metrics'))).toEqual(new Set(['3.0.0']));
    expect(versions('sdk-trace-base')).toEqual([]);
  });
});
