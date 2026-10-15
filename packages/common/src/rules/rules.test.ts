import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { shipHandleSchema } from '../schemas/fleet.js';
import { signInInputSchema } from '../schemas/console.js';
import {
  isLabelHandle,
  isShipHandle,
  LABEL_HANDLE_MAX_LENGTH,
  newOperatorPasswordProblem,
  OPERATOR_PASSWORD_MIN_LENGTH,
  PAYLOAD_MAX_BYTES,
  payloadBytes,
  plainHttpWarning,
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

describe('the new operator password check, for fleet:init and operator:reset-password', () => {
  it('is 12 characters at least', () => {
    expect(OPERATOR_PASSWORD_MIN_LENGTH).toBe(12);
  });

  it.each([
    ['exactly 12 characters', 'p'.repeat(12)],
    ['1024 characters', 'p'.repeat(1024)],
  ])('finds nothing wrong with %s', (_label, password) => {
    expect(newOperatorPasswordProblem(password)).toBeUndefined();
  });

  it.each([
    ['an empty password', ''],
    ['one character', 'x'],
    ['11 characters', 'p'.repeat(11)],
  ])('refuses %s as too short', (_label, password) => {
    expect(newOperatorPasswordProblem(password)).toBe('Use a password of at least 12 characters');
  });

  it('refuses 1025 characters as too long', () => {
    expect(newOperatorPasswordProblem('p'.repeat(1025))).toBe('Use a password of at most 1024 characters');
  });

  it('leaves sign-in alone: a shorter password set before still signs in', () => {
    expect(signInPasswordProblem('x')).toBeUndefined();
  });
});

describe('the plain http warning, for a setting a browser reaches', () => {
  it('warns of plain http on a host beyond localhost: the Secure cookie is dropped and secrets travel in clear text', () => {
    expect(plainHttpWarning('PUBLIC_URL', 'http://fleet.example.com:4000')).toBe(
      'PUBLIC_URL is plain http on fleet.example.com: browsers drop the Secure session cookie, so console sign-in fails, and passwords and crew tokens travel in clear text. Put a TLS proxy in front and use https (README, "Beyond localhost").',
    );
  });

  it.each([
    ['an address on the network', 'http://192.168.1.20:4000'],
    ['a machine name', 'http://fleet-box'],
  ])('warns of %s', (_label, url) => {
    expect(plainHttpWarning('PUBLIC_URL', url)).toContain('PUBLIC_URL is plain http on ');
  });

  it.each([
    ['https', 'https://fleet.example.com'],
    ['localhost', 'http://localhost:4000'],
    ['a name under localhost', 'http://fleet.localhost:4000'],
    ['127.0.0.1', 'http://127.0.0.1:4000'],
    ['another loopback address', 'http://127.0.0.2:4000'],
    ['IPv6 loopback', 'http://[::1]:4000'],
  ])('finds nothing to warn of with %s, which a browser treats as secure', (_label, url) => {
    expect(plainHttpWarning('PUBLIC_URL', url)).toBeUndefined();
  });
});
