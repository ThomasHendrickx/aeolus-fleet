/** Make the design discoverable by the existing console Storybook, without changing its configuration. */
import { readFile, writeFile, rm } from 'node:fs/promises';
const entry = new URL('../../../packages/console/components/organisms/watch-design.stories.tsx', import.meta.url);
if (process.argv.includes('--clean')) {
  await rm(entry, { force: true });
} else {
  const source = await readFile(new URL('settings.stories.tsx', import.meta.url), 'utf8');
  await writeFile(entry, source.replaceAll('../../../packages/console/', '../../'), { flag: 'wx' });
}
