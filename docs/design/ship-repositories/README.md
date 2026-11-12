# Crew settings: a ship's main repository and sub-repositories

Approved by Thomas on 12 Nov, as they are: these mockups are #1761's acceptance criteria. Docs only. [Issue 1761](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1761), part of [#1759](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1759); the workspace shape is [#1760](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1760), the design is aeolus-fleet-trierarch's [ship-folder.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/design/ship-folder.md) (point 3).

Every image is the console's own parts (`CrewSettingsFields` in `RequestCrewDialog`, `CrewRequestCard` in `ShipHeader`, `MachineDetail`, inside `ConsoleFrame` and `DetailPage`), rendered in Storybook: before from `main`, after with the change drawn into those parts. Each board holds every state of one screen at one width and theme.

## Boards

Before on the left, after on the right; each board holds every state of the screen.

### Crew settings fields

The request crew dialog; the commission dialog and each squadron member use the same fields.

#### 375 wide, light

| Before | After |
| --- | --- |
| ![Crew settings fields before, 375 light](mockups/settings-before-375-light.png) | ![Crew settings fields after, 375 light](mockups/settings-after-375-light.png) |

#### 375 wide, dark

| Before | After |
| --- | --- |
| ![Crew settings fields before, 375 dark](mockups/settings-before-375-dark.png) | ![Crew settings fields after, 375 dark](mockups/settings-after-375-dark.png) |

#### 1440 wide, light

| Before | After |
| --- | --- |
| ![Crew settings fields before, 1440 light](mockups/settings-before-1440-light.png) | ![Crew settings fields after, 1440 light](mockups/settings-after-1440-light.png) |

#### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Crew settings fields before, 1440 dark](mockups/settings-before-1440-dark.png) | ![Crew settings fields after, 1440 dark](mockups/settings-after-1440-dark.png) |

#### 1920 wide, light

| Before | After |
| --- | --- |
| ![Crew settings fields before, 1920 light](mockups/settings-before-1920-light.png) | ![Crew settings fields after, 1920 light](mockups/settings-after-1920-light.png) |

#### 1920 wide, dark

| Before | After |
| --- | --- |
| ![Crew settings fields before, 1920 dark](mockups/settings-before-1920-dark.png) | ![Crew settings fields after, 1920 dark](mockups/settings-after-1920-dark.png) |

### Ship page

The crew request card.

#### 375 wide, light

| Before | After |
| --- | --- |
| ![Ship page before, 375 light](mockups/ship-before-375-light.png) | ![Ship page after, 375 light](mockups/ship-after-375-light.png) |

#### 375 wide, dark

| Before | After |
| --- | --- |
| ![Ship page before, 375 dark](mockups/ship-before-375-dark.png) | ![Ship page after, 375 dark](mockups/ship-after-375-dark.png) |

#### 1440 wide, light

| Before | After |
| --- | --- |
| ![Ship page before, 1440 light](mockups/ship-before-1440-light.png) | ![Ship page after, 1440 light](mockups/ship-after-1440-light.png) |

#### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Ship page before, 1440 dark](mockups/ship-before-1440-dark.png) | ![Ship page after, 1440 dark](mockups/ship-after-1440-dark.png) |

#### 1920 wide, light

| Before | After |
| --- | --- |
| ![Ship page before, 1920 light](mockups/ship-before-1920-light.png) | ![Ship page after, 1920 light](mockups/ship-after-1920-light.png) |

#### 1920 wide, dark

| Before | After |
| --- | --- |
| ![Ship page before, 1920 dark](mockups/ship-before-1920-dark.png) | ![Ship page after, 1920 dark](mockups/ship-after-1920-dark.png) |

### Trierarch page

Running here.

#### 375 wide, light

| Before | After |
| --- | --- |
| ![Trierarch page before, 375 light](mockups/trierarch-before-375-light.png) | ![Trierarch page after, 375 light](mockups/trierarch-after-375-light.png) |

#### 375 wide, dark

| Before | After |
| --- | --- |
| ![Trierarch page before, 375 dark](mockups/trierarch-before-375-dark.png) | ![Trierarch page after, 375 dark](mockups/trierarch-after-375-dark.png) |

