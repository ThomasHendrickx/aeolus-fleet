# Aeolus brand

The one source of the Aeolus logo. Every Aeolus surface (console, squadrons, pagasae, docs, the website) takes its icons from this folder, copied or referenced. Never redraw, recolour or re-export the mark by hand.

## The mark

The Ship glyph on a rounded tile in `--primary`, the stroke in `--primary-foreground`. It is the Avatar `kind: app` part in [docs/design](../docs/design/README.md). There is no wordmark file: where a name sits beside the mark, it is the text "Aeolus" in the console font, as the Sidebar shows.

## Files

| File | Use |
| --- | --- |
| `aeolus-mark.svg` | Favicon (`<link rel="icon" type="image/svg+xml">`), docs, anything that scales. Switches to the dark tile under `prefers-color-scheme: dark`. The console serves an exact copy as `packages/web/app/icon.svg`, since Next.js needs a real file in `app/`: change this file, then copy it there. |
| `favicon-16.png`, `favicon-32.png`, `favicon-48.png` | PNG favicon fallback for browsers without SVG icons. |
| `apple-touch-icon.png` | 180 px, square without corners: iOS rounds it. |
| `icon-192.png`, `icon-512.png` | Web app manifest icons. `icon-512.png` is also the social image until a dedicated one exists. |

The PNGs are the light variant, rendered from `aeolus-mark.svg` with sharp. When the SVG changes, render them again.

## Colours

From `--primary` and `--primary-foreground` in [tokens.css](../packages/web/app/tokens.css), light and dark. Do not copy the values elsewhere; take the files.

## Clear space and don'ts

- Keep clear space of at least a quarter of the mark's width on every side.
- Smallest size: 16 px.
- Do not stretch, rotate, outline, add shadows or put the mark on a busy image.
- Do not change the glyph, the tile shape or the colours, and do not swap in another icon set's ship.
