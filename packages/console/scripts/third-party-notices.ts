/**
 * The licence notices of the third-party code the console package ships:
 * every package Next.js traced into `.next/standalone/node_modules`
 * (vendored ones under `next/dist/compiled` too), and every package the
 * console's bundles hold, which is each package it builds with but its
 * tooling, and what those depend on, and the fonts it self-hosts. Their licences (MIT, ISC, Apache-2.0
 * and the like) ask for the notice to travel with every copy, so the package
 * carries it as `THIRD_PARTY_NOTICES` in the standalone output, which an
 * image may copy alone.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { z } from 'zod';

/** Where the notices go: in the standalone output, beside its node_modules. */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES';

/**
 * The console's devDependencies it only builds and tests with, never ships:
 * its own packages carry its own licence, core it imports for types alone.
 */
const TOOLING = [/^@aeolus-fleet\/core$/, /^@types\//, /^@storybook\//, /^storybook$/, /^@vitest\//, /^@tailwindcss\/postcss$/];

/** Its own packages' scope: shipped under the console's own LICENSE, but what they depend on is third party. */
const OWN_SCOPE = '@aeolus-fleet/';

/** The fonts the console self-hosts from app/fonts, which the browser's files carry (the console README, Design system). */
const FONTS = { name: 'Geist and Geist Mono fonts', version: 'self-hosted', license: 'OFL-1.1', folder: join('app', 'fonts') };

const LICENCE_FILE = /^(licen[cs]e|copying|notice|ofl)(\..*)?$/i;

const packageJsonSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  license: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

type PackageJson = z.infer<typeof packageJsonSchema>;

/** One third-party package as the notices name it, with the texts of its licence files. */
export interface NoticedPackage {
  name: string;
  version: string;
  license: string;
  licenceTexts: string[];
}

function readPackageJson(directory: string): PackageJson | undefined {
  const path = join(directory, 'package.json');
  return existsSync(path) ? packageJsonSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
}

/** The texts of a package directory's licence and notice files, by name. */
function licenceTextsIn(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => LICENCE_FILE.test(entry) && statSync(join(directory, entry)).isFile())
    .sort()
    .map((entry) => readFileSync(join(directory, entry), 'utf8').trim());
}

/** A package as the notices name it, its licence files read from where it is installed; none for one of the console's own. */
function noticedPackage(json: PackageJson, installed: string): NoticedPackage | undefined {
  if (json.name === undefined || json.name.startsWith(OWN_SCOPE)) {
    return undefined;
  }
  return {
    name: json.name,
    version: json.version ?? 'vendored',
    license: json.license ?? 'not stated',
    licenceTexts: licenceTextsIn(installed),
  };
}

/** Where Node.js finds a package from a directory: the nearest node_modules holding it, up to the repository root. */
function resolvePackage(name: string, places: { from: string; repositoryRoot: string }): string | undefined {
  const { from, repositoryRoot } = places;
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }
    if (directory === repositoryRoot || directory === dirname(directory)) {
      return undefined;
    }
  }
}

/** Every directory under a folder that holds a package.json. */
function packageDirectoriesUnder(folder: string): string[] {
  if (!existsSync(folder)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(folder, { recursive: true, encoding: 'utf8' })) {
    if (entry === 'package.json' || entry.endsWith('/package.json')) {
      found.push(join(folder, dirname(entry)));
    }
  }
  return found;
}

/**
 * The packages to give notice of: those traced into the standalone output,
 * whose licence files Next.js leaves behind, so they are read from the
 * installed copy at the same path, and the bundled ones with what they
 * depend on, found as Node.js resolves them. One each by name and version.
 */
export function noticedPackages(places: { consoleRoot: string; repositoryRoot: string; standalone: string }): NoticedPackage[] {
  const { consoleRoot, repositoryRoot, standalone } = places;
  const byKey = new Map<string, NoticedPackage>();
  const add = (noticed: NoticedPackage | undefined) => {
    if (noticed !== undefined && !byKey.has(`${noticed.name}@${noticed.version}`)) {
      byKey.set(`${noticed.name}@${noticed.version}`, noticed);
    }
  };

  for (const directory of packageDirectoriesUnder(join(standalone, 'node_modules'))) {
    const json = readPackageJson(directory);
    const path = relative(standalone, directory);
    const installed = [join(consoleRoot, path), join(repositoryRoot, path)].find((candidate) => existsSync(candidate)) ?? directory;
    if (json !== undefined) {
      add(noticedPackage(json, installed));
    }
  }

  const consoleJson = readPackageJson(consoleRoot);
  const roots = Object.keys(consoleJson?.devDependencies ?? {}).filter((name) => !TOOLING.some((tooling) => tooling.test(name)));
  const seen = new Set<string>();
  const pending = roots.map((name) => ({ name, from: consoleRoot }));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const directory = resolvePackage(next.name, { from: next.from, repositoryRoot });
    if (directory === undefined || seen.has(directory)) {
      continue;
    }
    seen.add(directory);
    const json = readPackageJson(directory);
    if (json === undefined) {
      continue;
    }
    add(noticedPackage(json, directory));
    for (const dependency of Object.keys(json.dependencies ?? {})) {
      pending.push({ name: dependency, from: directory });
    }
  }

  const fonts = join(consoleRoot, FONTS.folder);
  if (existsSync(fonts)) {
    add({ name: FONTS.name, version: FONTS.version, license: FONTS.license, licenceTexts: licenceTextsIn(fonts) });
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The notices file: each package by name, version and licence, then its licence texts as it ships them. */
export function noticesText(packages: readonly NoticedPackage[]): string {
  const sections = packages.map((noticed) => {
    const heading = `${noticed.name} ${noticed.version} (${noticed.license})`;
    const texts = noticed.licenceTexts.length > 0 ? noticed.licenceTexts : [`The package ships no licence file; its licence is ${noticed.license}.`];
    return [heading, '', ...texts].join('\n');
  });
  return [
    'The Aeolus console ships the following third-party software, each under its own licence.',
    ...sections,
  ].join(`\n\n${'-'.repeat(80)}\n\n`) + '\n';
}
