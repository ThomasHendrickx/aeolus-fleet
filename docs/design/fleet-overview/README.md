# Fleet overview: Harbour

[Issue 1441](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1441). Thomas, 31 Oct, asked for "5 alternatives to get an overview of the fleet ... more marketing friendly showing the ships and their status", then picked: "Fleet overview 5 is the most usefull. 4 is a gimmick". Mockup only; nothing is built yet.

[harbour.html](harbour.html), [harbour.png](harbour.png): desktop light and dark, phone light and dark, in the Compact look ([ui-package mockups](../ui-package/mockups/README.md)). The HTML stands alone, with the tokens and Geist fonts inlined; the PNG is that file rendered in Chromium at 1x.

## What it shows

- **Numbers on top:** ships, then Alert, Waiting, Working and Idle, each with its status icon and word. Only Alert is filled in its tone.
- **One tile per ship below**, grouped by kind: People, Agents, Plugins, Through the gateway (the proxy ships the gateway crews). In each group: alerts first, then waiting, working, idle.
- **A tile** holds the ship's name and its status: icon and word in the tone, the tile filled in the tone (Alert attention, Waiting waiting, Working ok). Idle tiles stay plain, so colour marks only what is going on.
- **What a ship is doing** (its report) shows in the tile's title on hover and on tap; long names truncate.
- **Phone:** the same numbers in one row of five, tiles three across.

The mockup groups ship states into four for its numbers and tiles: Alert (an open alert), Waiting (awaiting crew or blocked), Working, Idle. Which state lands in which group is for the build to settle against the blueprint; the mockup decides no behaviour.
