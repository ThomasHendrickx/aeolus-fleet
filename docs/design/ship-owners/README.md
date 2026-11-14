# Commission: the person ship that owns the new ship

Approved by Thomas on 13 Nov with S1, S2 and S3 as picked; built in #1777. [Issue 1777](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1777), slice 1 of aeolus-fleet-trierarch's [permission-asks.md](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/docs/design/permission-asks.md), section "The core change" (O1 a): a commission from the console signed in as argo names its owner, a person ship, so a permission ask reaches a person and not argo (decisions 0045, 0057).

Every image is the console's own `CommissionDialog`, rendered in Storybook: before from `main`, after with an Owner field drawn into it from the console's `Combobox`. Each board holds every state of the dialog at one width and theme. Scope pickers are left out of every state: they do not change.

## What changes

```diff
 CommissionDialog
   Name
   Type
+  Owner              signed in as argo only: a person ship, the last pick preselected
+                     list: the fleet's active person ships; argo is not offered
+                     hint: who answers for the ship; with no person ship, commission one first
+                     nothing picked: Commission ship off
   Note (optional)
   Request a crew
```

Signed in as an account nothing changes: the account's person ship owns the ship (0045). A ship an agent ship commissions keeps its commissioner's owner (O2 a); no screen shows that.

## Boards

### 375 wide, light

| Before | After |
| --- | --- |
| ![Commission dialog before, 375 light](mockups/commission-before-375-light.png) | ![Commission dialog after, 375 light](mockups/commission-after-375-light.png) |

### 375 wide, dark

| Before | After |
| --- | --- |
| ![Commission dialog before, 375 dark](mockups/commission-before-375-dark.png) | ![Commission dialog after, 375 dark](mockups/commission-after-375-dark.png) |

### 1440 wide, light

| Before | After |
| --- | --- |
| ![Commission dialog before, 1440 light](mockups/commission-before-1440-light.png) | ![Commission dialog after, 1440 light](mockups/commission-after-1440-light.png) |

### 1440 wide, dark

| Before | After |
| --- | --- |
| ![Commission dialog before, 1440 dark](mockups/commission-before-1440-dark.png) | ![Commission dialog after, 1440 dark](mockups/commission-after-1440-dark.png) |

## Built

The after states as built, from `CommissionDialog`'s own stories (`Owner*` and `SignedInAsAccount`), which also run as tests. The Fleet access picker, left out of the mockups, shows unchanged.

| 375 | 1440 |
| --- | --- |
| ![Built, 375 light](screenshots/commission-built-375-light.png) | ![Built, 1440 light](screenshots/commission-built-1440-light.png) |
| ![Built, 375 dark](screenshots/commission-built-375-dark.png) | ![Built, 1440 dark](screenshots/commission-built-1440-dark.png) |

## Questions the issue does not settle

Each with this design's pick, approved with the mockups.

- **S1. No person ship in the fleet.** (a) The field says so and Commission ship stays off: commission the person's ship first. (b) The dialog falls back to argo as owner. **Pick (a)**: argo is the fail-safe, never a normal path (0057), and the issue offers argo nowhere here.
- **S2. Where the last pick comes from.** (a) The fleet: the owner argo named at its last commission, read with the person ships. (b) The browser's storage. **Pick (a)**: the same preselection on every browser, and the console keeps no browser storage.
- **S3. The squadron dialogs.** Forming a squadron or adding a member from the console asks the squadrons plugin, whose members get the forming ship's owner (0045). (a) Out of this slice: they stay as they are. (b) They name an owner too. **Pick (a)**: the issue names only the commission dialog; (b) would be its own issue.


# The Owner control on the ship page

For Thomas's approval before any code. Unblocks [issue 1778](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1778) (Permission asks 2/7): argo changes a ship's owner from the ship's page in the console, where today only the API's `fleet.setOwner` can (scope `fleet:owner`). Who may own a ship stays decision 0045: an active person's ship or argo.

The mockups are static, in the console's tokens and parts: [mockups/owner-control.html](mockups/owner-control.html) (open with `#light` or `#dark`), one screenshot per state below.

## What changes

```diff
 ShipHeader meta strip
   Location | Crewed since | Commissioned | Ship id
+  Owner              the owner's ship, linked to its page; "argo (you)" when argo owns it
+                     Change owner (ghost button) while the session holds fleet:owner and the ship is active
+                     a person ship: "Owns itself", no Change owner (Q2)
+                     no row for argo and the viewer: no ship owns them
   Statement
   Labels
+ ChangeOwnerDialog  form Dialog (phone: full-screen page), as RenameDialog
+                     title: Change the owner of <ship>
+                     Owner: Combobox of the fleet's active person ships, the current one checked, then "argo (you)"
+                     hint: the commission dialog's: who answers for the ship
+                     Change owner off until another owner is picked; "Changing owner" while it saves
+                     refused: InlineError "Couldn't change the owner", the fleet's words, "Nothing changed."
+                     done: closes, Toast "Owner changed: <owner> owns <ship> now.", the timeline adds "Owner changed by argo"
```

