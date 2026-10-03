import { randomInt } from 'node:crypto';

import type { RandomNames } from '../../core/squadron/ports.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Random lowercase alphanumerics from the system's cryptographic source. */
export const cryptoRandomNames: RandomNames = {
  suffix: (length) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)] ?? 'a').join(''),
};
