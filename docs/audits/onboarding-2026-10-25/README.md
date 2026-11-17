# Onboarding audit, 25 Oct 2026

Issue #1228. Thomas: "Since our main advantage now against the competition we identified is our focus on connecting technical to non technical people on a company, user friendlynes to get into the fleet should be flawless".

Every first-time path into the fleet, walked on staging (core, gateway and trierarch plugin 0.31.0, pagasae at its staging head) as two people of one company:

- **Ada**, technical: signs up, makes the first fleet, reads the console, connects a computer, crews a ship from Claude Code and sends it a first message.
- **Bea**, a marketing colleague: gets in from Ada's invite, finds what waits for her, answers a ship, joins a meeting, from the gateway's pages and from a chat client through the gateway's MCP.

Then the hand-offs between them: adding Bea, a group with rights, company sign-in.

Screenshots are in [shots/](shots/), each at desktop (1280) and phone (390) width: `<step>-desktop.jpg` and `<step>-phone.jpg`. A phone screenshot wider than 390 px means the page scrolls sideways. Secrets are redacted.

## Ranked frictions

**Blocks**: the person cannot go on without help or an insider's guess. **Hurts**: they go on, but lose time, trust or something they need. **Rough**: wording, layout, small confusion.

| # | Rank | Who | Friction | Where | Screens |
|---|------|-----|----------|-------|---------|
| 1 | Blocks | Bea | A new fleet has no gateway, and nobody in the organisation can switch it on. Bea's Home says "You may use the gateway" with no link; the gateway's address silently sends her back to that Home. Only the app admin's per-fleet plugin switches turn it on (staging's defaults for new fleets: trierarch and networking plugins only). | account `/account`, gateway `/`, console Settings | [b02](shots/b02-after-welcome-phone.jpg), [b04](shots/b04-gateway-root-desktop.jpg), [h12](shots/h12-settings-no-gateway-desktop.jpg) |
| 2 | Blocks | Ada | Join a machine fails for the fleet's creator: "Couldn't join the machine. Adding a computer needs trierarch:join Nothing changed." Your rights says she holds `trierarch:join` as fleet manager. It works only after "Sign in as argo" in the account menu, which nothing points to. | console Trierarchs, account Your rights | [a21](shots/a21-setup-line-desktop.jpg), [a23](shots/a23-each-right-desktop.jpg), [a25](shots/a25-setup-line-as-argo-desktop.jpg) |
| 3 | Blocks | Ada | Nothing in the console says how to get the aeolus plugin that every crew line needs ("with the aeolus plugin"). The guide it would lead to, docs/guides/claude-code.md, says `/plugin marketplace add ThomasHendrickx/aeolus-fleet`; that repository has no marketplace. The README's `ThomasHendrickx/aeolus-fleet-trierarch` is the one that works. | starting prompt dialog, docs/guides/claude-code.md | [a29](shots/a29-commissioned-desktop.jpg) |
| 4 | Blocks | Ada | A setup line interrupted after its first step leaves the machine's ship crewed. Running it again on a fresh machine fails: "CONFLICT: ada-laptop is crewed: a session claims a ship only while it awaits crew". On the same machine: "This machine is set up already ... remove /root/.aeolus/trierarch/crew-token first". The only way out is Release on the ship's page, then a new prompt, and that prompt has no setup line (#8). | terminal, console ship page | [a40](shots/a40-machine-stuck-crewed-desktop.jpg), [a41](shots/a41-release-confirm-desktop.jpg) |
| 5 | Not a block (checked) | Bea | The gateway offers no dynamic client registration (`POST /register` 404), but ChatGPT does not need it: OpenAI's docs say ChatGPT uses its client metadata document (`https://chatgpt.com/oauth/client.json`) when the server advertises `client_id_metadata_document_supported`, which the gateway does, and the gateway takes that client id with ChatGPT's redirect to the sign-in choice. Unproven: ChatGPT's document prefers `private_key_jwt` at the token endpoint, which the gateway does not list (it lists `none`, which ChatGPT also supports). A client the gateway cannot read ends on "The gateway does not know this MCP client, or the address it asks to be sent back to. Start again from your MCP client." | gateway `/authorize` | [m03](shots/m03-authorize-failed-desktop.jpg), [m01](shots/m01-authorize-phone.jpg) |
| 6 | Hurts | Bea, Ada | Meeting notices show raw JSON with ids (`{"meetingId":"mtg_...","owner":{"id":"shp_...`), in Bea's gateway and in Ada's console inbox. Through MCP every answer is a JSON string with `dlv_`, `shp_`, `mtg_` ids and content types. | gateway item, console Inbox, gateway MCP | [b15](shots/b15-meeting-added-open-phone.jpg), [a44](shots/a44-argo-inbox-after-meeting-desktop.jpg) |
| 7 | Hurts | Bea | The gateway's Overview scrolls sideways on a phone as soon as something waits (a long first line does not wrap; 594 to 651 px wide in a 390 px screen). | gateway Overview, item | [b07](shots/b07-gateway-with-waiting-phone.jpg), [b11](shots/b11-back-without-answering-phone.jpg), [b22](shots/b22-overview-after-meeting-phone.jpg) |
| 8 | Hurts | Ada | The setup line is shown once. "If you lose it, get a new starting prompt on ada-laptop's ship page", but that page's prompt is the chat instructions and crew lines, with no setup line: the person rebuilds `npx @aeolus-fleet/trierarch init --fleet-url ... --ship-id ... --plugin-ship-id ... --secret ...` by hand, and the plugin ship id appears nowhere near. | console ship page | [a25](shots/a25-setup-line-as-argo-desktop.jpg), [a32](shots/a32-machine-new-prompt-desktop.jpg) |
| 9 | Hurts | Bea | The meeting page does not update: after the moderator gave Bea the mic, her page still said "You are number 1 in line" 30 s later, until she clicked "Read again". Through MCP, requesting the mic answers `{}`. | gateway meeting | [b17](shots/b17-mic-requested-desktop.jpg), [b18](shots/b18-mic-given-wait-desktop.jpg), [b19](shots/b19-mic-after-read-again-desktop.jpg) |
| 10 | Hurts | Bea | Bea's list fills with things that need no action: "You were added to a meeting", the meeting's own messages, "You hold the mic of a meeting" (still there after she released it). Each waits for "Answer or be done". | gateway Overview | [b22](shots/b22-overview-after-meeting-desktop.jpg) |
| 11 | Hurts | Bea | Email alerts are off by default: "Off: nothing tells you when something waits while you are away." A colleague who is not in the gateway all day never learns a ship asked her something. | gateway Overview | [b06](shots/b06-gateway-desktop.jpg) |
| 12 | Hurts | Ada | The machine's setup asks nine questions in a row in the terminal, with no count and no explanation: npx's install, `--dangerously-skip-permissions` (before anything says what the sessions are for), `--remote-control`, "Add a repository it may make worktrees of: its name, or nothing when done? ()", "Add a folder it may crew a ship in as it is", "How many ships may it keep on its list? (4)", "How many sessions may run at once? (2)", bypass-permissions mode, "Install the service". `?` answers only the format ("? is no name: lowercase letters, digits and hyphens."). | terminal | transcript below |
| 13 | Hurts | Ada | The setup never checks that Claude Code is installed or signed in. Without it, it says only "claude-code did not say its version, so its options stay as detected before" and goes on to install the service. Node 26 is required, but on Node 22 the only sign is npm's `EBADENGINE` warning. | terminal | transcript below |
| 14 | Hurts | Ada | Commissioning shows 17 permission switches by scope name ("It cannot be changed later"), and with "Request a crew" on by default the button stays disabled without a machine; the way out is a line at the bottom: "Uncheck Request a crew to get the starting prompt instead." A ship commissioned without "Open a meeting" can never get it from the console. | console Commission ship | [a26](shots/a26-commission-dialog-desktop.jpg), [a28](shots/a28-commission-disabled-desktop.jpg) |
| 15 | Hurts | Ada | Once, the dialog after Commission came back empty: "Starting prompt for" with no name, no prompt and no secret. The secret is shown once, so it was lost; Get starting prompt on the ship page issued a new one. | console Commission ship | [a43](shots/a43-commission-empty-prompt-desktop.jpg) |
| 16 | Hurts | Bea | The invite mail says "Northwind Onboarding added you to its organisation on Aeolus. Sign in with this email to see what you may do there." It does not say who invited her, what Aeolus is, or why; its link lasts 15 minutes. The welcome page after it does not name the organisation either. | invite mail (pagasae lib/emails), account `/welcome` | [b01](shots/b01-invite-link-phone.jpg) |
| 17 | Hurts | Ada | The first Open console after sign-up ended on "Can't reach the sign-in service. Nothing changed in the fleet. Try again in a moment." Try again worked. Once in two fresh sign-ups; staging's logs show nothing. | console `/sign-in/unreachable` | [a08](shots/a08-console-unreachable-desktop.jpg) |
| 18 | Hurts | Ada | Within a minute of joining a machine, the brand-new fleet shows "Stuck 1, Deliveries stuck" in red: the trierarch plugin's message to the machine waits while it is not yet crewed. | console Fleet overview, Health | [a28](shots/a28-commission-disabled-desktop.jpg) |
| 19 | Hurts | Ada | Company sign-in: Connect Entra ID and Connect Google Workspace are disabled with no reason beside them; the reason (make a fallback account first) is at the bottom of the page. | account Company sign-in | [h08](shots/h08-company-sign-in-desktop.jpg), [h09](shots/h09-ada-account-page-desktop.jpg) |
| 20 | Rough | Both | Help in the account menu opens the GitHub repository, for Bea too. | account menu | [b03](shots/b03-bea-account-menu-desktop.jpg) |
| 21 | Rough | Both | Words a newcomer has to guess, each used before it is explained: fleet, ship, commission, crew, crewed, awaiting crew, crew request, argo, operator, trierarch, squadron, kind, harness, worktree, starting prompt, delivery, mic, scope (`fleet:read` and 22 more), "Signed in as your account", "Outside parties" beside "Parties", "an outside party", "acts as its own party". | everywhere | [a09](shots/a09-try-again-desktop.jpg), [a22](shots/a22-your-rights-desktop.jpg), [b12](shots/b12-parties-desktop.jpg), [m01](shots/m01-authorize-phone.jpg) |
| 22 | Rough | Ada | The overview says "Only argo so far" above two ships, argo and ada; Ada's own person ship shows "Awaiting crew" and "Get starting prompt", and nothing says it is her and needs nothing. | console Fleet overview | [a09](shots/a09-try-again-desktop.jpg), [a46](shots/a46-ada-person-ship-desktop.jpg) |
| 23 | Rough | Ada | Settings says "Only argo, the operator, sees this page." while Ada sees it signed in as her account. | console Settings | [a15](shots/a15-settings-desktop.jpg) |
| 24 | Rough | Ada | "Create fleet" stays disabled until both names are filled, without saying which is missing. | account `/create` | [a06](shots/a06-create-disabled-desktop.jpg) |
| 25 | Rough | Bea | Times read "Sun, 25 Oct 2026 06:53:04 GMT" in the gateway, in GMT, not her time. | gateway item, meeting | [b08](shots/b08-question-open-desktop.jpg) |
| 26 | Rough | Ada | The fleet table cuts off its "Runs on" column at 1280 px. | console Fleet overview | [a09](shots/a09-try-again-desktop.jpg) |
| 27 | Rough | Ada | Release says "Nothing is in flight, so no delivery moves." while the ship's page shows a pending message from 22 minutes before. | console Release | [a40](shots/a40-machine-stuck-crewed-desktop.jpg), [a41](shots/a41-release-confirm-desktop.jpg) |
| 28 | Rough | Bea | Through MCP, `aeolus_ships` lists internal ships (trierarch-plugin, gateway, ada-laptop) with no statement, and `aeolus_ask_for_server` is offered while outside parties are off. The sign-in page shows "Client https://claude.ai/oauth/mcp-oauth-client-metadata, sent back to https://claude.ai/api/mcp/auth_callback." and two look-alike choices. | gateway MCP, `/authorize` | [m01](shots/m01-authorize-phone.jpg) |

## What was not walked

- **The site.** Staging has no marketing site; the walk starts at the account's sign-in page, which says nothing about what Aeolus is ([a01](shots/a01-account-root-phone.jpg)).
- **Production's defaults.** Friction 1 rests on staging's plugin defaults for new fleets. Whether production switches the gateway on for new fleets was not checked (no production walk).
- **Codex.** No Codex client on the walker's machine; its crew line was read, not used.
- **Entra and Google.** Both Connect buttons lead to the provider's own admin sign-in ([h10](shots/h10-connect-entra-desktop.jpg), [h11](shots/h11-connect-google-desktop.jpg)); no staging test tenant exists, so a colleague's company sign-in was not walked.
- **A real chat client.** The MCP path was walked as Claude's client does it (client metadata document, PKCE, Bea's browser for the sign-in page), not from claude.ai or ChatGPT themselves.
- **A real computer.** The setup line ran in a throwaway Node container: no systemd (the service step ended on `spawn systemctl ENOENT`), no Claude Code. What a laptop's trierarch does after setup was not seen.
- **Claude Code interactively.** The crew line ran in a headless Claude Code session: it crewed `helper`, received Ada's message and answered "helper is here." in about a minute. The plugin's install itself was not walked (it was installed already).

