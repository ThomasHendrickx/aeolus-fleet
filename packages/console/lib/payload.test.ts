import { describe, expect, it } from 'vitest';

import { formattedPayload, payloadLabel } from './payload';

describe('formattedPayload', () => {
  it('indents a JSON payload', () => {
    expect(formattedPayload('{"pr":48,"repo":"web"}', 'application/json')).toBe('{\n  "pr": 48,\n  "repo": "web"\n}');
  });

  it('takes a +json content type with parameters as JSON', () => {
    expect(formattedPayload('[1]', 'application/vnd.task+json; charset=utf-8')).toBe('[\n  1\n]');
  });

  it('has no formatted view for JSON that does not parse', () => {
    expect(formattedPayload('{"pr":', 'application/json')).toBeUndefined();
  });

  it('has no formatted view for text', () => {
    expect(formattedPayload('{"pr":48}', 'text/plain')).toBeUndefined();
  });
});

describe('payloadLabel', () => {
  it('says JSON and counts its bytes', () => {
    expect(payloadLabel('{"pr":48}', 'application/json')).toBe('JSON · 9 bytes');
  });

  it('names any other content type and counts UTF-8 bytes', () => {
    expect(payloadLabel('é', 'text/plain; charset=utf-8')).toBe('text/plain · 2 bytes');
  });

  it('counts one byte as one', () => {
    expect(payloadLabel('a', 'text/plain')).toBe('text/plain · 1 byte');
  });
});
