# @aeolus-fleet/common

Shared schemas, prefixed ids and types, and the header every Aeolus web app shows, for [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet), an agent fleet manager.

Before 1.0.0 the API may change between minor releases.

`@aeolus-fleet/common/rules` holds the plain rules a browser may use for live hints, without zod: ship and label handles, the payload size and the sign-in checks. The schemas are built on the same rules.

`@aeolus-fleet/common/header` holds the header every Aeolus web app shows (app header, app switcher, avatar menu, command palette, sign-in backgrounds) and the atoms it stands on, with `@aeolus-fleet/common/header/tokens.css`, the single copy of the design tokens. It needs React and Base UI, which are optional peer dependencies: the other entry points need neither.
