# Plugin read failed ship page mockups

For Thomas's approval. The [agreed design](../../monitoring/plugin-read-failed.md#44-the-consoles-server-records-console) puts the recorded read fact on the plugin ship's page. The [P1 baseline](https://github.com/ThomasHendrickx/aeolus-fleet/pull/2089) already has the fact and the two timeline transitions.

Both pairs use the same fixture before and after. The failing fixture has a good read at 13:56, the start of the current run of failures at 14:02, and a later unusable answer at 14:06. The all-reads-good fixture shows a good read at 14:04 after a failure at 14:02 with no answer. The proposed page keeps the historical failure visible in a neutral section after recovery. The attention heading follows the current failure. This fixture can be read before the watch raises an alert and on a fleet without the watch.

| Recorded state | Viewport | Theme | Before P3 | Proposed P3 |
| --- | --- | --- | --- | --- |
| Reads failing | desktop | light | [Before](failing-desktop-light-before.png) | [After](failing-desktop-light-after.png) |
| Reads failing | desktop | dark | [Before](failing-desktop-dark-before.png) | [After](failing-desktop-dark-after.png) |
| Reads failing | phone | light | [Before](failing-phone-light-before.png) | [After](failing-phone-light-after.png) |
| Reads failing | phone | dark | [Before](failing-phone-dark-before.png) | [After](failing-phone-dark-after.png) |
| All reads good (after recovery) | desktop | light | [Before](good-desktop-light-before.png) | [After](good-desktop-light-after.png) |
| All reads good (after recovery) | desktop | dark | [Before](good-desktop-dark-before.png) | [After](good-desktop-dark-after.png) |
| All reads good (after recovery) | phone | light | [Before](good-phone-light-before.png) | [After](good-phone-light-after.png) |
| All reads good (after recovery) | phone | dark | [Before](good-phone-dark-before.png) | [After](good-phone-dark-after.png) |

Desktop is 1280 px wide and phone is 375 px wide. Labels ending in a question mark are proposed copy. The question marks are review marks.

## Questions for Thomas

1. Where should the read fact sit?
   - A. Immediately below the ship's metadata and above Permissions.
   - B. In the ship's metadata, as full-width rows.
   - **Pick A.** The three fields stay together and the current failure has a distinct heading. The open alert still has its own place above the metadata.
2. How should the three facts be labelled?
   - A. “Failing since”, “Last failed read”, “Last good read”.
   - B. “Since when it fails”, “Last failed read”, “Last good read”.
   - **Pick A.** It keeps the labels short on phone and follows the terms of the agreed design.
