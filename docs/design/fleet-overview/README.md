# Fleet overview: five alternatives

[Issue 1441](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1441). Thomas, 31 Oct: "Can you give me 5 alternatives to get an overview of the fleet? This one is more marketing friendly showing the ships and their status". Mockups only; Thomas picks, nothing is built from this.

Each alternative is in the Compact look ([ui-package mockups](../ui-package/mockups/README.md)), desktop light and dark, phone light and dark. All five show the same 15 ships: 2 people (argo, ada), 7 agents (an orchestrator, builders, walkers, a reviewer), 3 plugins (squadrons, trierarch, networking) and 3 proxy ships the gateway crews (linear, github, sentry). Seven are working, four idle, two waiting (blocked or awaiting crew) and two have an open alert. Each HTML file stands alone, with the tokens and Geist fonts inlined; each PNG is that file rendered in Chromium at 1x.

| # | Alternative | Shows well | Costs |
| --- | --- | --- | --- |
| 1 | [Ship cards](fleet-1.html) ([png](fleet-1.png)) | One card per ship, alerts first, with what it is doing: each ship reads as a thing with a job | A fleet of 60 scrolls; comparing ships across rows is slower than a table |
| 2 | [Lanes by kind](fleet-2.html) ([png](fleet-2.png)) | What the fleet is made of: people, agents, plugins and outside servers side by side | Status is spread over the lanes, so alerts do not come first; no line on what a ship is doing |
| 3 | [Status board](fleet-3.html) ([png](fleet-3.png)) | What needs a look: the Alert and Waiting columns are the to-do list | Ships jump column as their status changes on a live screen; a long Idle column pushes the page |
| 4 | [Fleet map](fleet-4.html) ([png](fleet-4.png)) | That Aeolus carries messages between ships: nodes ringed in their status, lines for who sends to whom, a dashed red line for a stuck delivery | Tangles past about 25 ships; needs who sends to whom, which the overview read does not hold today; says nothing of what a ship is doing |
| 5 | [Harbour](fleet-5.html) ([png](fleet-5.png)) | The whole fleet on one screen even at 100 ships: big numbers, then one tile per ship by kind, filled in its status tone, idle tiles plain | A tile holds only the name and status; what a ship does waits for a hover or a tap; long names truncate |

**My pick: 5, Harbour.**
- It answers "how is my fleet" before anything is read: the numbers, then where the colour is.
- It scales: 15 ships or 100 fit one screen, which none of the others do.
- It still says what the fleet is made of, grouped by kind as in 2, and status carries its icon and word, so it reads without colour.
- It makes the hero shot for marketing without inventing data the overview does not hold, which 4 needs.
- Cost to accept: what a ship is doing moves to a hover or a tap; the console's table stays the place to read it.
