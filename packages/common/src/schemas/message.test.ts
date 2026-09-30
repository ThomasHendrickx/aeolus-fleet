import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  CONTENT_TYPE_DEFAULT,
  CONTENT_TYPE_MAX_LENGTH,
  contentTypeSchema,
  isMediaType,
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

describe('isMediaType', () => {
  it.each([
    'text/plain',
    'application/json',
    'text/html',
    'application/vnd.aeolus.review+json',
    'APPLICATION/JSON',
    'text/markdown; charset=utf-8',
    'text/plain;charset=UTF-8',
    'text/plain; charset="utf-8"; format=flowed',
    'multipart/form-data; boundary="a \\"quoted\\" boundary"',
    'text/plain;',
  ])('takes %j: type/subtype with optional parameters (RFC 9110)', (contentType) => {
    expect(isMediaType(contentType)).toBe(true);
  });

  it.each([
    '',
    'text',
    'text/',
    '/plain',
    'text/plain/extra',
    'text/pl ain',
    ' text/plain',
    'text/plain ',
    'text/plain; charset',
    'text/plain; =utf-8',
    'text/plain; charset="unterminated',
    'tëxt/plain',
  ])('refuses %j', (contentType) => {
    expect(isMediaType(contentType)).toBe(false);
  });
});

describe('the content type', () => {
  it('is text/plain unless the sender says otherwise', () => {
    expect(CONTENT_TYPE_DEFAULT).toBe('text/plain');
  });
});

describe('contentTypeSchema', () => {
  it('keeps the content type exactly as sent: case and parameters stay', () => {
    expect(contentTypeSchema.parse('Text/Markdown;  charset="UTF-8"')).toBe('Text/Markdown;  charset="UTF-8"');
  });

  it(`accepts ${CONTENT_TYPE_MAX_LENGTH} characters and refuses one more`, () => {
    const atTheLimit = `application/${'x'.repeat(CONTENT_TYPE_MAX_LENGTH - 'application/'.length)}`;

    expect(contentTypeSchema.safeParse(atTheLimit).success).toBe(true);
    expect(contentTypeSchema.safeParse(`${atTheLimit}x`).success).toBe(false);
  });

  it('refuses what is not a media type', () => {
    expect(contentTypeSchema.safeParse('plain text').success).toBe(false);
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

  it('accepts any media type as the content type, as sent', () => {
    const contentType = 'application/vnd.aeolus.review+json; version=2';

    expect(sendInputSchema.parse({ ...input, contentType }).contentType).toBe(contentType);
  });

  it('accepts a send without a content type: the sender leaves it to the default', () => {
    const withoutContentType = { selector: input.selector, payload: input.payload, idempotencyKey: input.idempotencyKey };

    expect(sendInputSchema.parse(withoutContentType)).toEqual(withoutContentType);
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
    ['a content type that is not a media type', { ...input, contentType: 'json' }],
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
