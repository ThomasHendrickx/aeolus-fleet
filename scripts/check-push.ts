import { spawnSync } from 'node:child_process';

function run(name: string, [command, ...args]: [string, ...string[]]): void {
  console.log(`\nChecking ${name}...`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`${name} failed`);
    process.exit(result.status ?? 1);
  }
}

run('conflicts with origin/main', ['git', 'merge-tree', '--write-tree', 'origin/main', 'HEAD']);
run('database expected lists', ['npx', 'vitest', 'run', '--project', 'core:integration', 'test/api.integration.test.ts', 'test/rest.integration.test.ts', 'test/history.integration.test.ts', 'test/schema.integration.test.ts']);
run('typecheck', ['npm', 'run', 'typecheck']);
run('lint', ['npm', 'run', 'lint']);
run('unit tests', ['npm', 'run', 'test:unit']);
run('query plans', ['node', 'scripts/check-query-plans.ts', 'origin/main', 'HEAD']);
