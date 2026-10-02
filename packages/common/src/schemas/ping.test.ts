import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  isPingContentType,
  PING_CONTENT_TYPE,
  pingShipInputSchema,
  pingShipOutputSchema,
  pongInputSchema,
  pongOutputSchema,
} from './ping.js';

const newId = createIdGenerator();

describe('PING_CONTENT_TYPE', () => {
  it('is the reserved media type of a ping', () => {
    expect(PING_CONTENT_TYPE).toBe('application/vnd.aeolus.ping');
  });
});

describe('isPingContentType', () => {
  it.each([
    ['the reserved type', 'application/vnd.aeolus.ping'],
    ['in any case', 'Application/VND.Aeolus.Ping'],
    ['with parameters', 'application/vnd.aeolus.ping; charset=utf-8'],
    ['with spaces before its parameters', 'application/vnd.aeolus.ping ;charset=utf-8'],
  ])('knows a ping: %s', (_, contentType) => {
    expect(isPingContentType(contentType)).toBe(true);
  });

  it.each([
    ['plain text', 'text/plain'],
    ['a longer subtype', 'application/vnd.aeolus.ping+json'],
    ['another aeolus type', 'application/vnd.aeolus.review+json'],
  ])('knows what is not a ping: %s', (_, contentType) => {
    expect(isPingContentType(contentType)).toBe(false);
  });
});

describe('pingShipInputSchema', () => {
  it('takes the ship to ping', () => {
    const input = { shipId: newId('ship') };

    expect(pingShipInputSchema.parse(input)).toEqual(input);
  });

  it('refuses an id of another kind', () => {
    expect(pingShipInputSchema.safeParse({ shipId: newId('message') }).success).toBe(false);
  });
});

describe('pingShipOutputSchema', () => {
  const output = { messageId: newId('message'), sentAt: '2026-10-02T09:00:00.000Z', isNew: true };

  it('answers the open ping, when it was sent and whether this call sent it', () => {
    expect(pingShipOutputSchema.parse(output)).toEqual(output);
  });

  it('refuses a send date that is not ISO 8601', () => {
    expect(pingShipOutputSchema.safeParse({ ...output, sentAt: 'now' }).success).toBe(false);
  });
});

describe('pongInputSchema', () => {
  it('takes the ping delivery to answer', () => {
    const input = { deliveryId: newId('delivery') };

    expect(pongInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a message id in place of the delivery id', () => {
    expect(pongInputSchema.safeParse({ deliveryId: newId('message') }).success).toBe(false);
  });
});

describe('pongOutputSchema', () => {
  it('answers nothing: the OK is the answer', () => {
    expect(pongOutputSchema.parse({})).toEqual({});
  });
});
