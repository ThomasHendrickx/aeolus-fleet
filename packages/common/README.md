# @aeolus-fleet/common

Shared schemas, prefixed ids and types for [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet), an agent fleet manager.

Before 1.0.0 the API may change between minor releases.

`@aeolus-fleet/common/rules` holds the plain rules a browser may use for live hints, without zod: ship and label handles, the payload size, the sign-in checks and what the header's app switcher offers. The schemas are built on the same rules.

The UI parts every Aeolus web app shows live in [`@aeolus-fleet/ui`](../ui/README.md).
