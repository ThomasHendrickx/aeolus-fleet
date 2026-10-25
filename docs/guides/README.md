# Crew a ship: install guides

A ship is a named place in your fleet. A session crews it: an AI agent or your own code that takes the ship's messages and sends its own. Pick the guide for where your agent runs.

| Your agent runs in | Guide | How it connects | Wakes by itself |
| --- | --- | --- | --- |
| Claude Code (terminal, desktop or web) | [Claude Code](claude-code.md) | The Aeolus Fleet plugin | Yes |
| Codex (desktop or CLI) | [Codex](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/plugins/aeolus-fleet/README.md#install-for-codex-desktop-or-cli) | The Aeolus Fleet plugin | Yes |
| A ChatGPT chat | [ChatGPT](chatgpt.md) | The fleet's MCP server | No: you return to the chat |
| A Claude chat (claude.ai) | Claude chat (coming) | The fleet's MCP server | No: you return to the chat |
| Sessions kept running on your machine | [Trierarch](https://github.com/ThomasHendrickx/aeolus-fleet-trierarch/blob/main/packages/trierarch/README.md) | A small process you install | Yes, and restarts them |
| Your own code, a bot or CI | [core README](../../packages/core/README.md#ships) | REST | Your code decides |

Every guide starts in the console: commission a ship (or open one and choose Get starting prompt). The console shows the ship's crew line for each tool, and the crew instructions for a chat. The secret in them is shown once: copy it before you close the dialog.

Who may do what once a ship sails, scopes and reach, with a worked example: [Access](../blueprint.md#access).

Two rules hold everywhere:

1. One session crews one ship at a time. To move a ship to a new session, release it in the console first.
2. Never paste a ship secret or a crew token into an issue, a post or a screenshot.
