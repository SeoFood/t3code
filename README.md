# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Upstream features

These features come from upstream T3 Code and are not fork-specific.

### Session & Conversation

- Thread management - create, delete, archive, unarchive, rename
- Model selection for Codex (gpt-5.4, gpt-5.3-codex) and Claude (opus-4-6, sonnet-4-6, haiku-4-5) with custom model support
- Streaming messages with markdown rendering and syntax highlighting
- Image attachments in messages
- Checkpointing - full diff snapshots after each turn, revert to any checkpoint
- Approval policies (untrusted, on-failure, on-request, never)
- User approval flow for file changes, terminal commands, and input prompts
- Context window meter showing token usage

### Git Integration (upstream)

- Branch listing, creation, checkout
- Git status with working tree changes, ahead/behind counts, PR association
- Pull operations (sync with upstream)
- Worktree creation and removal
- Real-time git status streaming over WebSocket (auto-refresh on changes)
- Stacked git actions with progress streaming:
  - `commit`, `push`, `create_pr`, `commit_push`, `commit_push_pr`
  - Real-time hook output visibility
  - Toast notifications with action links (open PR, retry)

### Terminal

- Integrated terminal sessions per thread
- Multiple terminals with split support
- Custom environment variables
- Worktree-aware working directory
- Keyboard shortcuts (toggle, split, new, close)

### Settings

- Theme (light/dark/system)
- Timestamp format, sidebar sort order
- Provider configuration (binary paths, custom models, status indicators)
- Customizable keybindings via `~/.t3/keybindings.json`
- Observability (OpenTelemetry traces and metrics URLs)

### Desktop App (upstream)

- Electron-based cross-platform client
- Auto-updater with download progress and install workflow
- Native file picker, context menus, external link handling
- Shell environment variable sync
- `t3://` deep link protocol

## Fork changes (vs upstream)

### Multi-Server Support

Connect to multiple T3 Code servers from a single app instance. Local and remote projects appear side by side in the sidebar.

- **Settings > Servers** - Add, remove, and monitor remote server connections (name, URL, auth token)
- **Server badges** - Remote projects show a small badge with the server name; offline servers are greyed out
- **Server-aware project creation** - "Add project" shows a server picker when remote servers are configured
- **Command routing** - Project and thread operations (delete, archive, rename, etc.) are routed to the correct server automatically
- **Connection monitoring** - Toast notifications when remote servers go offline/online
- **Independent reconnection** - Each server connection retries independently

See [docs/plans/2026-04-06-multi-server-design.md](./docs/plans/2026-04-06-multi-server-design.md) for the full design document.

### GitHub Issues & PRs Dialog

Browse GitHub issues and pull requests directly from the sidebar and create worktree-backed threads from them.

- **Sidebar button** - Click the git icon on any project to open the GitHub dialog
- **Issues tab** - Lists open issues with author, labels, and issue number
- **Pull Requests tab** - Lists open PRs with the same detail
- **One-click worktree creation** - Selecting an issue creates a branch (`t3code/issue-N/slug`) and worktree automatically
- **Existing worktree detection** - If the issue already has a worktree, opens it instead of failing
- **PR checkout** - Selecting a PR checks out the branch in a worktree or locally
- **GitHub CLI auth** - Uses `gh` CLI for authentication; shows clear error message if not logged in

### Spotlight Sync

Spotlight syncs file changes from a worktree back to the repo root directory, enabling hot-reloading in external tools (Xcode, dev servers, etc.).

- **rsync-based sync** - Replaced the original git-checkout approach (which failed due to branch locking in worktrees) with rsync for reliable file mirroring
- **Automatic watching** - File watcher on the worktree triggers sync with 500ms debounce
- **Clean restore** - Disabling spotlight restores the repo root to its original state via `git checkout .` + `git clean`
- **Terminal follows spotlight** - Toggling spotlight automatically `cd`s all open terminals to the repo root (on) or back to the worktree (off); new terminals also open in the correct directory
- **Nerd Font support** - Terminal font stack includes FiraCode, JetBrainsMono, and Hack Nerd Font fallbacks for icon rendering

Enable via Settings > General > Spotlight. The toggle appears in the thread header when a worktree is active.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
