import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

export function lintPasses(): string[][] {
  const packages = readdirSync('packages', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .sort();
  return [
    ['.', ...packages.flatMap((path) => ['--ignore-pattern', `${path}/**`])],
    ...packages.map((path) => [path]),
  ];
}

if (import.meta.main) {
  // Separate processes bound memory: measured passing heaps are 1536 MiB root, 1024 common/ui, 2048 core/console; caps add 256-512 MiB margin.
  const heapByPath: Record<string, number> = { '.': 2048, 'packages/common': 1280, 'packages/ui': 1280, 'packages/core': 2560, 'packages/console': 2560 };
  for (const pass of lintPasses()) {
    const heap = heapByPath[pass[0] ?? ''] ?? 12288;
    const result = spawnSync(process.execPath, [`--max-old-space-size=${String(heap)}`, 'node_modules/eslint/bin/eslint.js', '--max-warnings', '0', ...pass], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  const result = spawnSync(process.execPath, ['scripts/check-train-dependencies.ts'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
