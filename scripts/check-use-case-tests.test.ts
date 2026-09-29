import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCaseFactories, useCaseTestProblems } from './check-use-case-tests.ts';
import { createTemporaryRepository, type TemporaryRepository } from './support/temporary-repository.ts';

const signIn = 'export function createSignIn(deps: Deps): SignIn {\n  return () => deps.run();\n}\n';

describe('recognising a use-case file', () => {
  it.each([
    ['an exported factory function', signIn, ['createSignIn']],
    ['an exported async factory function', 'export async function createPing() {}\n', ['createPing']],
    ['an exported factory constant', 'export const createListFleets = (deps: Deps) => () => deps.list();\n', ['createListFleets']],
  ])('recognises %s', (_label, source, factories) => {
    expect(useCaseFactories(source)).toEqual(factories);
  });

  it.each([
    ['a value object', 'export function fleetName(raw: string) { return raw.trim(); }\n'],
    ['a factory that is not exported', 'function createSignIn() {}\nexport const x = 1;\n'],
    ['a re-export of a factory', "export { createSignIn } from './sign-in.js';\n"],
    ['a word that only starts with create', 'export function created() {}\nexport function creates() {}\n'],
    ['a type', 'export type createSignIn = () => void;\n'],
  ])('does not take %s for a use case', (_label, source) => {
    expect(useCaseFactories(source)).toEqual([]);
  });
});

describe('the use-case test check', () => {
  let repository: TemporaryRepository;

  beforeEach(() => {
    repository = createTemporaryRepository();
  });

  afterEach(() => {
    repository.dispose();
  });

  it('passes a use case with its test beside it', () => {
    repository.write('packages/server/src/core/identity/sign-in.ts', signIn);
    repository.write('packages/server/src/core/identity/sign-in.test.ts', 'test\n');
    repository.commit('feat: sign in');

    expect(useCaseTestProblems(repository.path)).toEqual([]);
  });

  it('refuses a use case without a test', () => {
    repository.write('packages/server/src/core/identity/sign-in.ts', signIn);
    repository.commit('feat: sign in');

    expect(useCaseTestProblems(repository.path)).toEqual([
      'packages/server/src/core/identity/sign-in.ts is a use case (createSignIn) without packages/server/src/core/identity/sign-in.test.ts',
    ]);
  });

  it('refuses a use case whose test is elsewhere', () => {
    repository.write('packages/server/src/core/identity/sign-in.ts', signIn);
    repository.write('packages/server/test/sign-in.test.ts', 'test\n');
    repository.commit('feat: sign in');

    expect(useCaseTestProblems(repository.path)).toHaveLength(1);
  });

  it('looks only at the core', () => {
    repository.write('packages/server/src/adapters/prisma/unit-of-work.ts', 'export function createPrismaUnitOfWork() {}\n');
    repository.write('packages/server/src/core/registry/fleet.ts', 'export function fleetName() {}\n');
    repository.commit('feat: adapters and value objects');

    expect(useCaseTestProblems(repository.path)).toEqual([]);
  });
});
