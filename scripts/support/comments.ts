/**
 * A file's code without its comments, so the TDD evidence check can tell a
 * change to comments alone from a change to code. Reads TypeScript and
 * JavaScript through the TypeScript parser, and Prisma schemas line by line.
 * Any other kind of file is not read: its every change counts as code.
 */
import { extname } from 'node:path';

import ts from 'typescript';

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

/**
 * The code of a file, printed without comments; undefined for a kind of file
 * this does not read. Two versions of a file differ only in comments, or in
 * layout the printer evens out, when their code is the same.
 */
export function codeWithoutComments(path: string, text: string): string | undefined {
  const extension = extname(path);
  if (extension === '.prisma') {
    return prismaWithoutComments(text);
  }
  const scriptKind = SCRIPT_KINDS[extension];
  if (scriptKind === undefined) {
    return undefined;
  }
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, scriptKind);
  return ts.createPrinter({ removeComments: true }).printFile(source);
}

/** A Prisma schema without `//` and `///` comments, each line trimmed, blank lines dropped. */
function prismaWithoutComments(text: string): string {
  return text
    .split('\n')
    .map((line) => lineWithoutComment(line).trim().replace(/\s+/g, ' '))
    .filter((line) => line !== '')
    .join('\n');
}

/** The line up to a `//` that is not inside a double-quoted string. */
function lineWithoutComment(line: string): string {
  let isInString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (isInString && character === '\\') {
      index += 1;
    } else if (character === '"') {
      isInString = !isInString;
    } else if (!isInString && character === '/' && line[index + 1] === '/') {
      return line.slice(0, index);
    }
  }
  return line;
}
