# GitHub Issues/PRs to Worktree Threads

Create worktree-based threads directly from GitHub Issues and Pull Requests, giving Claude full context from the start.

## UI

A GitHub icon button next to the "+" (new thread) button on each project in the sidebar. Clicking opens a popover with two tabs: **Issues** and **Pull Requests**.

Each tab shows a list of open items for the project's GitHub repo:
- Number (#123)
- Title
- Labels (small badges)
- Author

Clicking an item creates a new worktree-thread with the issue/PR context as the first message.

Only visible when the project is a GitHub repo (has a GitHub remote).

## Server RPC Methods

### `githubListIssues`

Input: `{ cwd: string }`
Output: `Array<{ number, title, labels, author, body }>`

Calls `gh issue list --repo <remote> --state open --json number,title,labels,author,body --limit 30`.

### `githubListPullRequests`

Input: `{ cwd: string }`
Output: `Array<{ number, title, labels, author, body, headRefName }>`

Calls `gh pr list --state open --json number,title,labels,author,body,headRefName --limit 30`.

### `prepareIssueThread`

Input: `{ cwd: string, issueNumber: number, issueTitle: string }`
Output: `{ worktreePath: string, branch: string }`

1. Creates branch `t3code/issue-{number}/{slugified-title}`
2. Creates git worktree for that branch
3. Runs setup script if configured

For PRs, the existing `preparePullRequestThread` handles everything.

## Data Flow

1. User clicks GitHub icon on project
2. Popover opens, fetches open issues/PRs via RPC
3. User clicks an item
4. Server creates branch + worktree (issues) or checks out PR branch (PRs)
5. Web creates thread via orchestration with worktreePath and branch
6. First message is auto-populated with issue/PR title and body
7. User can immediately start working with Claude

## Authentication

Uses existing `gh` CLI auth (`gh auth login`). No custom OAuth flow.

## Constraints

- Only GitHub repos (detected via git remote)
- Only open issues/PRs
- Uses `gh` CLI exclusively (must be installed and authenticated)
