import { describe, expect, it } from 'vitest';

import { analyticsEventSchema, routePatternOf } from './analytics';

describe('the analytics events', () => {
  it.each([
    { name: 'pageview', route: '/ships/[shipId]' },
    { name: 'tour_started' },
    { name: 'tour_step_reached', step: 2, total: 6 },
    { name: 'tour_skipped', step: 3 },
    { name: 'tour_finished' },
    { name: 'ship_commissioned' },
    { name: 'squadron_formed', roleCount: 3 },
  ])('takes $name with its properties', (event) => {
    expect(analyticsEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    { name: 'page_left' },
    { name: 'ship_commissioned', shipName: 'scout' },
    { name: 'squadron_formed', roleCount: 3, blueprint: 'hemma-feature' },
    { name: 'pageview', route: '/ships/shp_01m3tbfspe96yf1rnr4ank9h1a?tab=history' },
    { name: 'pageview', route: 'https://console.example.com/' },
    { name: 'tour_step_reached', step: 0, total: 6 },
  ])('drops anything else: %o', (event) => {
    expect(analyticsEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('routePatternOf', () => {
  it("turns each dynamic parameter's value back into its name", () => {
    expect(routePatternOf('/ships/shp_01m3tbfspe96yf1rnr4ank9h1a', { shipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a' })).toBe('/ships/[shipId]');
    expect(routePatternOf('/squadrons/templates/tester%20one', { name: 'tester one' })).toBe('/squadrons/templates/[name]');
  });

  it('keeps a static route as it is', () => {
    expect(routePatternOf('/squadrons', {})).toBe('/squadrons');
    expect(routePatternOf('/', {})).toBe('/');
  });
});
