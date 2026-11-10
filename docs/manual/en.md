# Flightdeck Manual

English | [Português (Brasil)](pt-BR.md) · [Back to the README](../../README.md)

Complete Flightdeck reference, organized by topic, one file per chapter. The roadmap is
in [`docs/SPEC.md`](../SPEC.md), the deviations from the specs in
[`docs/decisions/`](../decisions/) (the older ones listed in [`docs/DECISIONS.md`](../DECISIONS.md)) and the interface vocabulary in
[`docs/GLOSSARY.md`](../GLOSSARY.md). Those three documents, `docs/TDD.md` and the phase specs
are written in Portuguese.

UI labels follow the app's English dictionary. One exception: the section titles and some action
labels of the `Ctrl+K` palette are currently hard-coded in Portuguese in the app, and this manual
gives their English names (see [Palette Ctrl+K](en/daily-use.md#palette-ctrlk)). The daemon's own CLI messages
and `--help` text are in Portuguese too; messages quoted in this manual (for example "already
running") are translations. The manual assumes `flightdeckd` is on your `PATH`; the installed
binary lives in `~/.flightdeck/bin`, which the installer does not add to the `PATH`.

## Overview

[Read the chapter.](en/overview.md)

## Installation

[Read the chapter.](en/installation.md) Its sections:

- [From the release binaries](en/installation.md#from-the-release-binaries)
- [From source](en/installation.md#from-source)

## Hosts and daemon configuration

[Read the chapter.](en/hosts-and-daemon-configuration.md) Its sections:

- [The configuration file](en/hosts-and-daemon-configuration.md#the-configuration-file)
- [Starting the daemon](en/hosts-and-daemon-configuration.md#starting-the-daemon)
- [Connecting the desktop app](en/hosts-and-daemon-configuration.md#connecting-the-desktop-app)
- [Trusting a project](en/hosts-and-daemon-configuration.md#trusting-a-project)
- [Keeping the computer awake](en/hosts-and-daemon-configuration.md#keeping-the-computer-awake)
- [Sessions without permission prompts](en/hosts-and-daemon-configuration.md#sessions-without-permission-prompts)

## Service

[Read the chapter.](en/service.md) Its sections:

- [First run: flightdeckd setup](en/service.md#first-run-flightdeckd-setup)
- [Installing as a service](en/service.md#installing-as-a-service)
- [WSL from Windows](en/service.md#wsl-from-windows)

## Remote access over Tailscale

[Read the chapter.](en/remote-access-over-tailscale.md)

## Pairing

[Read the chapter.](en/pairing.md)

## Session hub and Claude Code hooks

[Read the chapter.](en/session-hub-and-claude-code-hooks.md) Its sections:

- [What the list shows](en/session-hub-and-claude-code-hooks.md#what-the-list-shows)
- [The message box](en/session-hub-and-claude-code-hooks.md#the-message-box)
- [Claude Code hooks](en/session-hub-and-claude-code-hooks.md#claude-code-hooks)
- [Approving terminal sessions from the app](en/session-hub-and-claude-code-hooks.md#approving-terminal-sessions-from-the-app)

## flightdeckd claude and the channel

[Read the chapter.](en/flightdeckd-claude-and-the-channel.md) Its sections:

- [How it works](en/flightdeckd-claude-and-the-channel.md#how-it-works)
- [Why the VS Code extension is left out](en/flightdeckd-claude-and-the-channel.md#why-the-vs-code-extension-is-left-out)

## Approvals and always allow

[Read the chapter.](en/approvals-and-always-allow.md)

## OpenCode sessions

[Read the chapter.](en/opencode-sessions.md) Its sections:

- [Turning it on](en/opencode-sessions.md#turning-it-on)
- [Starting one](en/opencode-sessions.md#starting-one)
- [What an OpenCode session asks](en/opencode-sessions.md#what-an-opencode-session-asks)
- [What an OpenCode session does not have yet](en/opencode-sessions.md#what-an-opencode-session-does-not-have-yet)
- [Why the project's own opencode.json is ignored](en/opencode-sessions.md#why-the-projects-own-opencodejson-is-ignored)
- [Removing saved rules](en/opencode-sessions.md#removing-saved-rules)
- [Checking a new OpenCode version](en/opencode-sessions.md#checking-a-new-opencode-version)

## Projects

[Read the chapter.](en/projects.md) Its sections:

- [Moving a session to another host (preview)](en/projects.md#moving-a-session-to-another-host-preview)
- [Sleeping idle sessions](en/projects.md#sleeping-idle-sessions)
- [Sessions side by side](en/projects.md#sessions-side-by-side)
- [The sidebar, the tab strip and Settings](en/projects.md#the-sidebar-the-tab-strip-and-settings)

## Board

[Read the chapter.](en/board.md) Its sections:

- [Working with many cards](en/board.md#working-with-many-cards)
- [Starting a session from the task](en/board.md#starting-a-session-from-the-task)
- [Choosing a folder](en/board.md#choosing-a-folder)
- [Registering a project](en/board.md#registering-a-project)
- [Finding projects](en/board.md#finding-projects)
- [Starting from GitHub](en/board.md#starting-from-github)
- [Board sync with GitHub Projects](en/board.md#board-sync-with-github-projects)
- [Card lifecycle](en/board.md#card-lifecycle)
- [PR providers](en/board.md#pr-providers)
- [Parallel run limit](en/board.md#parallel-run-limit)
- [Card dependencies](en/board.md#card-dependencies)

## Reviewing changes

[Read the chapter.](en/reviewing-changes.md) Its sections:

- [The views of a session page](en/reviewing-changes.md#the-views-of-a-session-page)
- [`.worktreeinclude`](en/reviewing-changes.md#worktreeinclude)
- [Claude Code statusline](en/reviewing-changes.md#claude-code-statusline)

## Run environment

[Read the chapter.](en/run-environment.md) Its sections:

- [The run.yaml](en/run-environment.md#the-runyaml)
- [Trust](en/run-environment.md#trust)
- [Ports](en/run-environment.md#ports)
- [Run and Stop](en/run-environment.md#run-and-stop)
- [Preview](en/run-environment.md#preview)

## Workflows

[Read the chapter.](en/workflows.md) Its sections:

- [Declaring](en/workflows.md#declaring)
- [Trusting](en/workflows.md#trusting)
- [Raising cards from an agent's findings](en/workflows.md#raising-cards-from-an-agents-findings)
- [Running a failed run again](en/workflows.md#running-a-failed-run-again)
- [Templates](en/workflows.md#templates)
- [Running and following](en/workflows.md#running-and-following)
- [Budget of a run](en/workflows.md#budget-of-a-run)
- [The flightdeckd mcp MCP server](en/workflows.md#the-flightdeckd-mcp-mcp-server)
- [The flightdeckd card command](en/workflows.md#the-flightdeckd-card-command)

## History

[Read the chapter.](en/history.md) Its sections:

- [What is indexed](en/history.md#what-is-indexed)
- [Excluding folders](en/history.md#excluding-folders)
- [Rebuilding the index](en/history.md#rebuilding-the-index)
- [In the app](en/history.md#in-the-app)

## Checkpoints and agent configuration

[Read the chapter.](en/checkpoints-and-agent-configuration.md) Its sections:

- [Snapshots](en/checkpoints-and-agent-configuration.md#snapshots)
- [The timeline](en/checkpoints-and-agent-configuration.md#the-timeline)
- [Rewinding files](en/checkpoints-and-agent-configuration.md#rewinding-files)
- [Forking](en/checkpoints-and-agent-configuration.md#forking)
- [The Agent screen](en/checkpoints-and-agent-configuration.md#the-agent-screen)

## Issues, automations and arena

[Read the chapter.](en/issues-automations-and-arena.md) Its sections:

- [Issues](en/issues-automations-and-arena.md#issues)
- [Automations](en/issues-automations-and-arena.md#automations)
- [Arena](en/issues-automations-and-arena.md#arena)

## Risk-graded approval

[Read the chapter.](en/risk-graded-approval.md)

## Background sessions

[Read the chapter.](en/background-sessions.md)

## Session trace and replay

[Read the chapter.](en/session-trace-and-replay.md)

## Session timing (telemetry)

[Read the chapter.](en/session-timing-telemetry.md)

## Connections

[Read the chapter.](en/connections.md)

## Vault

[Read the chapter.](en/vault.md) Its sections:

- [Backing up everything](en/vault.md#backing-up-everything)

## Actions: Claude uses a secret without seeing it

[Read the chapter.](en/actions-claude-uses-a-secret-without-seeing-it.md) Its sections:

- [The Actions screen](en/actions-claude-uses-a-secret-without-seeing-it.md#the-actions-screen)
- [Approving a request](en/actions-claude-uses-a-secret-without-seeing-it.md#approving-a-request)
- [Usage rules per secret](en/actions-claude-uses-a-secret-without-seeing-it.md#usage-rules-per-secret)
- [How Claude calls an action](en/actions-claude-uses-a-secret-without-seeing-it.md#how-claude-calls-an-action)
- [The limit: the same system user](en/actions-claude-uses-a-secret-without-seeing-it.md#the-limit-the-same-system-user)

## Notification center

[Read the chapter.](en/notification-center.md) Its sections:

- [Tuning notifications](en/notification-center.md#tuning-notifications)

## Setup checklist

[Read the chapter.](en/setup-checklist.md)

## Snippets

[Read the chapter.](en/snippets.md)

## Personas

[Read the chapter.](en/personas.md)

## Memory, context and plugins

[Read the chapter.](en/memory-context-and-plugins.md) Its sections:

- [Memory and context](en/memory-context-and-plugins.md#memory-and-context)
- [Plugins](en/memory-context-and-plugins.md#plugins)

## Watching and fixing a PR

[Read the chapter.](en/watching-and-fixing-a-pr.md)

## Teams and messages between sessions

[Read the chapter.](en/teams-and-messages-between-sessions.md) Its sections:

- [Standard session names](en/teams-and-messages-between-sessions.md#standard-session-names)
- [Who may message whom](en/teams-and-messages-between-sessions.md#who-may-message-whom)
- [Teams](en/teams-and-messages-between-sessions.md#teams)

## Costs, budgets and quota

[Read the chapter.](en/costs-budgets-and-quota.md) Its sections:

- [The Claude account of a host](en/costs-budgets-and-quota.md#the-claude-account-of-a-host)
- [Plan quota](en/costs-budgets-and-quota.md#plan-quota)
- [The status bar](en/costs-budgets-and-quota.md#the-status-bar)
- [Quota queue](en/costs-budgets-and-quota.md#quota-queue)
- [Usage](en/costs-budgets-and-quota.md#usage)
- [Costs](en/costs-budgets-and-quota.md#costs)
- [Prices](en/costs-budgets-and-quota.md#prices)
- [Budgets](en/costs-budgets-and-quota.md#budgets)
- [Quota history](en/costs-budgets-and-quota.md#quota-history)
- [Return on cost](en/costs-budgets-and-quota.md#return-on-cost)

## Clients: grouping work across hosts and projects

[Read the chapter.](en/clients-grouping-work-across-hosts-and-projects.md)

## Session summary and webhooks

[Read the chapter.](en/session-summary-and-webhooks.md) Its sections:

- [The summary](en/session-summary-and-webhooks.md#the-summary)
- [Webhooks](en/session-summary-and-webhooks.md#webhooks)

## Tabs and embedded terminal

[Read the chapter.](en/tabs-and-embedded-terminal.md) Its sections:

- [Tabs](en/tabs-and-embedded-terminal.md#tabs)
- [Split view](en/tabs-and-embedded-terminal.md#split-view)
- [Embedded terminal](en/tabs-and-embedded-terminal.md#embedded-terminal)
- [Claude here](en/tabs-and-embedded-terminal.md#claude-here)

## Daily use

[Read the chapter.](en/daily-use.md) Its sections:

- [Needs you, host page and notifications](en/daily-use.md#needs-you-host-page-and-notifications)
- [Tray](en/daily-use.md#tray)
- [Open in terminal](en/daily-use.md#open-in-terminal)
- [Palette Ctrl+K](en/daily-use.md#palette-ctrlk)
- [Keyboard shortcuts](en/daily-use.md#keyboard-shortcuts)
- [Global shortcut](en/daily-use.md#global-shortcut)

## Interface

[Read the chapter.](en/interface.md) Its sections:

- [Design and navigation](en/interface.md#design-and-navigation)
- [Demo mode, screenshots and end-to-end tests](en/interface.md#demo-mode-screenshots-and-end-to-end-tests)
- [Logs and diagnostics](en/interface.md#logs-and-diagnostics)
- [Performance](en/interface.md#performance)

## Host operations

[Read the chapter.](en/host-operations.md) Its sections:

- [Versions and compatibility](en/host-operations.md#versions-and-compatibility)
- [Updating with flightdeckd update](en/host-operations.md#updating-with-flightdeckd-update)
- [Sessions a restart interrupted](en/host-operations.md#sessions-a-restart-interrupted)
- [Signed automatic update](en/host-operations.md#signed-automatic-update)
- [Retention](en/host-operations.md#retention)
- [Backup and restore](en/host-operations.md#backup-and-restore)

## Deploy

[Read the chapter.](en/deploy.md)

## Releases

[Read the chapter.](en/releases.md)

## Development

[Read the chapter.](en/development.md)

## Simple mode

[Read the chapter.](en/simple-mode.md)
