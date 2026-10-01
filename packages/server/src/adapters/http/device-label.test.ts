import { describe, expect, it } from 'vitest';

import { deviceLabelOf } from './device-label.js';

describe('deviceLabelOf', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Mac · Chrome',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
      'iPhone · Safari',
    ],
    ['Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/604.1', 'iPad · Safari'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Windows · Edge',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Linux · Firefox'],
    [
      'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Android · Chrome',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
      'Mac · Safari',
    ],
  ])('names %s as %s', (userAgent, label) => {
    expect(deviceLabelOf(userAgent)).toBe(label);
  });

  it('names the system alone when the browser is unknown', () => {
    expect(deviceLabelOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SomeBrowser/1.0')).toBe('Mac');
  });

  it('calls a missing or unknown agent an unknown device', () => {
    expect(deviceLabelOf(undefined)).toBe('Unknown device');
    expect(deviceLabelOf('curl/8.7.1')).toBe('Unknown device');
  });
});
