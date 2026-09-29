---
name: typescript
description: MANDATORY for any .ts or .tsx change in Aeolus. TypeScript rules for all three packages: strictness, branded ids, results versus exceptions, validation at the edge, naming, comments, module style.
---

# TypeScript in Aeolus

Strict mode and typescript-eslint `strictTypeChecked` are on. These rules cover what the compiler and linter cannot.

## Types

- No `any`, no `as` casts to silence the compiler, no non-null `!`, no `@ts-ignore`. Where a library forces it, `@ts-expect-error` with a one-line reason.
- Ids use the typed ids from `@aeolus-fleet/common` (`ShipId` is `` `shp_${string}` ``), never plain `string`. A function that takes a `ShipId` cannot be given a `MessageId`. Parse unknown strings with the id helpers, never cast.
- Closed sets are string-literal unions with an exhaustive `switch` ending in a `never` check.
- `interface` for object shapes, `type` for unions and function types.
- Inputs are `readonly`; never mutate an argument. Domain state changes by returning a new value.
- Three or more parameters become one named object.

## Errors

- Domain outcomes are values: a use case returns `Result<T, E>` where `E` is a union of named domain errors (`{ kind: 'argo-cannot-be-retired' }`). Callers must handle every `kind`.
- Throw only for system failures (database unreachable, bug). Never catch an error just to log it and continue.
- The tRPC adapter maps each domain error kind to an API error code in one place.

## Validation

- Everything from outside (HTTP input, environment, database JSON, MCP arguments) is `unknown` until a Zod schema from `common` parses it at the edge.
- After the edge, trust the types. No defensive `?.` chains deep inside core.

## Naming and comments

- Names come from the blueprint's ubiquitous language. No synonyms (a ship is never an agent record, a delivery is never a job).
- Booleans read as questions: `isRetired`, `hasOpenLease`. Functions are verbs, values are nouns. No abbreviations except `id`, `url`, `api`, `db`.
- No magic literals: named constants at the top of the file (`MAX_PAYLOAD_BYTES`, `MAX_CLAIMS_WITHOUT_ACK`).
- Comments say why, never what. Every non-trivial file starts with a short doc comment saying what it is for.
- No commented-out code, no TODO without an open question in the PR.

## Modules

- ESM with explicit `.js` extensions in relative imports, as the packages already do.
- `import type` for type-only imports (enforced).
- Named exports only. One primary export per file; the file is named after it in kebab-case.
- No barrel files inside core contexts; import from the file that defines the thing. Package entry points (`index.ts`) export only the public surface.
