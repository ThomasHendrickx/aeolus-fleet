import { expect, it } from 'vitest';

import { reportActivityInputSchema } from './activity.js';

it('carries a refused tool call as the latest session activity (#2070)', () => {
  const input = { intervalSeconds: 30, activities: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a', at: '2026-11-24T08:00:00.000Z', kind: 'refused', tool: 'Bash' }] };

  const read = reportActivityInputSchema.safeParse(input);

  expect(read).toMatchObject({ success: true, data: input });
});
