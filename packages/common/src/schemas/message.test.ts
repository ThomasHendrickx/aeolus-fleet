import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  contentTypeSchema,
  PAYLOAD_MAX_BYTES,
  payloadBytes,
  selectorSchema,
  sendInputSchema,
  sendOutputSchema,
} from './message.js';

const newId = createIdGenerator();

describe('payloadBytes', () => {
  it.each([
    { label: 'an ASCII character', payload: 'a', bytes: 1 },
    { label: 'a two-byte character', payload: 'é', bytes: 2 },
    { label: 'a three-byte character', payload: '€', bytes: 3 },
    { label: 'a four-byte character', payload: '😀', bytes: 4 },
    { label: 'nothing', payload: '', bytes: 0 },
  ])('counts $label in UTF-8 bytes', ({ payload, bytes }) => {
    expect(payloadBytes(payload)).toBe(bytes);
  });
});

describe('PAYLOAD_MAX_BYTES', () => {
  it('is 64 KB', () => {
    expect(PAYLOAD_MAX_BYTES).toBe(64 * 1024);
  });
});

describe('contentTypeSchema', () => {
  it('knows JSON and plain text, nothing else', () => {
    expect(contentTypeSchema.options).toEqual(['application/json', 'text/plain']);
  });

  it.each(['text/html', 'application/json; charset=utf-8', 'APPLICATION/JSON', ''])('rejects %j', (contentType) => {
    expect(contentTypeSchema.safeParse(contentType).success).toBe(false);
  });
});

describe('selectorSchema', () => {
  it.each([
    ['a ship by id', { kind: 'ship', shipId: newId('ship') }],
    ['a ship by name', { kind: 'ship', name: 'scout' }],
    ['argo by name', { kind: 'ship', name: 'argo' }],
    ['a type', { kind: 'type', type: 'reviewer' }],
  ])('accepts %s', (_label, selector) => {
    expect(selectorSchema.parse(selector)).toEqual(selector);
  });

  it.each([
    ['a ship with both id and name', { kind: 'ship', shipId: newId('ship'), name: 'scout' }],
    ['a ship with neither id nor name', { kind: 'ship' }],
    ['a ship id of another kind', { kind: 'ship', shipId: newId('fleet') }],
    ['a name that is not a handle', { kind: 'ship', name: 'Sea Scout' }],
    ['a type that is not a handle', { kind: 'type', type: 'Reviewer' }],
    ['a type with a name', { kind: 'type', type: 'reviewer', name: 'scout' }],
    ['a group, which comes later', { kind: 'group', group: 'reviewers' }],
  ])('rejects %s', (_label, selector) => {
    expect(selectorSchema.safeParse(selector).success).toBe(false);
  });
});

describe('sendInputSchema', () => {
  const input = {
    selector: { kind: 'ship', name: 'scout' },
    payload: '{"review":"https://github.com/ThomasHendrickx/aeolus-fleet/pull/22"}',
    contentType: 'application/json',
    idempotencyKey: 'review-22',
  };

  it('accepts a selector, a payload, its content type and an idempotency key', () => {
    expect(sendInputSchema.parse(input)).toEqual(input);
  });

  it('accepts the message it replies to', () => {
    const inReplyTo = newId('message');

    expect(sendInputSchema.parse({ ...input, inReplyTo })).toEqual({ ...input, inReplyTo });
  });

  it('takes the payload exactly as sent: JSON that does not parse, and whitespace, stay', () => {
    const payload = '  {not json ';

    expect(sendInputSchema.parse({ ...input, payload }).payload).toBe(payload);
  });

  it.each([
    ['64 KB of one-byte characters', 'a'.repeat(PAYLOAD_MAX_BYTES)],
    ['64 KB of two-byte characters', 'é'.repeat(PAYLOAD_MAX_BYTES / 2)],
  ])('accepts a payload of exactly %s', (_label, payload) => {
    expect(sendInputSchema.safeParse({ ...input, payload }).success).toBe(true);
  });

  it.each([
    ['one-byte characters', 'a'.repeat(PAYLOAD_MAX_BYTES + 1)],
    ['two-byte characters and one more byte', `${'é'.repeat(PAYLOAD_MAX_BYTES / 2)}a`],
  ])('rejects a payload one byte over 64 KB: %s', (_label, payload) => {
    expect(sendInputSchema.safeParse({ ...input, payload }).success).toBe(false);
  });

  it('accepts an idempotency key of 256 characters', () => {
    expect(sendInputSchema.safeParse({ ...input, idempotencyKey: 'k'.repeat(256) }).success).toBe(true);
  });

  it.each([
    ['an empty idempotency key', { ...input, idempotencyKey: '' }],
    ['an idempotency key over 256 characters', { ...input, idempotencyKey: 'k'.repeat(257) }],
    ['no idempotency key', { selector: input.selector, payload: input.payload, contentType: input.contentType }],
    ['a payload that is not text', { ...input, payload: { review: 22 } }],
    ['no content type', { selector: input.selector, payload: input.payload, idempotencyKey: input.idempotencyKey }],
    ['an unknown content type', { ...input, contentType: 'text/html' }],
    ['an unknown selector', { ...input, selector: { kind: 'fleet' } }],
    ['a reply to an id of another kind', { ...input, inReplyTo: newId('delivery') }],
  ])('rejects %s', (_label, candidate) => {
    expect(sendInputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('sendOutputSchema', () => {
  it('accepts the message id', () => {
    const messageId = newId('message');

    expect(sendOutputSchema.parse({ messageId })).toEqual({ messageId });
  });

  it('rejects an id of another kind', () => {
    expect(sendOutputSchema.safeParse({ messageId: newId('delivery') }).success).toBe(false);
  });
});
