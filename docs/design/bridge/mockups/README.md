# Bridge mockups

Screens for [issue 1494](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1494), on the structure in [`../README.md`](../README.md): the stage 0 answers (CC1 to CC11) and the picks for CC12 to CC20, still open. Each sheet says which screen would differ if a pick goes the other way. Mockups only; they decide no behaviour.

The Compact look ([ui-package mockups](../../ui-package/mockups/README.md)); the person's fleet as Harbour draws it ([fleet overview](../../fleet-overview/README.md)). Each HTML file stands alone, with the tokens, the Compact kit and the Geist fonts inlined; each PNG is that file rendered in Chromium at 1x.

| File | What it shows |
| --- | --- |
| [home.html](home.html), [home.png](home.png) | Before: the gateway's Overview today. After: Bridge home, the one list of what waits with its count, the stay-aware feed, the person's fleet |
| [decide.html](decide.html), [decide.png](decide.png) | A question from orchestrator-1 opened in Bridge, then answered in Slack and read back in Bridge |
| [do.html](do.html), [do.png](do.png) | A step (create a GitHub repository): opened, done, cannot with its note, cannot sent |
| [stay-aware.html](stay-aware.html), [stay-aware.png](stay-aware.png) | The feed: an alert from the watch and notices (a PR opened, releases out); the alert opened |
| [done.html](done.html), [done.png](done.png) | Done: every item with its outcome and where it was done |
| [routing.html](routing.html), [routing.png](routing.png) | Where things show: routing per job, the places and their state |
| [views.html](views.html), [views.png](views.png) | The same question in Slack and in a chat (claude.ai), before and after the answer |
| [states.html](states.html), [states.png](states.png) | Nothing waits; the record cannot be read and Slack dropped out; an answer sending and one refused |

Desktop light and dark and phone light and dark for every Bridge screen, except the answer sending and refused (desktop only). Slack and claude.ai are drawn roughly in their own looks; only the content is Aeolus's.

The navigation (a sidebar with Waiting on you, Stay aware, Done, Your fleet and the settings; four tabs on the phone) is the mockup's, for the build to settle.
