import { describe, expect, it } from 'vitest';

import { alertTextOf } from './alert.js';

// How a reader shows an alert message (docs/design/monitoring, 4.8, 4.9,
// N10): by its headline and its body as markdown; an unknown signal the
// same way, so a new signal changes no reader; a payload that is no alert
// as a plain message.

const ALERT = 'application/vnd.aeolus.alert+json';
const payload = JSON.stringify({ alertId: 'alt_01m66p4k2v9qz8f7x3n5c1b0td', headline: 'deploy-bot: delivery unacknowledged 22 min', body: 'Awaiting crew since **14:31**.', signal: 'delivery-unacknowledged' });

describe('an alert message as a reader shows it', () => {
  it('is its headline and its body', () => {
    expect(alertTextOf({ contentType: ALERT, payload })).toEqual({ headline: 'deploy-bot: delivery unacknowledged 22 min', body: 'Awaiting crew since **14:31**.' });
  });

  it('compares its content type without case and parameters', () => {
    expect(alertTextOf({ contentType: 'Application/Vnd.Aeolus.Alert+JSON; charset=utf-8', payload })).not.toBeNull();
  });

  it('shows a signal it does not know by its headline and body', () => {
    const unknown = JSON.stringify({ headline: 'merger-1: disk full', body: 'Disk at 99 %.', signal: 'disk-full' });

    expect(alertTextOf({ contentType: ALERT, payload: unknown })).toEqual({ headline: 'merger-1: disk full', body: 'Disk at 99 %.' });
  });

  it('is no alert when its payload has no headline and body', () => {
    expect(alertTextOf({ contentType: ALERT, payload: 'deploy-bot is stuck' })).toBeNull();
    expect(alertTextOf({ contentType: ALERT, payload: JSON.stringify({ headline: '', body: 'x' }) })).toBeNull();
    expect(alertTextOf({ contentType: ALERT, payload: JSON.stringify({ headline: 'x' }) })).toBeNull();
  });

  it('is no alert in a message of another content type', () => {
    expect(alertTextOf({ contentType: 'application/json', payload })).toBeNull();
  });
});
