# Crew settings: a request's MCP servers

Design, mockups for approval. Docs only. [Issue 1653](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1653). Nothing is built until Thomas approves the before and after below; once approved, they are the acceptance criteria.

## 1. Purpose

The console shows and edits the MCP servers a crew request names, the `mcpServers` field of the crew settings ([#1649](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1649); aeolus-fleet-trierarch's [crew-mcp-servers.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/design/crew-mcp-servers.md), M3).

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | `mcpServers` is a list of names, each defined once on the trierarch plugin's server list; never a definition or a path | decision 0027; crew-mcp-servers.md M2, M3 |
| L2 | A machine that cannot give every named server does not fit: placement leaves it out, and the request waits on Needs crew with the reason | crew-mcp-servers.md M4; slice 4 |
| L3 | Each trierarch reports, per harness, which servers it offers (slice 3), as it reports repositories, folders and options. The form builds each field from what the answering machines offer | `lib/crew-settings-form.ts`, `offersOf` |
| L4 | Machine labels are the nearest field: chips with ×, Add label, a line on where the plugin places the ship | `components/molecules/machine-labels-field.tsx` |
| L5 | A session reaches only the tools the server list names, read-only, through its trierarch's proxy | crew-mcp-servers.md M6, M7 |
| L6 | Three forms share the crew settings: the commission dialog and the request crew dialog (`CrewSettingsFields`), and each member of the form squadron dialog (`MemberCrewSection`); the crew request card reads them back as a grid | console |

### Today

No MCP servers anywhere.

| Part | 1440 light | 1440 dark | 375 light | 375 dark |
| --- | --- | --- | --- | --- |
| Commission | ![](today-commission-1440-light.png) | ![](today-commission-1440-dark.png) | ![](today-commission-375-light.png) | ![](today-commission-375-dark.png) |
| Request crew (Edit) | ![](today-request-crew-1440-light.png) | ![](today-request-crew-1440-dark.png) | ![](today-request-crew-375-light.png) | ![](today-request-crew-375-dark.png) |
| Form squadron, members | ![](today-squadron-1440-light.png) | ![](today-squadron-1440-dark.png) | ![](today-squadron-375-light.png) | ![](today-squadron-375-dark.png) |
| Crew request card | ![](today-card-1440-light.png) | ![](today-card-1440-dark.png) | ![](today-card-375-light.png) | ![](today-card-375-dark.png) |

## 3. After

Under Machine labels, the other field that decides where the ship goes, **MCP servers** (optional): each server a mono chip with ×, then **Add server**; "None" when empty. Under it: "`<ship>`'s session starts with these servers' tools, read-only. The plugin places it only on a machine that offers every one." The crew request card shows **MCP servers** as a row of its grid, in mono, "None" when empty, as Squadron does.

| Part | 1440 light | 1440 dark | 375 light | 375 dark |
| --- | --- | --- | --- | --- |
| Commission | ![](after-commission-1440-light.png) | ![](after-commission-1440-dark.png) | ![](after-commission-375-light.png) | ![](after-commission-375-dark.png) |
| Request crew (Edit) | ![](after-request-crew-1440-light.png) | ![](after-request-crew-1440-dark.png) | ![](after-request-crew-375-light.png) | ![](after-request-crew-375-dark.png) |
| Form squadron, members | ![](after-squadron-1440-light.png) | ![](after-squadron-1440-dark.png) | ![](after-squadron-375-light.png) | ![](after-squadron-375-dark.png) |
| Crew request card | ![](after-card-1440-light.png) | ![](after-card-1440-dark.png) | ![](after-card-375-light.png) | ![](after-card-375-dark.png) |

Drawn with the console's own parts (CommissionDialog, RequestCrewDialog, FormSquadronDialog, CrewRequestCard, CrewSettingsFields, MemberCrewSection, the Button and chip of MachineLabelsField) and `@aeolus-fleet/ui`, rendered in the console's Storybook at 375 and 1440 wide, light and dark.

## 4. Questions for Thomas

### Q1. The control

1. **Chips with ×, then Add server (pick)**, as machine labels (L4). Compact when there are none, and the same look as the field above it.
2. **A checkbox per server the machines offer.** Every choice in sight, but the list grows with the server list, and the console has no Checkbox built yet.
3. None of these.

Pick: 1. One look for the two fields that decide placement.

### Q2. What Add server offers

1. **The servers the answering machines offer for the picked harness (pick)**, as workspaces and options are (L3). A server no machine offers cannot be picked, so the request cannot wait on it unseen.
2. **Every server on the trierarch plugin's list.** A server no machine offers yet can be picked; the request waits on Needs crew with the reason (L2).
3. None of these.

Pick: 1. The form already offers only what machines offer; a request that can never be placed should not be one click away.

### Q3. The card when a request names none

1. **The row says None (pick)**, as Squadron does: the card shows every setting the request can carry.
2. **No row.** A shorter card; the row shows only when the request names a server.
3. None of these.

Pick: 1. The grid reads the same for every request.
