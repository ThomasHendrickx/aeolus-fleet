# Commission a ship

Purpose and behaviour agreed. Screen mockups await approval. [#1245](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1245).

## Purpose

A person can commission a ship that sends and receives without studying the scope catalogue, understand what still prevents commission, and change what the ship may do from its page, including letting it open a meeting.

## Lessons to check against

- [0046](../../decisions/0046-scope-catalogue.md): scopes say what, reach says where; live changes use the actor's grant authority and manage reach.
- [Gateway scopes](../gateway-scopes/gateway-scopes.md): descriptions explain core, plugin and fleet scopes; type grants nothing.
- [Ship owners](../ship-owners/README.md): argo names a person ship; Owner can prevent commission too.
- [Conventions](../conventions.md): persistent help stays inline; use the existing form, controls and tokens.

## Decisions

[0075: Commission form and ship permissions](../../decisions/0075-commission-form-and-permissions.md).

## Screens for approval

1440 px, light and dark. Mockups redrawn from CommissionDialog and ShipHeader at `c46db4979`, using the shared tokens and fonts; these are not running UI screenshots. The current form has searchable scope pickers; the issue's audit shows the earlier switches. Crew settings below Repository are omitted from the drawings.

| Screen | Light before | Light after | Dark before | Dark after |
| --- | --- | --- | --- | --- |
| Commission form, first state | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/first-before-1440-light.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/first-after-1440-light.png) | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/first-before-1440-dark.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/first-after-1440-dark.png) |
| Extra permissions opened | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/extras-before-1440-light.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/extras-after-1440-light.png) | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/extras-before-1440-dark.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/extras-after-1440-dark.png) |
| Disabled button and reason | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/disabled-before-1440-light.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/disabled-after-1440-light.png) | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/disabled-before-1440-dark.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/disabled-after-1440-dark.png) |
| Ship permissions | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/ship-before-1440-light.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/ship-after-1440-light.png) | [before](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/ship-before-1440-dark.png) | [after](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/ship-after-1440-dark.png) |

Change permissions beside the held permissions: [light](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/ship-closed-after-1440-light.png), [dark](https://github.com/ThomasHendrickx/aeolus-fleet/blob/f51241c4444c9356f08e9eaaf58dea82c7f09de3/docs/design/commission-ship/mockups/ship-closed-after-1440-dark.png).
