# Fleet overview: purpose assessment

## Purpose to agree

Help Thomas find a ship worth contacting, or understand whether a known ship needs his attention, without making him supervise work through a fleet directory. Thomas is the only user today. This is a proposed purpose, not evidence that either job needs a dedicated Fleet overview.

The next decision is whether this page earns its cost. [Thomas's 11 November direction](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1741#issuecomment-6803549494) authorizes this assessment before further technical design. It leaves scope and milestones unchanged. No option below is an approved change to [#1741](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1741), and no detailed implementation decision follows until purpose is agreed.

## Lessons to check against

- Aeolus promises a fleet snapshot and durable communication, not execution tracking ([blueprint](../../blueprint.md)). A useful snapshot need not be this particular page.
- Sending and reading are separate rights; neither a directory nor a smaller alternative may disclose unauthorized descriptions or reports. The account reads and its person ship sends ([decisions 0047, 0057 and 0058](../../decisions/README.md)). Convenience cannot widen either actor's rights.
- Before 1.0, minimal work for the actual user is preferable to polish for hypothetical customers ([0013](../../decisions/0013-breaking-changes-before-1-0.md)). Removing a user job from the proposed page is a product choice for Thomas, not an engineering shortcut.
- A bounded page and green correctness checks do not prove the latency budget. [PR #1747's repeated core measurements](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1747#issuecomment-6774098799) put dense context p95 at 275.9–396.5 ms, approximately 276–397 ms, against below 100 ms; dense reports were 297.6–328.1 ms. Those are local shared-host core measurements, not finished app latency. The required integrated 3,000-ship/10,000,000-message proof remains absent.
- The [later prototype evidence](https://github.com/ThomasHendrickx/aeolus-fleet/blob/0cac9088860dc0bf3624e6a5fe9c9e4c22d68f78/artifacts/1741/990872691e3eb1a7873035a2188dcec39c93014b/README.md) records sparse blank p95 2,378.28 ms and repeated combined-workload timeouts. These failures show costs of tested approaches, not that the user job is impossible or that another structure is justified.

## User jobs: evidence versus assumptions

| Candidate job | Evidence | Assumption to test with Thomas |
| --- | --- | --- |
| Find someone to message when the ship name is unknown | #1741 requires searchable messageable ships and descriptions | Thomas repeatedly needs exploratory browsing rather than a known destination or existing conversation |
| Contact a known ship | Messageable discovery is explicitly required in #1741 | A dedicated overview helps more than choosing a recipient where the message is composed |
| Understand a ship's current situation before contacting it | #1741 requests independently authorized state, note and activity | These fields change Thomas's decision often enough to load them beside every destination |
| See relevant ships he can read but cannot message | #1741 specifies a separate readable-context section | This section leads to a useful action, rather than adding information without a next step |

The requirements prove previously requested behavior, not observed frequency or value. No usage study, task timing or account from another user is supplied here. Thomas is the sole current user; broader adoption and future fleet size are assumptions, not demand evidence. Ask for one recent concrete instance of the chosen job and the action the page should make easier.

## Smaller alternatives and costs

These are choices to discuss, not replacement contracts or budget waivers.

| Option | Value retained | Cost or value forgone |
| --- | --- | --- |
| Keep both overview sections with reports | Exploratory discovery and readable context together | Highest tested read/authorization cost; #1747 misses dense p95 by about 2.8–4.0 times. Further structural work carries writer, migration and proof costs; no measured successful replacement is established |
| Put destination finding at message composition | Find a recipient at the moment of sending | Loses a separate overview and passive context. Still needs authorized discovery; moving the UI alone does not make the read cheap. Dense discovery measured 19.5–76.9 ms in #1747, but integrated proof is still missing |
| Show destinations first; inspect reports for a selected ship | Find whom to contact, then obtain relevant context | Extra interaction and less comparative scanning. Avoids requiring reports on every list row, but selected report authorization and latency still need proof; no speedup is claimed |
| Use known destinations and existing conversations; defer browsing | Preserve established communication while learning whether unknown-ship discovery matters | Poor discovery for an unknown name; links can become unavailable and sends still need current rights. Lowest new feature effort, not a demonstrated equivalent experience |
| Defer the overview pending a concrete unmet job | Avoid further speculative design while retaining the issue and evidence | Delays the approved experience; Thomas must explicitly decide any scope or milestone consequence and what observation warrants reopening |
| Abandon a dedicated Fleet overview | Stop ongoing investment in this surface if other routes satisfy the jobs | Loses a single place for fleet browsing; existing snapshot promises still need an adequate route. Closing or changing #1741 requires Thomas's decision |

## Questions for Thomas

Answer question 1 first. Later questions are conditional product choices, not technical approvals. Every question includes a none-of-these choice so the proposed framing can be rejected.

1. **Which job should justify further Fleet overview work?** A: find an unfamiliar ship to contact. B: inspect known ships before acting. C: survey readable ships outside messaging reach. D: no demonstrated job yet, defer. E: none of these; describe the job. **Pick A**, if Thomas can give a recent instance: finding an unknown destination is the clearest distinct discovery job. Without such an instance, pick D before designing further.
2. **If discovery is the purpose, where is it needed?** A: a dedicated Fleet page. B: destination finding while composing a message. C: known destinations and conversations suffice for now. D: none of these. **Pick B**, because it puts discovery beside its resulting action and may remove a separate surface. This is conditional on question 1 and does not assume the existing composer supports it.
3. **What context is necessary to complete that job?** A: destination identity and authorized description. B: A plus a report when a ship is selected. C: reports on every destination plus separate readable context. D: none of these. **Pick B**, if pre-contact inspection matters: it keeps that job available with less mandatory list work. If Thomas never uses reports to decide, prefer A. Neither choice changes authorization or promises a latency result.
4. **How should the current cost affect investment?** A: retain both sections and authorize a later technical proposal after purpose agreement. B: narrow the experience, then reassess feasibility against unchanged budgets. C: defer until Thomas supplies an unmet task that existing routes cannot serve. D: abandon the dedicated overview and explicitly decide the issue's disposition. E: none of these. **Pick C now**, because user value is still assumed while tested costs are concrete; choose B if question 1 supplies a compelling job. Do not loosen the 100 ms budget or resume held prototypes by implication.
