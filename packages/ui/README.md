# @aeolus-fleet/ui

The UI parts every [Aeolus](https://github.com/ThomasHendrickx/aeolus-fleet) web app shows, built once: atoms, molecules and organisms in React on Base UI, props only, with no fetching, tRPC, store or zod. Each app reads its data behind its own hooks and hands a part what to show.

Before 1.0.0 the API may change between minor releases.

- `@aeolus-fleet/ui`: every part, such as the app header, the app switcher, the avatar menu, the command palette and the atoms they stand on.
- `@aeolus-fleet/ui/tokens.css`: the single copy of the design tokens, light on `:root` and dark on `.dark`.
- `@aeolus-fleet/ui/brand.css`: the single copy of the brand tokens (colour, type and motion from the brandbook), light on `:root` and dark on `.dark`, with reduced motion standing still at the rest frame. Its story, Brand/Tokens, shows every token in both modes. The apps' look stays in `tokens.css`.
- `@aeolus-fleet/ui/theme.css`: the tokens mapped onto Tailwind v4. An app imports Tailwind and `tw-animate-css`, then this file, and scans the package with `@source`.

Its peers are React, Base UI, lucide, `class-variance-authority`, `clsx`, `tailwind-merge` and `@aeolus-fleet/common` at the same version, for types. How the parts look and when to use which: [docs/design/conventions.md](../../docs/design/conventions.md).
