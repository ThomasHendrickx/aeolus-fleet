# 0024 Guide

- The installation sets the console's guide: `installation.guide.set { guide }` replaces it, and null clears it. `installation.guide.get` reads it back. There is one guide or none. It has an audience (`everyone`, `operators` or `viewers`, as notices have) and 1 to 10 steps in order. Each step has a console path (its page, such as `/squadrons`), an optional anchor (the `data-testid` of the element it points at), a title (at most 80 characters) and a plain text (at most 300).
- The guide belongs to the installation, not to a fleet, and writes no event. A self-hosted server has no installation token, so it has no guide.
- A console session of the guide's audience keeps its own progress on the server: the step it is at, and whether the guide is open, skipped or finished. The progress goes with the session's fleet. A session that has not moved yet is open at the first step, so the guide opens by itself on the session's first console page. A new session starts again.
- Next and Back record the step and go to its page. Skip and Finish hide the guide for the rest of the session. The account menu offers Take the tour while a guide is for the session: it opens the guide at the first step again.
- A step points at its anchor on its page. When the anchor is not on the page (none set, another page, not rendered, or hidden at this width), the step shows centred, pointing at nothing. It is never skipped, so "3 of 6" stays stable.
- A recorded step past the end of a guide set shorter since reads as its last step. Setting a guide again keeps each session's progress.

Why: a hosting service needs to walk its viewers (the hosted demo) or operators through the console. One generic feature, drawn with the console's own components, serves it without hosting or demo code in the open package, and without outside code running in the console. Progress lives on the server because the console keeps nothing in browser storage.

Rejected: a script the installation injects to draw the tour (outside code in a session); progress in browser storage or the URL; skipping a step whose anchor is missing (the count would shift).
