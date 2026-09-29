---
name: typescript
description: Mandatory for every .ts or .tsx change. Types, errors, validation, naming.
---

# TypeScript

- No `any`, no silencing `as`, no `!`, no `@ts-ignore`. Forced by a library: `@ts-expect-error` with reason.
- Ids: typed ids from `common` (`ShipId`), never `string`. Parse, never cast.
- Closed sets: literal unions, exhaustive `switch` with `never`.
- Readonly inputs; return new values, never mutate.
- 3+ params: one named object.
- Domain outcomes: `Result<T, E>`, `E` a union of `{ kind: '...' }`. Throw only for system failures. The tRPC adapter maps kinds to API errors in one place.
- Outside data (HTTP, env, DB JSON, MCP args) is `unknown` until a `common` Zod schema parses it at the edge. Trust types after.
- Names from the blueprint, no synonyms. Booleans `is/has/can`. No abbreviations beyond `id url api db`. Named constants, no magic numbers.
- Comments say why. Top-of-file doc comment for non-trivial files. No commented-out code.
- ESM with `.js` relative imports, named exports, one primary export per kebab-case file, no barrels inside core.
