# Computer setup

## Purpose

A person running the setup line to join a computer to their fleet meets unexplained questions before knowing what will run on it. Setup should first explain that the trierarch runs agent sessions to crew ships on this computer, then ask only for choices it cannot reasonably make for the person. Each question explains its consequence and default, says how far through setup they are, and offers help, so they can finish without guessing what they have allowed.

Purpose approved by Thomas. The setup choices below are approved; progress and help remain proposed for [#1243](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1243).

## Lessons to check against

- [0050](../../decisions/0050-domain-language.md), [blueprint](../../blueprint.md): computer, trierarch, ship, session, repository and folder each mean one thing. Explain the concrete part before asking about it.
- [0026](../../decisions/README.md), [0049](../../decisions/0049-release-trains.md): the trierarch runs on the computer; the trierarch plugin brings it into the fleet. Their setup and the console are separate parts in separate repositories.
- [0027](../../decisions/0027-crew-settings.md), [ship repositories](../ship-repositories/README.md): a repository gets a new worktree per ship; a folder is used as it is. Explain that difference before asking for either.
- [Headless design](../headless/headless.md), H3 and H20: Remote Control is dropped. Do not design around keeping that audited question.
- [One-line setup](../one-line-setup.md): defaults shorten setup; preparing and joining a computer is a separate job from starting a self-hosted fleet.
- [0016](../../decisions/0016-no-policy.md): explain permissions and consequences; propose any change to defaults explicitly.

## Approved choices

Explain and ask every applicable setup question, including repositories or folders, permission choices, installing the service, the ship limit and the simultaneous-session limit. Explain both limits and their existing defaults before asking for their values. Permission values remain a question for the detailed design.

## Open questions

1. **How should setup explain what remains and answer help?**
   - A: Introduce the parts of setup before it starts, mark progress through those parts, and explain each question's purpose, default and consequence beside it; `?` gives help for that question and asks it again.
   - B: Show a numbered list of every question and put explanations in a guide.
   - **Pick A:** applicable questions vary by computer, and help belongs where the person is waiting. The introduction also accounts for npm's package-install confirmation before the trierarch starts.
