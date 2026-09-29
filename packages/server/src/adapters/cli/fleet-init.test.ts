import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it, vi } from 'vitest';

import type { InitialiseFleet } from '../../core/registry/initialise-fleet.js';
import { DomainError } from '../../core/shared/errors.js';
import { fleetInit } from './fleet-init.js';
import type { CommandIo } from './io.js';

const newId = createIdGenerator();

function recordingIo(): CommandIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (text) => stdout.push(text), err: (text) => stderr.push(text) };
}

const initialised: InitialiseFleet = ({ name }) =>
  Promise.resolve({ fleetId: newId('fleet'), operatorShipId: newId('ship'), secret: `aeolus_sk_v1_secret-for-${name}` });

describe('fleet:init', () => {
  it("passes the name and prints argo's secret once", async () => {
    const io = recordingIo();
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit(['--name', 'home fleet'], { initialiseFleet, io })).resolves.toBe(0);

    expect(initialiseFleet).toHaveBeenCalledWith({ name: 'home fleet' });
    expect(io.stdout).toHaveLength(1);
    expect(io.stdout[0]?.match(/aeolus_sk_v1_secret-for-home fleet/g)).toHaveLength(1);
    expect(io.stdout[0]).toMatch(/Fleet initialised: flt_.+\nOperator ship argo: shp_/);
    expect(io.stderr).toEqual([]);
  });

  it('needs a name', async () => {
    const io = recordingIo();
    const initialiseFleet = vi.fn(initialised);

    await expect(fleetInit([], { initialiseFleet, io })).resolves.toBe(2);

    expect(initialiseFleet).not.toHaveBeenCalled();
    expect(io.stderr.join('\n')).toContain('--name "<fleet name>"');
  });

  it.each([[['--name']], [['--fleet', 'x']], [['--name', 'a', 'extra']]])('refuses the arguments %j', async (args) => {
    const io = recordingIo();

    await expect(fleetInit(args, { initialiseFleet: initialised, io })).resolves.toBe(2);
    expect(io.stdout).toEqual([]);
  });

  it('reports a refusal from the domain and exits 1', async () => {
    const io = recordingIo();
    const refused: InitialiseFleet = () =>
      Promise.reject(new DomainError('FLEET_ALREADY_EXISTS', 'A fleet already exists: a fleet is initialised only once'));

    await expect(fleetInit(['--name', 'again'], { initialiseFleet: refused, io })).resolves.toBe(1);

    expect(io.stderr).toEqual(['A fleet already exists: a fleet is initialised only once']);
    expect(io.stdout).toEqual([]);
  });
});
