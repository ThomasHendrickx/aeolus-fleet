---
name: typescript
description: Mandatory for every .ts or .tsx change. Types, errors, validation, naming.
---

# TypeScript

- Forced by a library: `@ts-expect-error` with reason.
- Ids: typed ids from `common` (`ShipId`), never `string`. Parse them (`idSchema`).
- Closed sets: literal unions.
- Readonly inputs; return new values, never mutate.
- Domain outcomes: `Result<T, E>`, `E` a union of `{ kind: '...' }`. Adapters throw only for system failures. The tRPC adapter maps kinds to API errors in one place.
- Outside data (HTTP, env, DB rows, MCP args) is `unknown` until a `common` Zod schema parses it at the edge. Trust types after.
- Names from the blueprint, no synonyms. No abbreviations beyond `id url api db`. Named constants, no magic numbers.
- Comments say why. Top-of-file doc comment for non-trivial files. No commented-out code.
- ESM with `.js` relative imports, one primary export per file, no barrels inside core.

Enforced by lint (`eslint.config.js`): `any`, casts, `!`, `@ts-ignore`, exhaustive switches, parameter count, boolean names, default exports, file names, no `throw` in core.
