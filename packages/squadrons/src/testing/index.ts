/**
 * `@aeolus-fleet/squadrons/testing`: what core's end-to-end tests need to run
 * squadrons beside the console in their own process (decision 0049): the app,
 * its databases in core's shared Postgres container, and a fake GitHub for its
 * template repositories. A vitest global setup takes
 * `@aeolus-fleet/squadrons/testing/squadrons-global-setup` by its file.
 */
export { createSquadronsApp, type SquadronsApp } from '../app.js';
export { createSquadronsDatabase } from './database.js';
export { shaOf, startFakeGithub, tagsAt, type FakeGithub, type FakeRepository, type FakeTag } from './fake-github.js';
export { seedRepository } from './repositories.js';
