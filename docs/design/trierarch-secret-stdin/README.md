# Trierarch setup line: secret on stdin

Approved mockups for [aeolus-fleet-trierarch #269](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/issues/269), following the owner’s decision on card 684abbe4, option 1. The console displays and copies the plugin’s setup line unchanged; its dialog stories cover the approved line and copy feedback.

The line passes the ship secret to install.sh on stdin with `--secret-stdin`. Bash reads the script through process substitution, leaving stdin for the secret. A here-string supplies the secret without putting it in a process argument. The installer must pass it onward to `aeolus-trierarch init --secret-stdin` on stdin too. The old `--secret` option is removed, as permitted by decision 0013.

The proposed installer line runs in Bash. Existing setup options stay before the redirection. These boards use only the repository’s fake example credential. Surrounding copy stays as it is: it already explains setup, the once-only secret and how to recover a lost line. The line still carries the secret and must be treated accordingly.

## Places

An exhaustive `setupLine` / `SetupLine` search under `packages/console` finds two display sites, both on Trierarchs:

- **Join machine, joined result**: `JoinMachineDialog` renders `SetupLineBlock`. Shown with choices left for the machine and with all choices supplied in the console.
- **Get new setup line, result**: `NewSetupLineDialog` renders the same `SetupLineBlock`. Its preceding confirmation does not display a setup line.

The machine card and list only open the second dialog. State containers, plugin actions and schemas transport the line without displaying it. There are no other setup-line displays.

## Before and after

All renders use the real dialogs, shared setup block, CodeBlock and CopyButton in Storybook. Only the setup-line prop changes. No HTML reconstruction or image editing.

### Join machine: choices on the machine

| 375, light: before | After |
| --- | --- |
| ![Before](mockups/join-before-375-light.png) | ![After](mockups/join-after-375-light.png) |

| 375, dark: before | After |
| --- | --- |
| ![Before](mockups/join-before-375-dark.png) | ![After](mockups/join-after-375-dark.png) |

| 1440, light: before | After |
| --- | --- |
| ![Before](mockups/join-before-1440-light.png) | ![After](mockups/join-after-1440-light.png) |

| 1440, dark: before | After |
| --- | --- |
| ![Before](mockups/join-before-1440-dark.png) | ![After](mockups/join-after-1440-dark.png) |

| 1920, light: before | After |
| --- | --- |
| ![Before](mockups/join-before-1920-light.png) | ![After](mockups/join-after-1920-light.png) |

| 1920, dark: before | After |
| --- | --- |
| ![Before](mockups/join-before-1920-dark.png) | ![After](mockups/join-after-1920-dark.png) |

Copy feedback, after the line changes:

| Width and theme | Copied | Copy failed |
| --- | --- | --- |
| 375, light | [Copied](mockups/join-copied-375-light.png) | [Copy failed](mockups/join-copy-failed-375-light.png) |
| 375, dark | [Copied](mockups/join-copied-375-dark.png) | [Copy failed](mockups/join-copy-failed-375-dark.png) |
| 1440, light | [Copied](mockups/join-copied-1440-light.png) | [Copy failed](mockups/join-copy-failed-1440-light.png) |
| 1440, dark | [Copied](mockups/join-copied-1440-dark.png) | [Copy failed](mockups/join-copy-failed-1440-dark.png) |
| 1920, light | [Copied](mockups/join-copied-1920-light.png) | [Copy failed](mockups/join-copy-failed-1920-light.png) |
| 1920, dark | [Copied](mockups/join-copied-1920-dark.png) | [Copy failed](mockups/join-copy-failed-1920-dark.png) |

### Join machine: all choices supplied

| 375, light: before | After |
| --- | --- |
| ![Before](mockups/complete-before-375-light.png) | ![After](mockups/complete-after-375-light.png) |

| 375, dark: before | After |
| --- | --- |
| ![Before](mockups/complete-before-375-dark.png) | ![After](mockups/complete-after-375-dark.png) |

| 1440, light: before | After |
| --- | --- |
| ![Before](mockups/complete-before-1440-light.png) | ![After](mockups/complete-after-1440-light.png) |

| 1440, dark: before | After |
| --- | --- |
| ![Before](mockups/complete-before-1440-dark.png) | ![After](mockups/complete-after-1440-dark.png) |

| 1920, light: before | After |
| --- | --- |
| ![Before](mockups/complete-before-1920-light.png) | ![After](mockups/complete-after-1920-light.png) |

| 1920, dark: before | After |
| --- | --- |
| ![Before](mockups/complete-before-1920-dark.png) | ![After](mockups/complete-after-1920-dark.png) |

Copy feedback, after the line changes:

| Width and theme | Copied | Copy failed |
| --- | --- | --- |
| 375, light | [Copied](mockups/complete-copied-375-light.png) | [Copy failed](mockups/complete-copy-failed-375-light.png) |
| 375, dark | [Copied](mockups/complete-copied-375-dark.png) | [Copy failed](mockups/complete-copy-failed-375-dark.png) |
| 1440, light | [Copied](mockups/complete-copied-1440-light.png) | [Copy failed](mockups/complete-copy-failed-1440-light.png) |
| 1440, dark | [Copied](mockups/complete-copied-1440-dark.png) | [Copy failed](mockups/complete-copy-failed-1440-dark.png) |
| 1920, light | [Copied](mockups/complete-copied-1920-light.png) | [Copy failed](mockups/complete-copy-failed-1920-light.png) |
| 1920, dark | [Copied](mockups/complete-copied-1920-dark.png) | [Copy failed](mockups/complete-copy-failed-1920-dark.png) |

### Get new setup line: result

| 375, light: before | After |
| --- | --- |
| ![Before](mockups/renew-before-375-light.png) | ![After](mockups/renew-after-375-light.png) |

| 375, dark: before | After |
| --- | --- |
| ![Before](mockups/renew-before-375-dark.png) | ![After](mockups/renew-after-375-dark.png) |

| 1440, light: before | After |
| --- | --- |
| ![Before](mockups/renew-before-1440-light.png) | ![After](mockups/renew-after-1440-light.png) |

| 1440, dark: before | After |
| --- | --- |
| ![Before](mockups/renew-before-1440-dark.png) | ![After](mockups/renew-after-1440-dark.png) |

| 1920, light: before | After |
| --- | --- |
| ![Before](mockups/renew-before-1920-light.png) | ![After](mockups/renew-after-1920-light.png) |

| 1920, dark: before | After |
| --- | --- |
| ![Before](mockups/renew-before-1920-dark.png) | ![After](mockups/renew-after-1920-dark.png) |

Copy feedback, after the line changes:

| Width and theme | Copied | Copy failed |
| --- | --- | --- |
| 375, light | [Copied](mockups/renew-copied-375-light.png) | [Copy failed](mockups/renew-copy-failed-375-light.png) |
| 375, dark | [Copied](mockups/renew-copied-375-dark.png) | [Copy failed](mockups/renew-copy-failed-375-dark.png) |
| 1440, light | [Copied](mockups/renew-copied-1440-light.png) | [Copy failed](mockups/renew-copy-failed-1440-light.png) |
| 1440, dark | [Copied](mockups/renew-copied-1440-dark.png) | [Copy failed](mockups/renew-copy-failed-1440-dark.png) |
| 1920, light | [Copied](mockups/renew-copied-1920-light.png) | [Copy failed](mockups/renew-copy-failed-1920-light.png) |
| 1920, dark | [Copied](mockups/renew-copied-1920-dark.png) | [Copy failed](mockups/renew-copy-failed-1920-dark.png) |

## Reproduce

From the repository root, after `npm ci --ignore-scripts`:

```sh
cp docs/design/trierarch-secret-stdin/preview.jsx packages/console/features/trierarchs/ui/organisms/secret-stdin.stories.tsx
npm run storybook --workspace @aeolus-fleet/console -- --port 6029 --ci
```

In another terminal run `node docs/design/trierarch-secret-stdin/capture.js`. Remove the temporary story after capture. The JSX harness is documentation only and is not part of the console build.

The capture checks each dialog at 375, 1440 and 1920 in light and dark: rendered line, exact clipboard contents, visible Copied feedback, and visible clipboard-failure guidance. These checks do not execute installation or prove the future installer’s stdin implementation.
