import { describe, expect, it } from 'vitest';

import { codeWithoutComments } from './comments.ts';

describe('codeWithoutComments', () => {
  it('is the same for TypeScript that differs only in comments: doc, line and block', () => {
    const before = "/** One. */\nexport const fleet = 1; // trailing\n/* block */\nexport const name = 'argo';\n";
    const after = "/**\n * Two,\n * longer.\n */\nexport const fleet = 1;\nexport const name = 'argo';\n";

    expect(codeWithoutComments('core/fleet.ts', after)).toBe(codeWithoutComments('core/fleet.ts', before));
  });

  it('differs when TypeScript code changes', () => {
    expect(codeWithoutComments('core/fleet.ts', 'export const fleet = 2;\n')).not.toBe(
      codeWithoutComments('core/fleet.ts', 'export const fleet = 1;\n'),
    );
  });

  it('keeps a string that looks like a comment: changing it changes the code', () => {
    expect(codeWithoutComments('core/fleet.ts', "export const url = '// two';\n")).not.toBe(
      codeWithoutComments('core/fleet.ts', "export const url = '// one';\n"),
    );
  });

  it('reads TSX', () => {
    expect(codeWithoutComments('web/row.tsx', 'export const Row = () => <tr>{/* two */}</tr>;\n')).toBe(
      codeWithoutComments('web/row.tsx', 'export const Row = () => <tr>{/* one */}</tr>;\n'),
    );
  });

  it('is the same for a Prisma schema that differs only in comments', () => {
    const before = '/// A ship.\nmodel Ship {\n  id String @id // its id\n}\n';
    const after = '/// A ship, with an inbox.\n// Written by hand.\nmodel Ship {\n  id String @id\n}\n';

    expect(codeWithoutComments('prisma/schema.prisma', after)).toBe(
      codeWithoutComments('prisma/schema.prisma', before),
    );
  });

  it('keeps a Prisma string that holds //, and sees a changed field', () => {
    const before = 'datasource db {\n  url = "postgres://one"\n}\n';

    expect(codeWithoutComments('prisma/schema.prisma', 'datasource db {\n  url = "postgres://two"\n}\n')).not.toBe(
      codeWithoutComments('prisma/schema.prisma', before),
    );
  });

  it.each(['migrations/1_init/migration.sql', 'package.json', 'README'])(
    'reads no other kind of file: %s',
    (path) => {
      expect(codeWithoutComments(path, '-- a comment\n')).toBeUndefined();
    },
  );
});
