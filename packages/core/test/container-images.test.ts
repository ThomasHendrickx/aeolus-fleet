import { describe, expect, it } from 'vitest';

import { POSTGRES_IMAGE, REAPER_IMAGE } from './container-images.js';

/** The registry an image name pulls from: its first part when that names a host, else Docker Hub. */
function registryOf(image: string): string {
  const [first = '', ...rest] = image.split('/');
  const isHost = rest.length > 0 && (first.includes('.') || first.includes(':') || first === 'localhost');
  return isHost ? first : 'docker.io';
}

// CI runners share IPs, so anonymous Docker Hub pulls hit its rate limit at random (#437).
describe('Testcontainers images', () => {
  it('pulls Postgres 16 from a mirror outside Docker Hub', () => {
    expect(registryOf(POSTGRES_IMAGE)).not.toBe('docker.io');
    expect(POSTGRES_IMAGE.endsWith('/postgres:16-alpine')).toBe(true);
  });

  it('pulls the Ryuk reaper from a mirror outside Docker Hub', () => {
    expect(registryOf(REAPER_IMAGE)).not.toBe('docker.io');
    expect(REAPER_IMAGE).toMatch(/\/testcontainers\/ryuk:\d+\.\d+\.\d+$/);
  });
});
