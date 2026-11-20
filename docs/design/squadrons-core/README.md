# Core for squadrons starting one ship

## Purpose proposed to Thomas

For a requesting ship, whether a person ship, agent or app, and for squadrons acting on its request, core supplies what is missing to start one named ship from a template: the resulting ship can belong to the ship that asked for it; squadrons can distinguish a confirmation from the current crew from one sent by a crew whose lease ended; and squadrons can manage the ships it forms directly through its owned labels and declared rules.

The job is to make the approved squadrons experience possible through core's public ship contract, with ownership, scopes, reach and leases enforced by core. The requesting ship is the owner, rather than its owner or the template owner.

This is not template interpretation, forming or leading a squadron, deciding a template count, assigning a computer, delivering business work, or deciding whether work started. Those jobs stay with their existing parts. It is not fleet-wide manage reach for squadrons, a new human approval process, or a change to the separate account identity and reader-reach design in #1771.

## Lessons to check against

Stage 1 for [#1982](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1982). The purpose awaits Thomas's agreement. Each pick below is a proposal for a separate card after that agreement, not a detailed decision or implementation approval.

1. **Keep the approved owner.** Thomas's words in #1982 are: "The ship who asked for it. The spirit of the option I picked is correct, the wording is not. Reason is that an agent or an app can also do this, not only persons". [Squadrons PR #61](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/pull/61) records that correction and ordered instruction hand-over; [PR #62](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/pull/62) keeps the ship owner separate from the appointed person ship that owns the template and decides its count. These approvals do not approve the missing core contracts.
2. **Ownership has consequences beyond commission.** [0045](../../decisions/0045-owners.md) currently permits person ships or argo as owners and copies the asking ship's owner. [0057](../../decisions/0057-actors.md) repeats that boundary. [0034](../../decisions/0034-network-rules.md) gives the owner direct reach for every verb, and [0038](../../decisions/0038-questions.md) sends questions to that owner. General ownership therefore needs explicit answers about reach, questions, retirement and cycles, while retaining a human's responsibility.
3. **Owner and scope authority are separate.** [0046](../../decisions/0046-scope-catalogue.md) checks grants against the asking ship or a recorded commission approval; neither makes an agent or app the owner today. [On-behalf scopes](../on-behalf-scopes/on-behalf-scopes.md) already trusts the authorised commissioner to name the actual requester, not a payload's asserted rights. Changing ownership must not silently change grant authority or widen on-behalf calls to manage.
4. **A confirmation must identify its crew.** [0010](../../decisions/0010-leases-without-heartbeats.md) and [0015](../../decisions/0015-ship-identity-per-conversation.md) end a crew's authority with its lease; a ship survives its crew. In the [#444 incident](https://github.com/ThomasHendrickx/aeolus-fleet/issues/444), a resumed old crew interfered with a replacement crew's valid identity. A confirmation accepted before release can also arrive after replacement. Checking the sender ship alone is insufficient; no secret or crew token may become proof passed to another ship.
5. **Receipt is not taking up instructions.** [0001](../../decisions/0001-ack-on-receipt.md) makes acknowledgement receipt only. In [#1318](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1318), a wake was reported without message content while the lease stayed valid; the cause was unresolved in that report. Neither crewed status nor a delivery acknowledgement proves that the current crew took up the charter. Squadrons owns that confirmation and the order before work, as approved in PR #61.
6. **Manage reach must hold when the fleet has its own rules.** [#872](https://github.com/ThomasHendrickx/aeolus-fleet/issues/872) identified plugins being able to release or retire any ship; its resolution requires manage reach on every target. [0017](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/blob/main/docs/decisions/0017-squadrons-package.md), [0031](../../decisions/0031-labels.md) and [0037](../../decisions/0037-declared-network-rules.md) already provide owned labels and visible declared rules. PR #61 approves extending that scheme to directly formed ships, restricted to ships squadrons forms. A direct ship is not a squadron member; labels select reach, not membership.
7. **Walk the owner's actual job.** The [#1608 onboarding walk finding](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1608) showed a person could commission a ship but could not get its starting prompt again. Thomas chose the ordinary scope and manage-reach check. A future walk must cover managing the resulting ship after commission and replacement of its crew, rather than stopping at a successful commission. This document reports no completed walk.
8. **Keep public contracts and evidence honest.** [Compatibility](../../compatibility.md) lists squadrons' calls and version requirements; none currently promises the missing ownership or current-crew proof. Core and common must publish the approved contracts before squadrons raises its minimum to their actual release. [0013](../../decisions/0013-breaking-changes-before-1-0.md) requires no compatibility layer. [Squadrons #57](https://github.com/ThomasHendrickx/aeolus-fleet-squadrons/issues/57) requires walking the exact candidate released. The later read design must hold at 3,000 ships and 10 million messages per fleet, targeting p95 below 100 ms, p99 below 500 ms and errors below 1%, without scanning history to find a current crew.

## Questions after the purpose is agreed

### 1. How should commission express requesting-ship ownership?

- **Option 1:** Allow the authorised commissioner to choose the requesting ship itself as owner, alongside the existing choice of its owner.
- **Option 2:** Change every on-behalf commission to make the requesting ship itself the owner.
- **Pick: 1.** It expresses Thomas's approved outcome for a person ship, agent or app without silently changing every other commission. Ownership remains separate from scope authority; exact inputs wait for detailed design. Sources: 0045, 0046 and PR #61.

### 2. Should the owner's built-in reach extend through other owners?

- **Option 1:** Keep it direct: an owner reaches ships it owns. Reaching ships those ships own requires the ordinary rules.
- **Option 2:** Give each owner the same built-in reach through every further owner.
- **Pick: 1.** It retains 0034's visible, direct relationship and avoids an ownership change silently expanding reach across a chain. Human responsibility does not itself grant additional reach. Sources: 0034 and 0045.

### 3. Where should questions go when an agent or app owns the ship?

- **Option 1:** To the immediate owner's ship. That ship brings a question needing a human to its own owner.
- **Option 2:** Core follows owners until it finds a person ship or argo and sends the question there.
- **Pick: 1.** The requesting ship can coordinate what it owns; the owner remains responsible for seeking a human's decision. Core does not interpret the question or introduce routing through ownership chains. Sources: 0038, 0045 and the blueprint's ship-agnostic purpose.

### 4. What happens to a ship when its agent or app owner retires?

- **Option 1:** Keep 0045's fallback: the owned ship falls to argo, with OwnerChanged.
- **Option 2:** Give it to the retiring owner's owner.
- **Pick: 1.** It preserves the visible recovery path without assuming another ship accepts ownership. Retirement is a failure made visible here, not the ordinary path for questions. Sources: 0045, 0057 and the blueprint's Retire a ship flow.

### 5. May ownership form a cycle involving agents or apps?

- **Option 1:** Refuse an ownership change or commission that would form such a cycle; person ships still own themselves.
- **Option 2:** Allow cycles and leave any resulting question-routing failure to the ships.
- **Pick: 1.** It keeps the path of responsibility capable of reaching a human instead of circling between ships. This would be an explicit addition to 0045 requiring Thomas's approval, not an assumed protective rule. Sources: 0045's human responsibility and 0016's no-policy principle.

### 6. What core evidence should establish which crew sent a confirmation?

- **Option 1:** Core records the authenticated sending lease with the message and exposes enough current-lease evidence for squadrons to compare them.
- **Option 2:** Core keeps a separate generic confirmation tied to a lease, which squadrons uses instead of an ordinary reply.
- **Pick: 1.** It uses the existing message hand-over and lease facts without adding confirmation state to core. Squadrons checks the intended ship, instructions and current crew; a delayed confirmation from an ended lease cannot satisfy that check. A current-lease observation is not a promise that the crew cannot change afterward. Exact checks and release races need detailed design. Sources: 0001, 0010, 0015 and PR #61.

### 7. Who may read another ship's current-crew evidence?

- **Option 1:** Actors holding fleet:read within that ship's read reach, through the ordinary public read contract.
- **Option 2:** Require a new scope specifically for reading current-crew evidence.
- **Pick: 1.** Squadrons already holds fleet:read; an ordinary read check keeps the generic fact within existing authority. It grants no right to act as the crew and exposes no credential. The later contract must preserve read filtering. Sources: 0034, 0046 and compatibility.

### 8. How should squadrons select directly formed ships for its declared manage rule?

- **Option 1:** Use a separate squadrons-owned label selecting its formed ships, including direct ships, alongside the existing squadron label.
- **Option 2:** Extend the existing squadron label's values to select direct ships as well.
- **Pick: 1.** It extends the approved owned-label scheme without making a direct ship appear to belong to a squadron. Squadrons labels only its own ship and ships it commissioned under 0031; its declared manage rule uses those owned selections under 0037. There is no grant over unrelated ships or hand-off destinations. Sources: 0017, 0031, 0037 and PR #61's approved manage-reach decision.

After the purpose and individual answers, detailed design must cover the full happy and unhappy flows, ownership changes and account cut-off, lease replacement races, replay and lost answers, rule withdrawal, the exact public contracts and compatibility, then thin implementation slices. This stage changes no recorded decision and authorises no implementation.
