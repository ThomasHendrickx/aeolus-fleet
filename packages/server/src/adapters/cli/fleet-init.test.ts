import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it, vi } from 'vitest';

import type { InitialiseFleet } from '../../core/registry/initialise-fleet.js';
import { refuse } from '../../core/shared/errors.js';
import { ok } from '../../core/shared/result.js';
import { fleetInit } from './fleet-init.js';
import type { CommandIo } from './io.js';

const newId = createIdGenerator();

/** An operator at the terminal who gives these answers, in order, then ends the input. */
function scriptedIo(answers: string[] = []): CommandIo & {
  stdout: string[];
  stderr: string[];
  questions: [string, boolean][];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const questions: [string, boolean][] = [];
  const remaining = [...answers];
  return {
    stdout,
    stderr,
    questions,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    ask: (question, options) => {
      questions.push([question, options?.isHidden ?? false]);
      return Promise.resolve(remaining.shift());
    },
  };
}

const answers = ['thomas@example.com', 'correct horse', 'correct horse'];

const initialised: InitialiseFleet = ({ name }) =>
  Promise.resolve(
    ok({
      fleetId: newId('fleet'),
      operatorShipId: newId('ship'),
      operatorId: newId('operator'),
      secret: `aeolus_sk_v1_secret-for-${name}`,
    }),
  );

describe('fleet:init', () => {
  it("asks for the operator's email, then the password twice without showing it", async () => {
    const io = scriptedIo(answers);

    await fleetInit(['--name', 'home fleet'], { initialiseFleet: initialised, io });

    expect(io.questions).toEqual([
      ['Operator email: ', false],
      ['Operator password: ', true],
      ['Repeat the password: ', true],
    ]);
  });

  it('passes the name, the email and the password', async () => {
    const io = scriptedIo(answers);
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit(['--name', 'home fleet'], { initialiseFleet, io })).resolves.toBe(0);

    expect(initialiseFleet).toHaveBeenCalledWith({
      name: 'home fleet',
      email: 'thomas@example.com',
      password: 'correct horse',
    });
    expect(io.stdout).toHaveLength(1);
    expect(io.stdout[0]).toMatch(/Fleet initialised: flt_.+\nOperator ship argo: shp_.+\nOperator account: opr_/);
    expect(io.stdout[0]).not.toContain('correct horse');
    expect(io.stderr).toEqual([]);
  });

  it('refuses two different passwords and creates nothing', async () => {
    const io = scriptedIo(['thomas@example.com', 'correct horse', 'correct hose']);
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit(['--name', 'home fleet'], { initialiseFleet, io })).resolves.toBe(1);

    expect(initialiseFleet).not.toHaveBeenCalled();
    expect(io.stderr).toEqual(['The two passwords differ. Nothing was created.']);
  });

  it('stops when the input ends before every answer is given', async () => {
    const io = scriptedIo(['thomas@example.com']);
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit(['--name', 'home fleet'], { initialiseFleet, io })).resolves.toBe(2);

    expect(initialiseFleet).not.toHaveBeenCalled();
    expect(io.stderr).toEqual(['fleet:init needs the operator email and the password twice. Nothing was created.']);
  });

  it('needs a name, and asks nothing without one', async () => {
    const io = scriptedIo(answers);
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit([], { initialiseFleet, io })).resolves.toBe(2);

    expect(initialiseFleet).not.toHaveBeenCalled();
    expect(io.questions).toEqual([]);
    expect(io.stderr.join('\n')).toContain('--name "<fleet name>"');
  });

  it.each([[['--name']], [['--fleet', 'x']], [['--name', 'a', 'extra']]])('refuses the arguments %j', async (args) => {
    const io = scriptedIo(answers);

    await expect(fleetInit(args, { initialiseFleet: initialised, io })).resolves.toBe(2);
    expect(io.stdout).toEqual([]);
  });

  it('reports a refusal from the domain and exits 1', async () => {
    const io = scriptedIo(answers);
    const refused: InitialiseFleet = () =>
      Promise.resolve(refuse('FLEET_ALREADY_EXISTS', 'A fleet already exists: a fleet is initialised only once'));

    await expect(fleetInit(['--name', 'again'], { initialiseFleet: refused, io })).resolves.toBe(1);

    expect(io.stderr).toEqual(['A fleet already exists: a fleet is initialised only once']);
    expect(io.stdout).toEqual([]);
  });
});
