import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { it, expect } from 'vitest';

it('fails before checks when the branch conflicts with origin/main', () => {
  // Given conflicting changes on the branch and origin/main.
  const repository = mkdtempSync(join(tmpdir(), 'check-push-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
  try {
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repository, 'file'), 'base\n');
    git('add', 'file');
    git('commit', '-m', 'base');
    git('switch', '-c', 'branch');
    writeFileSync(join(repository, 'file'), 'branch\n');
    git('commit', '-am', 'branch');
    git('switch', 'main');
    writeFileSync(join(repository, 'file'), 'main\n');
    git('commit', '-am', 'main');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('switch', 'branch');

    // When the push check runs.
    const result = spawnSync('node', [resolve('scripts/check-push.ts')], { cwd: repository, encoding: 'utf8' });

    // Then it names the conflict and refuses the push.
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/conflict/i);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

it('clears Git hook variables before running the checks', () => {
  // Given Git has supplied its repository variables to the hook.
  const directory = mkdtempSync(join(tmpdir(), 'push-hook-'));
  try {
    const npm = join(directory, 'npm');
    writeFileSync(npm, '#!/bin/sh\ntest -z "$GIT_DIR" && test -z "$GIT_WORK_TREE"\n', { mode: 0o755 });

    // When the pre-push hook runs the checks.
    const result = spawnSync('sh', [resolve('.githooks/pre-push')], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}`, GIT_DIR: '/fake-git-dir', GIT_WORK_TREE: '/fake-work-tree' },
      encoding: 'utf8',
    });

    // Then the checks do not inherit the repository variables.
    expect(result.status).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