## A: Ada, technical

| Step | Screens | Had to know or guess | Words not understood | Waits | Dead ends |
|------|---------|----------------------|----------------------|-------|-----------|
| Sign up with an email | [a01](shots/a01-account-root-desktop.jpg), [a02](shots/a02-link-sent-desktop.jpg) | where to start (no site on staging) | | link mailed in about 2 s, with "Check your mail" | |
| Open the link, accept the terms | [a03](shots/a03-after-link-desktop.jpg), [a04](shots/a04-continue-without-accept-desktop.jpg), [a05](shots/a05-create-desktop.jpg) | | early access | | |
| Name the organisation and the fleet | [a06](shots/a06-create-disabled-desktop.jpg), [a07](shots/a07-fleet-ready-desktop.jpg) | what a fleet is, whether the fleet name is a slug (placeholder `mira-lab`) | fleet, ships, commission | 0.2 s | disabled button with no reason |
| Open the console | [a08](shots/a08-console-unreachable-desktop.jpg), [a09](shots/a09-try-again-desktop.jpg), [c01](shots/c01-first-console-open-desktop.jpg) | to try again | argo, operator, crewed, awaiting crew, crew request, kind, squadron | 3 s on the second sign-up | "Can't reach the sign-in service" once |
| Read the console | [a10](shots/a10-health-desktop.jpg) to [a15](shots/a15-settings-desktop.jpg), [a18](shots/a18-account-menu-desktop.jpg), [a19](shots/a19-app-switch-desktop.jpg) | which page to start from; nothing says "next: connect a computer" | trierarch, needs crew, built-in rules, reach, refusals, "Signed in as your account" | | |
| Connect the trierarch plugin | [a16](shots/a16-connect-trierarch-desktop.jpg), [a17](shots/a17-trierarchs-connected-desktop.jpg) | that a plugin must be connected before a machine can join | plugin ship, secret | | |
| Join a machine | [a20](shots/a20-join-machine-desktop.jpg), [a21](shots/a21-setup-line-desktop.jpg), [a22](shots/a22-your-rights-desktop.jpg), [a23](shots/a23-each-right-desktop.jpg) | to sign in as argo | trierarch:join | | refused for the fleet manager |
| Sign in as argo, join again | [a24](shots/a24-sign-in-as-argo-desktop.jpg), [a25](shots/a25-setup-line-as-argo-desktop.jpg) | that the setup line is the first block and the other three are not for a machine | crew line, harness, CLOUD | | |
| Run the setup line | transcript below | Node 26; what each question means | worktree, crew a ship in a folder, caps, remote control | each question waits silently | Node 22 warning only; an interrupted run locks the ship |
| Recover the machine | [a31](shots/a31-get-starting-prompt-confirm-desktop.jpg), [a32](shots/a32-machine-new-prompt-desktop.jpg), [a40](shots/a40-machine-stuck-crewed-desktop.jpg), [a41](shots/a41-release-confirm-desktop.jpg), [a42](shots/a42-released-desktop.jpg) | to Release, then rebuild the setup line | re-crew, release | "Issuing a starting prompt..." about 5 s | no setup line on reissue |
| Commission a ship | [a26](shots/a26-commission-dialog-desktop.jpg), [a28](shots/a28-commission-disabled-desktop.jpg), [a29](shots/a29-commissioned-desktop.jpg), [a30](shots/a30-helper-ship-page-desktop.jpg), [a43](shots/a43-commission-empty-prompt-desktop.jpg) | a type to invent, which of 17 switches, to uncheck Request a crew | type, fleet access, harness, workspace, machine labels | | disabled button; once an empty prompt dialog |
| Crew it from Claude Code | [a33](shots/a33-overview-helper-crewed-desktop.jpg) | how to install the plugin (not in the console; the guide's marketplace is wrong) | crew line | crewed within a minute | |
| Send a first message, read the reply | [a34](shots/a34-compose-desktop.jpg), [a35](shots/a35-compose-to-desktop.jpg), [a36](shots/a36-sent-desktop.jpg), [a37](shots/a37-inbox-reply-desktop.jpg), [a38](shots/a38-reply-open-desktop.jpg) | that Compose appears only when signed in as argo | "Any ship of a type" | the reply arrived in about a minute | |

## B: Bea, non-technical

| Step | Screens | Had to know or guess | Words not understood | Waits | Dead ends |
|------|---------|----------------------|----------------------|-------|-----------|
| Open the invite mail's link, accept the terms | [b01](shots/b01-invite-link-desktop.jpg) | what Aeolus is and who invited her | early access | link valid 15 minutes | |
| Home | [b02](shots/b02-after-welcome-phone.jpg), [b03](shots/b03-bea-account-menu-desktop.jpg) | what "the gateway" is and where it lives | fleet, gateway | | no link; Help goes to GitHub |
| Try the gateway's address | [b04](shots/b04-gateway-root-desktop.jpg) | the address itself | | | silently sent back to Home |
| Home after the gateway was switched on | [b05](shots/b05-home-gateway-on-desktop.jpg), [b06](shots/b06-gateway-desktop.jpg) | | connector, MCP, outside parties, parties | | |
| Answer a ship's question | [b07](shots/b07-gateway-with-waiting-phone.jpg), [b08](shots/b08-question-open-desktop.jpg), [b09](shots/b09-answered-desktop.jpg) | | "the pick of helper" | | page scrolls sideways on a phone |
| Read a message, leave it for later | [b10](shots/b10-message-open-desktop.jpg), [b11](shots/b11-back-without-answering-phone.jpg) | that `docs/launch-post.md in the website repository` is not something she can open | | | |
| Join a meeting | [b14](shots/b14-gateway-meeting-waiting-desktop.jpg), [b15](shots/b15-meeting-added-open-phone.jpg), [b16](shots/b16-meeting-page-desktop.jpg) | to press "Go to the meeting" above the JSON | mic, moderated, crewed, in the meeting | | raw JSON |
| Ask for the mic, speak, release | [b17](shots/b17-mic-requested-desktop.jpg), [b18](shots/b18-mic-given-wait-desktop.jpg), [b19](shots/b19-mic-after-read-again-desktop.jpg), [b20](shots/b20-contributed-desktop.jpg), [b21](shots/b21-mic-released-desktop.jpg), [b22](shots/b22-overview-after-meeting-desktop.jpg) | to press "Read again" to see the mic come | "the moderator gives it" | no sign the mic came | items left behind |
| Connect Claude to the gateway | [m01](shots/m01-authorize-desktop.jpg) | which of the two choices | MCP client, outside party, "acts as its own party" | one click | |
| Use it from the chat | (no screens: tool answers) | ids to pass from one tool to the next | ship, delivery, mic, person ship, network rules | | every answer is JSON |
| Connect an MCP client the gateway cannot read | [m03](shots/m03-authorize-failed-desktop.jpg) | | | | refused; ChatGPT's own client id is accepted (friction 5) |

The chat client sees 11 tools: `aeolus_inbox`, `aeolus_open`, `aeolus_answer`, `aeolus_done`, `aeolus_ships`, `aeolus_send`, `aeolus_meeting`, `aeolus_request_mic`, `aeolus_withdraw_mic_request`, `aeolus_release_mic`, `aeolus_ask_for_server`. `aeolus_send`'s description is over 700 characters and asks for "a new uuid".

## Hand-offs

| Step | Screens | Had to know or guess | Words not understood | Waits | Dead ends |
|------|---------|----------------------|----------------------|-------|-----------|
| Add Bea to the organisation | [h01](shots/h01-people-and-groups-desktop.jpg), [h02](shots/h02-account-added-desktop.jpg) | that this lives in the Account app, not the console | organisation admin | | "They have no rights in a fleet until a group or their own give them." |
| Make a group, add Bea, give it rights | [h03](shots/h03-group-made-desktop.jpg), [h04](shots/h04-group-page-desktop.jpg), [h05](shots/h05-group-bea-talk-desktop.jpg), [h06](shots/h06-rights-saved-desktop.jpg) | that "Talk with the fleet from Claude or ChatGPT" is the right for her | person ship, `messages:send` | | the right is given while the fleet has no gateway |
| See the fleet's health | [h07](shots/h07-fleets-and-health-desktop.jpg) | | plan in line | | |
| Company sign-in | [h08](shots/h08-company-sign-in-desktop.jpg), [h09](shots/h09-ada-account-page-desktop.jpg), [h10](shots/h10-connect-entra-desktop.jpg), [h11](shots/h11-connect-google-desktop.jpg) | to make a fallback account first | tenant, verified domains, fallback account | | disabled buttons without a reason beside them |
| Switch the gateway on (app admin, not a customer) and connect it (Ada as argo) | [h12](shots/h12-settings-no-gateway-desktop.jpg), [h13](shots/h13-settings-gateway-available-desktop.jpg), [h14](shots/h14-gateway-connected-desktop.jpg) | that the gateway must be connected; that only the app admin can switch it on | | | not possible for the organisation |

## The machine's setup line, as the terminal printed it

Node 26 container, answering y to every yes or no question and Enter to every other:

```
Need to install the following packages:
@aeolus-fleet/trierarch@0.31.1
Ok to proceed? (y) y
Claude Code
Launch Claude Code with --dangerously-skip-permissions? Its sessions then run every tool without asking. [y/N] y
Launch Claude Code with --remote-control, so you can follow each session from claude.ai? [y/N] y
Workspaces
Add a repository it may make worktrees of: its name, or nothing when done? ()
Add a folder it may crew a ship in as it is: its name, or nothing when done? ()
Caps
How many ships may it keep on its list? (4)
How many sessions may run at once? (2)
Claude Code asks once per user to accept bypass permissions mode. Accept it now (skipDangerousModePermissionPrompt in /root/.claude/settings.json)? [Y/n] y
claude-code did not say its version, so its options stay as detected before
The service
Install the service and start the trierarch now? It then starts again at every login. [Y/n] y
spawn systemctl ENOENT
```

On Node 22 the same line prints `npm warn EBADENGINE Unsupported engine ... required: { node: '>=26' }` and goes on. Interrupted at any question after the first, a second run says `CONFLICT: ada-laptop is crewed: a session claims a ship only while it awaits crew` on a fresh machine, or `This machine is set up already: the trierarch crews shp_... at https://fleet.aeolus-staging.dev. init never registers again: to register another ship, remove /root/.aeolus/trierarch/crew-token first` on the same one.
