import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it, vi } from 'vitest';

import type { IssueSignInLink } from '../../domain/identity/issue-sign-in-link.js';
import type { InitialiseFleet } from '../../domain/registry/initialise-fleet.js';
import type { ListFleets } from '../../domain/registry/list-fleets.js';
import { refuse } from '../../domain/shared/errors.js';
import { ok } from '../../domain/shared/result.js';
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

const initialised: InitialiseFleet = () =>
  Promise.resolve(
    ok({
      fleetId: newId('fleet'),
      operatorShipId: newId('ship'),
      operatorId: newId('operator'),
    }),
  );

/** An installation without a fleet yet. */
const noFleets: ListFleets = () => Promise.resolve([]);

const TICKET = 'aeolus_st_v1_ticket';

const linked: IssueSignInLink = () => Promise.resolve(ok({ ticket: TICKET, expiresAt: new Date('2026-10-21T12:15:00.000Z') }));

const CONSOLE_ORIGIN = 'http://localhost:3000';

function depsWith(overrides: Partial<Parameters<typeof fleetInit>[1]> & { io: CommandIo }): Parameters<typeof fleetInit>[1] {
  return { initialiseFleet: initialised, issueSignInLink: linked, listFleets: noFleets, consoleOrigin: CONSOLE_ORIGIN, ...overrides };
}

describe('fleet:init', () => {
  it('asks nothing: argo signs in with the link it prints', async () => {
    const io = scriptedIo();

    await expect(fleetInit(['--name', 'home fleet'], depsWith({ io }))).resolves.toBe(0);

    expect(io.questions).toEqual([]);
  });

  it('passes the name alone', async () => {
    const io = scriptedIo();
    const initialiseFleet = vi.fn(initialised);

    await fleetInit(['--name', 'home fleet'], depsWith({ initialiseFleet, io }));

    expect(initialiseFleet).toHaveBeenCalledWith({ name: 'home fleet' });
  });

  it("prints the fleet, argo and a one-use console link to sign in as argo, valid 15 minutes, for the fleet it created", async () => {
    const io = scriptedIo();
    const issueSignInLink = vi.fn(linked);

    await fleetInit(['--name', 'home fleet'], depsWith({ issueSignInLink, io }));

    expect(issueSignInLink).toHaveBeenCalledWith({ fleetId: expect.stringMatching(/^flt_/) });
    expect(io.stdout).toHaveLength(1);
    expect(io.stdout[0]).toMatch(/Fleet initialised: flt_.+\nOperator ship argo: shp_.+\nOperator account: opr_/);
    expect(io.stdout[0]).toContain(`Open ${CONSOLE_ORIGIN}/sign-in/ticket?ticket=${TICKET} to sign in to the console as argo.`);
    expect(io.stdout[0]).toContain('The link works once, for 15 minutes. For a new one, run npx aeolus-core sign-in.');
    expect(io.stdout[0]).toContain('To sign in with an email and password instead, set them in Settings once you are in.');
    expect(io.stderr).toEqual([]);
  });

  it('says the fleet exists and how to get a link, when the link cannot be issued', async () => {
    const io = scriptedIo();
    const refused: IssueSignInLink = () => Promise.resolve(refuse('FLEET_NOT_FOUND', 'The installation hosts no fleet'));

    await expect(fleetInit(['--name', 'home fleet'], depsWith({ issueSignInLink: refused, io }))).resolves.toBe(1);

    expect(io.stdout[0]).toMatch(/Fleet initialised: flt_/);
    expect(io.stderr).toEqual(['No sign-in link was issued: The installation hosts no fleet. Run npx aeolus-core sign-in for one.']);
  });

  it('needs a name', async () => {
    const io = scriptedIo();
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit([], depsWith({ initialiseFleet, io }))).resolves.toBe(2);

    expect(initialiseFleet).not.toHaveBeenCalled();
    expect(io.stderr.join('\n')).toContain('--name "<fleet name>"');
  });

  it.each([[['--name']], [['--fleet', 'x']], [['--name', 'a', 'extra']]])('refuses the arguments %j', async (args) => {
    const io = scriptedIo();

    await expect(fleetInit(args, depsWith({ io }))).resolves.toBe(2);
    expect(io.stdout).toEqual([]);
  });

  it('reports a refusal from the domain and exits 1', async () => {
    const io = scriptedIo();
    const refused: InitialiseFleet = () =>
      Promise.resolve(refuse('FLEET_ALREADY_EXISTS', 'A fleet already exists: a fleet is initialised only once'));

    await expect(fleetInit(['--name', 'again'], depsWith({ initialiseFleet: refused, io }))).resolves.toBe(1);

    expect(io.stderr).toEqual(['A fleet already exists: a fleet is initialised only once']);
    expect(io.stdout).toEqual([]);
  });

  // Postgres text can never store U+0000: the command refuses it as the API does, naming what holds it.
  it('refuses a name holding U+0000, and creates nothing', async () => {
    const io = scriptedIo();
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit(['--name', 'home\u0000fleet'], depsWith({ initialiseFleet, io }))).resolves.toBe(1);

    expect(initialiseFleet).not.toHaveBeenCalled();
    expect(io.stderr).toEqual(['The fleet name cannot hold the character U+0000 (NUL). Nothing was created.']);
  });
});

describe('fleet:init with a fleet already there', () => {
  it('refuses and creates nothing', async () => {
    const io = scriptedIo();
    const initialiseFleet = vi.fn(initialised);
    const oneFleet: ListFleets = () =>
      Promise.resolve([{ id: newId('fleet'), name: 'home fleet', createdAt: new Date('2026-09-29T12:00:00.000Z') }]);

    await expect(fleetInit(['--name', 'again'], depsWith({ initialiseFleet, listFleets: oneFleet, io }))).resolves.toBe(1);

    expect(io.stderr).toEqual(['A fleet already exists: a fleet is initialised only once. Nothing was created.']);
    expect(initialiseFleet).not.toHaveBeenCalled();
  });
});
