import { describe, expect, it } from 'vitest';

import { destinationOf } from './console-frame';

describe('the navigation marks where the operator is', () => {
  it.each([
    { path: '/', destination: 'overview' },
    { path: '/ships/shp_01', destination: 'overview' },
    { path: '/labels', destination: 'overview' },
    { path: '/needs-crew', destination: 'needs-crew' },
    { path: '/squadrons', destination: 'squadrons' },
    { path: '/squadrons/sqd_01', destination: 'squadrons' },
    { path: '/squadrons/blueprints/review', destination: 'squadrons' },
    { path: '/trierarchs', destination: 'trierarchs' },
    { path: '/trierarchs/shp_02', destination: 'trierarchs' },
    { path: '/inbox', destination: 'inbox' },
    { path: '/needs-attention', destination: 'attention' },
    { path: '/network', destination: 'network' },
    { path: '/settings', destination: 'settings' },
  ])('$path is under $destination', ({ path, destination }) => {
    expect(destinationOf(path)).toBe(destination);
  });
});
