import { describe, expect, it } from 'vitest';

import { READS, requestOf } from './read-request.ts';

const target = { url: 'https://staging.example/', fleetToken: 'crew-secret', installationToken: 'install-secret', fleetId: 'flt_01abc' };

describe('the request of a read', () => {
  it('is a GET of the tRPC procedure, its input as JSON in the query', () => {
    const request = requestOf({ name: 'fleet.list', procedure: 'fleet.list', input: { limit: 20 }, credential: 'fleet' }, target);
    expect(request.url).toBe(`https://staging.example/trpc/fleet.list?input=${encodeURIComponent('{"limit":20}')}`);
  });

  it('has no input in the query for a read without one', () => {
    expect(requestOf({ name: 'fleet.health', procedure: 'fleet.health', credential: 'fleet' }, target).url).toBe('https://staging.example/trpc/fleet.health');
  });

  it('presents the crew token as a bearer token for a fleet read', () => {
    expect(requestOf({ name: 'fleet.health', procedure: 'fleet.health', credential: 'fleet' }, target).headers).toEqual({ authorization: 'Bearer crew-secret' });
  });

  it('presents the installation token and the fleet it acts in for an installation read', () => {
    expect(requestOf({ name: 'installation.fleets.list', procedure: 'installation.fleets.list', credential: 'installation' }, target).headers).toEqual({
      'x-aeolus-installation-token': 'install-secret',
      'aeolus-fleet': 'flt_01abc',
    });
  });
});

describe('the reads of the performance design', () => {
  it('name each read once', () => {
    const names = READS.map((read) => read.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('include the reads its slices cut and page: health, the fleet list, the installation fleet and the lists', () => {
    expect(READS.map((read) => read.procedure)).toEqual(
      expect.arrayContaining(['fleet.health', 'fleet.stuckCount', 'fleet.stuckHistory', 'fleet.list', 'fleet.inbox', 'fleet.needsAttention', 'installation.fleets.get']),
    );
  });
});
