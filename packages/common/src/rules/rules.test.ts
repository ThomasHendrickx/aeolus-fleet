import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { shipHandleSchema } from '../schemas/fleet.js';
import { signInInputSchema } from '../schemas/console.js';
import {
  isLabelHandle,
  isShipHandle,
  LABEL_HANDLE_MAX_LENGTH,
  PAYLOAD_MAX_BYTES,
  payloadBytes,
  SHIP_HANDLE_MAX_LENGTH,
  signInEmailProblem,
  signInPasswordProblem,
} from './index.js';

describe('the rules entry', () => {
  it('imports no zod, so a browser that uses it carries none', () => {
    const folder = fileURLToPath(new URL('.', import.meta.url));
    const sources = readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((name) => readFileSync(`${folder}/${name}`, 'utf8').includes("from 'zod'"))).toEqual([]);
  });
});

describe('isShipHandle', () => {
  it.each(['reviewer', 'squadron:planner', 'a-1', 'a'.repeat(SHIP_HANDLE_MAX_LENGTH)])('takes %s', (text) => {
    expect(isShipHandle(text)).toBe(true);
  });

  it.each(['', 'Reviewer', 'with space', 'a'.repeat(SHIP_HANDLE_MAX_LENGTH + 1), 'under_score'])('refuses %j', (text) => {
    expect(isShipHandle(text)).toBe(false);
  });

  it('agrees with the ship handle schema', () => {
    for (const text of ['reviewer', '', 'Reviewer', 'a'.repeat(SHIP_HANDLE_MAX_LENGTH + 1), 'x:y-1']) {
      expect(isShipHandle(text)).toBe(shipHandleSchema.safeParse(text).success);
    }
  });
});

describe('isLabelHandle', () => {
  it.each(['os', 'linux', 'arm-64', 'a'.repeat(LABEL_HANDLE_MAX_LENGTH)])('takes %s', (text) => {
    expect(isLabelHandle(text)).toBe(true);
  });

  it.each(['', 'Linux', 'os:linux', 'a'.repeat(LABEL_HANDLE_MAX_LENGTH + 1)])('refuses %j', (text) => {
    expect(isLabelHandle(text)).toBe(false);
  });
});

describe('payloadBytes', () => {
  it('counts UTF-8 bytes, as the 64 KB limit does', () => {
    expect(payloadBytes('é')).toBe(2);
    expect(PAYLOAD_MAX_BYTES).toBe(64 * 1024);
  });
});

describe('the sign-in checks', () => {
  it('ask for an email and a password', () => {
    expect(signInEmailProblem('  ')).toBe('Enter your email');
    expect(signInPasswordProblem('')).toBe('Enter your password');
  });

  it('find nothing wrong with an email and a password', () => {
    expect(signInEmailProblem(' operator@example.com ')).toBeUndefined();
    expect(signInPasswordProblem(' secret ')).toBeUndefined();
  });

  it('agree with the sign-in schema, message for message', () => {
    for (const input of [{ email: '', password: 'x' }, { email: 'a@b', password: '' }, { email: 'x'.repeat(255), password: 'x' }, { email: 'a@b', password: 'x'.repeat(1025) }, { email: 'a@b', password: 'x' }]) {
      const parsed = signInInputSchema.safeParse(input);
      const problems = [signInEmailProblem(input.email), signInPasswordProblem(input.password)].filter((problem) => problem !== undefined);
      expect(problems.length === 0).toBe(parsed.success);
      for (const issue of parsed.error?.issues ?? []) {
        expect(problems).toContain(issue.message);
      }
    }
  });
});
