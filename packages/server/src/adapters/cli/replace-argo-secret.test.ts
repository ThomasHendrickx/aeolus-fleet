import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it, vi } from 'vitest';

import type { ReplaceOperatorSecret } from '../../core/identity/replace-operator-secret.js';
import type { Fleet } from '../../core/registry/fleet.js';
import { refuse } from '../../core/shared/errors.js';
import { ok } from '../../core/shared/result.js';
import type { CommandIo } from './io.js';
import { replaceArgoSecret } from './replace-argo-secret.js';

const newId = createIdGenerator();

function recordingIo(): CommandIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
    ask: () => Promise.resolve(undefined),
  };
}

function fleet(): Fleet {
  return { id: newId('fleet'), name: 'home fleet', createdAt: new Date() };
}

const replaced: ReplaceOperatorSecret = () => Promise.resolve(ok({ shipId: newId('ship'), secret: 'aeolus_sk_v1_new' }));

describe('argo:replace-secret', () => {
  it("replaces the secret of the installation's fleet and prints the new one once", async () => {
    const io = recordingIo();
    const only = fleet();
    const replaceOperatorSecret = vi.fn(replaced);

    await expect(
      replaceArgoSecret([], { listFleets: () => Promise.resolve([only]), replaceOperatorSecret, io }),
    ).resolves.toBe(0);

    expect(replaceOperatorSecret).toHaveBeenCalledWith({ fleetId: only.id });
    expect(io.stdout[0]?.match(/aeolus_sk_v1_new/g)).toHaveLength(1);
    expect(io.stdout[0]).toContain('every console session has ended');
  });

  it('refuses when there is no fleet yet', async () => {
    const io = recordingIo();

    await expect(
      replaceArgoSecret([], { listFleets: () => Promise.resolve([]), replaceOperatorSecret: replaced, io }),
    ).resolves.toBe(1);
    expect(io.stderr).toEqual(['There is no fleet yet. Run fleet:init first.']);
  });

  it('refuses to choose between several fleets', async () => {
    const io = recordingIo();
    const replaceOperatorSecret = vi.fn(replaced);

    await expect(
      replaceArgoSecret([], { listFleets: () => Promise.resolve([fleet(), fleet()]), replaceOperatorSecret, io }),
    ).resolves.toBe(1);
    expect(replaceOperatorSecret).not.toHaveBeenCalled();
  });

  it('reports a refusal from the domain and exits 1', async () => {
    const io = recordingIo();
    const only = fleet();
    const refused: ReplaceOperatorSecret = () =>
      Promise.resolve(refuse('FLEET_NOT_FOUND', `Fleet ${only.id} does not exist`));

    await expect(
      replaceArgoSecret([], { listFleets: () => Promise.resolve([only]), replaceOperatorSecret: refused, io }),
    ).resolves.toBe(1);

    expect(io.stderr).toEqual([`Fleet ${only.id} does not exist`]);
    expect(io.stdout).toEqual([]);
  });

  it('takes no arguments', async () => {
    const io = recordingIo();

    await expect(
      replaceArgoSecret(['--fleet', 'x'], { listFleets: () => Promise.resolve([fleet()]), replaceOperatorSecret: replaced, io }),
    ).resolves.toBe(2);
  });
});