#### 1440 wide, light

| Before | After |
| --- | --- |
| ![Trierarch page before, 1440 light](mockups/trierarch-before-1440-light.png) | ![Trierarch page after, 1440 light](mockups/trierarch-after-1440-light.png) |

#### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Trierarch page before, 1440 dark](mockups/trierarch-before-1440-dark.png) | ![Trierarch page after, 1440 dark](mockups/trierarch-after-1440-dark.png) |

#### 1920 wide, light

| Before | After |
| --- | --- |
| ![Trierarch page before, 1920 light](mockups/trierarch-before-1920-light.png) | ![Trierarch page after, 1920 light](mockups/trierarch-after-1920-light.png) |

#### 1920 wide, dark

| Before | After |
| --- | --- |
| ![Trierarch page before, 1920 dark](mockups/trierarch-before-1920-dark.png) | ![Trierarch page after, 1920 dark](mockups/trierarch-after-1920-dark.png) |

The dialog is the same size at 1440 and 1920, so those boards show it cropped; on phone it fills the screen. On the phone page boards the bottom navigation sits where the viewport ended, as it is fixed to the screen.

## What changes

### Crew settings fields

- **Workspace** offers each repository as `<repository> · main repository` (today `· new worktree`) and each folder as `<folder> · folder, as it is`, unchanged.
- **Branch** (optional) beside Workspace when a repository is picked, empty for its default branch ("Default branch" placeholder); below it on phone. A folder has none.
- **Sub-repositories** (optional) under it, only for a repository: "None" when empty; each one a row with its name in mono, its own Branch field and × to remove; then **Add sub-repository**, a menu of what the answering machines offer for the harness, less the main repository and those added. Once every offered one is added it stays, off, with a tooltip, as Add server does. Hint: each is a new git worktree beside the main repository, and the plugin places the ship only on a machine that offers every repository.
- **A repository no machine offers** (held settings, such as after a machine stopped offering it): its row, or Workspace, says so under it in the field error; Save is off and the footer names it.
- **A duplicate** (Workspace changed to a repository already a sub-repository): the row says it is the main repository; Save is off and the footer says a repository is named twice.
- **Loading** unchanged; **Saving** disables every field and hides each ×; **refused** keeps today's banner and footer, with the plugin's reason under the row of the repository it names.

### Ship page

The crew request card's Workspace row becomes **Main repository**, a mono chip with its branch after a dot when it has one, and **Sub-repositories**, a full-width row of the same chips, "None" when empty. A folder workspace keeps its Workspace row. A request naming a repository no machine offers waits on Needs crew with the plugin's reason, as today. A viewer sees the same rows without Edit.

### Trierarch page

Each ship under Running here reads `<main> · main repository`, then `· sub-repository <name>` or `· sub-repositories <a>, <b>, <c>`, wrapping on phone; a folder reads as today. The rest of the page is unchanged.

## Choices the issues do not settle

Each is this design's pick, approved with the mockups.

1. **The ref is labelled Branch**, empty for the default branch, as the task names it; `ref` stays the field's name in the settings.
2. **Workspace stays one select** for repositories and folders, the picked repository being the main one; Sub-repositories and Branch show only for a repository (ship-folder.md Q3: a folder has none).
3. **Sub-repositories are rows, not chips**, since each carries its own Branch; the Add control and its "every one added" state follow Add server.
4. **Add sub-repository offers only what machines offer** (crew-mcp-servers Q2), so a repository no machine offers reaches the form only from held settings.
5. **A repository no machine offers turns Save off**, since the plugin's check refuses it (placement point 4 of ship-folder.md); the form says so before the check answers.
6. **A duplicate is shown, never fixed silently**: picking a sub-repository as Workspace leaves it in the list with the error, and Save off until one is removed.
7. **The ship page shows branches, the trierarch page only names**: the trierarch page's line stays one line of names; the card is where the settings are read whole.
8. **The main repository on the card is a chip on its own row** like the sub-repositories, so a long name with a branch never wraps inside a grid cell.
9. **The machine's Workspaces section keeps "Repositories · a new worktree per ship"**: still true, as each repository a ship names is its own worktree.
