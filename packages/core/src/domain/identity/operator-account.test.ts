import { describe, expect, it } from 'vitest';

import { normaliseEmail, operatorEmail, operatorPassword } from './operator-account.js';

describe('operatorEmail', () => {
  it('takes an address with something on each side of one @', () => {
    expect(operatorEmail('thomas@example.com')).toEqual({ isOk: true, value: 'thomas@example.com' });
  });

  it('drops the spaces around it and lowercases it, the form it is stored and found in', () => {
    expect(operatorEmail('  Thomas@Example.COM\n')).toEqual({ isOk: true, value: 'thomas@example.com' });
  });

  it('takes 254 characters', () => {
    const email = `${'a'.repeat(242)}@example.com`;

    expect(operatorEmail(email)).toEqual({ isOk: true, value: email });
  });

  it.each([
    ['an empty email', ''],
    ['only spaces', '   '],
    ['no @', 'thomas.example.com'],
    ['nothing before the @', '@example.com'],
    ['nothing after the @', 'thomas@'],
    ['two @', 'thomas@home@example.com'],
    ['a space inside', 'thomas hendrickx@example.com'],
    ['255 characters', `${'a'.repeat(243)}@example.com`],
  ])('refuses %s', (_label, raw) => {
    expect(operatorEmail(raw)).toEqual({
      isOk: false,
      error: { kind: 'INVALID_EMAIL', message: 'An operator email is an address like name@example.com, at most 254 characters' },
    });
  });
});

describe('normaliseEmail', () => {
  it('trims and lowercases, as the stored email is', () => {
    expect(normaliseEmail(' Thomas@Example.com ')).toBe('thomas@example.com');
  });
});

describe('operatorPassword', () => {
  it.each([
    ['one character', 'x'],
    ['spaces, kept as typed', '  correct horse battery staple  '],
    ['1024 characters', 'p'.repeat(1024)],
  ])('takes any password: %s', (_label, raw) => {
    expect(operatorPassword(raw)).toEqual({ isOk: true, value: raw });
  });

  it.each([
    ['an empty password', ''],
    ['1025 characters', 'p'.repeat(1025)],
  ])('refuses %s', (_label, raw) => {
    expect(operatorPassword(raw)).toEqual({
      isOk: false,
      error: { kind: 'INVALID_PASSWORD', message: 'A password is 1 to 1024 characters' },
    });
  });
});
