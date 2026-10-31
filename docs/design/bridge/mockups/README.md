# Bridge mockups

Screens for [issue 1494](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1494), on the structure in [`../README.md`](../README.md): the stage 0 answers (CC1 to CC11), CC12 to CC20 as approved, the basket with CC21 to CC24 as approved, and a step's note on the step. Mockups only; they decide no behaviour.

Thomas, 31 Oct, on these sheets: answers go through the basket, and a step's note shows before Done or Cannot, for both; "all the rest is approved". Then, on the basket sheet: "Basket approved".

The Compact look ([ui-package mockups](../../ui-package/mockups/README.md)); the person's fleet as Harbour draws it ([fleet overview](../../fleet-overview/README.md)). Each HTML file stands alone, with the tokens, the Compact kit and the Geist fonts inlined; each PNG is that file rendered in Chromium at 1x.

| File | What it shows |
| --- | --- |
| [home.html](home.html), [home.png](home.png) | Before: the gateway's Overview today. After: Bridge home, the one list of what waits with its count, the stay-aware feed, the person's fleet |
| [basket.html](basket.html), [basket.png](basket.png) | The basket: a question answered into it, the basket open, a question withdrawn and one replaced while in it, sending, sent, a failure |
| [decide.html](decide.html), [decide.png](decide.png) | A question from orchestrator-1 opened in Bridge, then answered in Slack and read back in Bridge |
| [do.html](do.html), [do.png](do.png) | A step (create a GitHub repository): opened with its note field, done with a note and sent, cannot with a note and sent |
| [stay-aware.html](stay-aware.html), [stay-aware.png](stay-aware.png) | The feed: an alert from the watch and notices (a PR opened, releases out); the alert opened |
| [done.html](done.html), [done.png](done.png) | Done: every item with its outcome and where it was done |
| [routing.html](routing.html), [routing.png](routing.png) | Where things show: routing per job, the places and their state |
| [views.html](views.html), [views.png](views.png) | The same question in Slack and in a chat (claude.ai), before and after the answer |
| [states.html](states.html), [states.png](states.png) | Nothing waits; the record cannot be read and Slack dropped out |

Desktop light and dark and phone light and dark for every Bridge screen. Slack and claude.ai are drawn roughly in their own looks; only the content is Aeolus's.

The navigation (a sidebar with Waiting on you, the basket while it holds any, Stay aware, Done, Your fleet and the settings; four tabs on the phone, the basket a bar above them) is the mockup's, for the build to settle.
