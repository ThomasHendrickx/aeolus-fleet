# Aeolus brand

The one source of the Aeolus logo files. Every Aeolus surface (console, squadrons, pagasae, docs, the website) takes its mark, wordmark and icons from this folder, copied or referenced. Never redraw, recolour or retype them by hand.

How the mark is built, its colours, clear space and don'ts: the Mark section of the brandbook (`brand/source/brandbook.html` on the `brandbook-source` branch). Every file here draws the mark exactly as that section does.

## Files

| File | Use |
| --- | --- |
| `aeolus-mark-slate.svg` | The mark in Slate. On white or mist, and anything that scales: favicon (`<link rel="icon" type="image/svg+xml">`), docs. |
| `aeolus-mark-white.svg` | The mark in white, on Slate. |
| `aeolus-mark-light-slate.svg` | The mark in light slate, on navy: dark mode and dark surfaces. |
| `aeolus-mark-black.svg` | The mark in black, where only one ink exists (print, stamps). |
| `aeolus-wordmark-slate.svg` | The wordmark (the mark as the A, then "eolus" in Jost 400, outlined) in Slate, on light. Smallest at 18 px high; below that, the mark goes alone. |
| `aeolus-wordmark-light-slate.svg` | The wordmark in light slate, on navy. |
| `favicon-16.png`, `favicon-24.png`, `favicon-32.png`, `favicon-48.png` | PNG favicons: the Slate mark filling its square, transparent. Never below 16. |
| `apple-touch-icon.png` | 180 px: the white mark on a Slate tile, square, since iOS rounds it. |
| `icon-192.png`, `icon-512.png` | Web app manifest icons: the white mark on a rounded Slate tile, as the brandbook's app tiles draw it. `icon-512.png` is also the social image until a dedicated one exists. |

Each SVG holds one colour. The wind is a mask that cuts the mast and sail, so the files never carry a drawn line for it.