## States

### 1. The ship page today (before)

| 1440 | 375 |
| --- | --- |
| ![1. The ship page today (before), 1440 light](mockups/owner-control-1-before-today-1440-light.png) | ![1. The ship page today (before), 375 light](mockups/owner-control-1-before-today-375-light.png) |
| ![1. The ship page today (before), 1440 dark](mockups/owner-control-1-before-today-1440-dark.png) | ![1. The ship page today (before), 375 dark](mockups/owner-control-1-before-today-375-dark.png) |

### 2. The owner shown

| 1440 | 375 |
| --- | --- |
| ![2. The owner shown, 1440 light](mockups/owner-control-2-after-owner-shown-1440-light.png) | ![2. The owner shown, 375 light](mockups/owner-control-2-after-owner-shown-375-light.png) |
| ![2. The owner shown, 1440 dark](mockups/owner-control-2-after-owner-shown-1440-dark.png) | ![2. The owner shown, 375 dark](mockups/owner-control-2-after-owner-shown-375-dark.png) |

### 3. Changing it

| 1440 | 375 |
| --- | --- |
| ![3. Changing it, 1440 light](mockups/owner-control-3-after-changing-1440-light.png) | ![3. Changing it, 375 light](mockups/owner-control-3-after-changing-375-light.png) |
| ![3. Changing it, 1440 dark](mockups/owner-control-3-after-changing-1440-dark.png) | ![3. Changing it, 375 dark](mockups/owner-control-3-after-changing-375-dark.png) |

### 4. Saving: loading

| 1440 | 375 |
| --- | --- |
| ![4. Saving: loading, 1440 light](mockups/owner-control-4-after-saving-1440-light.png) | ![4. Saving: loading, 375 light](mockups/owner-control-4-after-saving-375-light.png) |
| ![4. Saving: loading, 1440 dark](mockups/owner-control-4-after-saving-1440-dark.png) | ![4. Saving: loading, 375 dark](mockups/owner-control-4-after-saving-375-dark.png) |

### 5. Saving: done

| 1440 | 375 |
| --- | --- |
| ![5. Saving: done, 1440 light](mockups/owner-control-5-after-done-1440-light.png) | ![5. Saving: done, 375 light](mockups/owner-control-5-after-done-375-light.png) |
| ![5. Saving: done, 1440 dark](mockups/owner-control-5-after-done-1440-dark.png) | ![5. Saving: done, 375 dark](mockups/owner-control-5-after-done-375-dark.png) |

### 6. Saving: refused, with the reason

| 1440 | 375 |
| --- | --- |
| ![6. Saving: refused, with the reason, 1440 light](mockups/owner-control-6-after-refused-1440-light.png) | ![6. Saving: refused, with the reason, 375 light](mockups/owner-control-6-after-refused-375-light.png) |
| ![6. Saving: refused, with the reason, 1440 dark](mockups/owner-control-6-after-refused-1440-dark.png) | ![6. Saving: refused, with the reason, 375 dark](mockups/owner-control-6-after-refused-375-dark.png) |

### 7. A ship argo cannot change

| 1440 | 375 |
| --- | --- |
| ![7. A ship argo cannot change, 1440 light](mockups/owner-control-7-after-cannot-change-1440-light.png) | ![7. A ship argo cannot change, 375 light](mockups/owner-control-7-after-cannot-change-375-light.png) |
| ![7. A ship argo cannot change, 1440 dark](mockups/owner-control-7-after-cannot-change-1440-dark.png) | ![7. A ship argo cannot change, 375 dark](mockups/owner-control-7-after-cannot-change-375-dark.png) |

## Questions the mockups do not settle

Each with this design's pick.

- **Q1. Where Change owner sits.** (a) In the Owner row, beside the owner, as Add label sits in the Labels row. (b) In the ship's action menu, as Rename. **Pick (a)**: the control sits with the fact it changes, and the menu stays as console-conventions lists it.
- **Q2. A person ship's owner.** A person ship owns itself (0045, 0052), yet `fleet.setOwner` does not refuse one. (a) "Owns itself", no Change owner. (b) Change owner as for any ship. **Pick (a)**: a person ship owning itself is the rule, and no need to change it has shown.
- **Q3. argo among the choices.** Thomas chose active person ships and argo. (a) argo last, after a separator, as "argo (you)" with "No person answers". (b) argo in the list like any person ship. **Pick (a)**: argo is the fallback, never a normal path (0057), so it stays offered but apart.
- **Q4. Confirming.** (a) The dialog is the confirm, as Rename. (b) A pick in a popover saves at once, as a label does. **Pick (a)**: the owner decides where questions, gates and trouble go, so the change is one deliberate press.
