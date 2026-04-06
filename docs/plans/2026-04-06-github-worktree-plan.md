# GitHub Issues/PRs to Worktree Threads - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub button to each project in the sidebar that lists open issues and PRs, allowing one-click creation of worktree-threads with full issue/PR context.

**Architecture:** Extend the existing `gh` CLI integration with two new RPC methods for listing issues and PRs. Add a GitHub popover UI in the sidebar. Reuse the existing `preparePullRequestThread` flow for PRs and add a new `prepareIssueThread` flow for issues.

**Tech Stack:** Effect Schema (contracts), `gh` CLI (GitHub), React popover UI, existing worktree infrastructure

---

### Task 1: Add GitHub Issue/PR Schemas to Contracts

**Files:**
- Modify: `packages/contracts/src/git.ts`
- Modify: `packages/contracts/src/rpc.ts`

**Step 1: Add schemas to git.ts**

Add these schemas at the end of `packages/contracts/src/git.ts` (before the existing result schemas):

```typescript
// GitHub Issue/PR listing

export const GitHubIssueSummary = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  body: Schema.String,
  author: Schema.Struct({ login: TrimmedNonEmptyStringSchema }),
  labels: Schema.Array(Schema.Struct({ name: TrimmedNonEmptyStringSchema })),
});
export type GitHubIssueSummary = typeof GitHubIssueSummary.Type;

export const GitHubPrListSummary = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  body: Schema.String,
  headRefName: TrimmedNonEmptyStringSchema,
  author: Schema.Struct({ login: TrimmedNonEmptyStringSchema }),
  labels: Schema.Array(Schema.Struct({ name: TrimmedNonEmptyStringSchema })),
});
export type GitHubPrListSummary = typeof GitHubPrListSummary.Type;

export const GitHubListIssuesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitHubListIssuesInput = typeof GitHubListIssuesInput.Type;

export const GitHubListIssuesResult = Schema.Struct({
  issues: Schema.Array(GitHubIssueSummary),
});
export type GitHubListIssuesResult = typeof GitHubListIssuesResult.Type;

export const GitHubListPullRequestsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
});
export type GitHubListPullRequestsInput = typeof GitHubListPullRequestsInput.Type;

export const GitHubListPullRequestsResult = Schema.Struct({
  pullRequests: Schema.Array(GitHubPrListSummary),
});
export type GitHubListPullRequestsResult = typeof GitHubListPullRequestsResult.Type;

export const GitPrepareIssueThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  issueNumber: PositiveInt,
  issueTitle: TrimmedNonEmptyStringSchema,
  threadId: Schema.optional(ThreadId),
});
export type GitPrepareIssueThreadInput = typeof GitPrepareIssueThreadInput.Type;

export const GitPrepareIssueThreadResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema,
});
export type GitPrepareIssueThreadResult = typeof GitPrepareIssueThreadResult.Type;
```

**Step 2: Add RPC methods to rpc.ts**

Add to `WS_METHODS` in `packages/contracts/src/rpc.ts`:

```typescript
  // GitHub methods
  githubListIssues: "github.listIssues",
  githubListPullRequests: "github.listPullRequests",
  gitPrepareIssueThread: "git.prepareIssueThread",
```

Add RPC definitions after the existing git RPCs:

```typescript
export const WsGitHubListIssuesRpc = Rpc.make(WS_METHODS.githubListIssues, {
  payload: GitHubListIssuesInput,
  success: GitHubListIssuesResult,
  error: GitManagerServiceError,
});

export const WsGitHubListPullRequestsRpc = Rpc.make(WS_METHODS.githubListPullRequests, {
  payload: GitHubListPullRequestsInput,
  success: GitHubListPullRequestsResult,
  error: GitManagerServiceError,
});

export const WsGitPrepareIssueThreadRpc = Rpc.make(WS_METHODS.gitPrepareIssueThread, {
  payload: GitPrepareIssueThreadInput,
  success: GitPrepareIssueThreadResult,
  error: GitManagerServiceError,
});
```

Add these to the `WsRpcGroup` array.

**Step 3: Verify**

Run: `bun typecheck`

**Step 4: Commit**

```bash
git add packages/contracts/src/git.ts packages/contracts/src/rpc.ts
git commit -m "feat: add GitHub issue/PR listing and issue thread schemas"
```

---

### Task 2: Add GitHub CLI Methods for Listing Issues/PRs

**Files:**
- Modify: `apps/server/src/git/Services/GitHubCli.ts`
- Modify: `apps/server/src/git/Layers/GitHubCli.ts`

**Step 1: Add service interface methods**

In `apps/server/src/git/Services/GitHubCli.ts`, add to `GitHubCliShape`:

```typescript
  readonly listOpenIssues: (input: {
    readonly cwd: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubIssueSummary>, GitHubCliError>;

  readonly listAllOpenPullRequests: (input: {
    readonly cwd: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPrListSummary>, GitHubCliError>;
```

Import `GitHubIssueSummary` and `GitHubPrListSummary` from contracts.

**Step 2: Implement in layer**

In `apps/server/src/git/Layers/GitHubCli.ts`, add the implementations. Follow the existing `listOpenPullRequests` pattern:

```typescript
listOpenIssues: (input) =>
  execute({
    cwd: input.cwd,
    args: [
      "issue", "list",
      "--state", "open",
      "--limit", String(input.limit ?? 30),
      "--json", "number,title,body,author,labels",
    ],
  }).pipe(
    Effect.map((result) => result.stdout.trim()),
    Effect.flatMap((raw) =>
      raw.length === 0
        ? Effect.succeed([])
        : decodeGitHubJson(
            raw,
            Schema.Array(GitHubIssueSummarySchema),
            "listOpenIssues",
            "GitHub CLI returned invalid issue list JSON.",
          ),
    ),
  ),

listAllOpenPullRequests: (input) =>
  execute({
    cwd: input.cwd,
    args: [
      "pr", "list",
      "--state", "open",
      "--limit", String(input.limit ?? 30),
      "--json", "number,title,body,headRefName,author,labels",
    ],
  }).pipe(
    Effect.map((result) => result.stdout.trim()),
    Effect.flatMap((raw) =>
      raw.length === 0
        ? Effect.succeed([])
        : decodeGitHubJson(
            raw,
            Schema.Array(GitHubPrListSummarySchema),
            "listAllOpenPullRequests",
            "GitHub CLI returned invalid PR list JSON.",
          ),
    ),
  ),
```

Define the raw schemas locally (similar to `RawGitHubPullRequestSchema`) for decoding.

**Step 3: Verify**

Run: `bun typecheck`

**Step 4: Commit**

```bash
git add apps/server/src/git/Services/GitHubCli.ts apps/server/src/git/Layers/GitHubCli.ts
git commit -m "feat: add listOpenIssues and listAllOpenPullRequests to GitHubCli"
```

---

### Task 3: Add prepareIssueThread to GitManager

**Files:**
- Modify: `apps/server/src/git/Services/GitManager.ts`
- Modify: `apps/server/src/git/Layers/GitManager.ts`

**Step 1: Add service interface**

In `apps/server/src/git/Services/GitManager.ts`, add:

```typescript
  readonly prepareIssueThread: (
    input: GitPrepareIssueThreadInput,
  ) => Effect.Effect<GitPrepareIssueThreadResult, GitManagerServiceError>;
```

**Step 2: Implement in layer**

In `apps/server/src/git/Layers/GitManager.ts`, add `prepareIssueThread`. It should:

1. Slugify the issue title for the branch name
2. Create branch `t3code/issue-{number}/{slug}` from current HEAD
3. Create a worktree at the standard worktree path (reuse existing worktree path derivation logic)
4. Run setup script if `threadId` is provided (like `preparePullRequestThread` does)
5. Return `{ branch, worktreePath }`

Follow the pattern of `preparePullRequestThread` but simpler (no cross-repo handling needed).

**Step 3: Verify**

Run: `bun typecheck`

**Step 4: Commit**

```bash
git add apps/server/src/git/Services/GitManager.ts apps/server/src/git/Layers/GitManager.ts
git commit -m "feat: add prepareIssueThread to GitManager"
```

---

### Task 4: Wire RPC Endpoints

**Files:**
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/web/src/wsRpcClient.ts`
- Modify: `apps/web/src/wsNativeApi.ts`

**Step 1: Add server-side handlers in ws.ts**

Add handlers for the three new RPC methods in `ws.ts`, following the pattern of existing git methods:

```typescript
[WS_METHODS.githubListIssues]: (input) =>
  observeRpcEffect(WS_METHODS.githubListIssues,
    gitHubCli.listOpenIssues({ cwd: input.cwd }).pipe(
      Effect.map((issues) => ({ issues })),
      Effect.mapError((e) => new GitManagerServiceError({ message: e.message })),
    ),
    { "rpc.aggregate": "github" },
  ),

[WS_METHODS.githubListPullRequests]: (input) =>
  observeRpcEffect(WS_METHODS.githubListPullRequests,
    gitHubCli.listAllOpenPullRequests({ cwd: input.cwd }).pipe(
      Effect.map((pullRequests) => ({ pullRequests })),
      Effect.mapError((e) => new GitManagerServiceError({ message: e.message })),
    ),
    { "rpc.aggregate": "github" },
  ),

[WS_METHODS.gitPrepareIssueThread]: (input) =>
  observeRpcEffect(WS_METHODS.gitPrepareIssueThread,
    gitManager.prepareIssueThread(input),
    { "rpc.aggregate": "git" },
  ),
```

**Step 2: Add client-side methods in wsRpcClient.ts**

Add to the `WsRpcClient` interface and `createWsRpcClient`:

```typescript
readonly github: {
  readonly listIssues: RpcUnaryMethod<typeof WS_METHODS.githubListIssues>;
  readonly listPullRequests: RpcUnaryMethod<typeof WS_METHODS.githubListPullRequests>;
};
```

And add `prepareIssueThread` to the existing `git` section.

**Step 3: Add to wsNativeApi.ts**

Wire the new methods through the NativeApi.

**Step 4: Verify**

Run: `bun typecheck`

**Step 5: Commit**

```bash
git add apps/server/src/ws.ts apps/web/src/wsRpcClient.ts apps/web/src/wsNativeApi.ts
git commit -m "feat: wire GitHub list and prepareIssueThread RPC endpoints"
```

---

### Task 5: GitHub Popover UI in Sidebar

**Files:**
- Create: `apps/web/src/components/GitHubItemsPopover.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Create GitHubItemsPopover component**

Create `apps/web/src/components/GitHubItemsPopover.tsx`:

- A popover with two tabs: "Issues" and "Pull Requests"
- Each tab fetches data via the new RPC methods when opened
- Shows loading spinner while fetching
- Each item shows: number, title, author, labels
- Clicking an item calls `onSelectIssue` or `onSelectPr` callback
- Show "No open issues" / "No open pull requests" empty states
- Show error state if `gh` CLI is not authenticated

Use existing UI components: Popover, Button, Spinner, Badge from the UI library.

**Step 2: Add GitHub button to Sidebar**

In `Sidebar.tsx`, next to the "+" (new thread) button on each project, add a GitHub icon button (`GitPullRequestIcon` from lucide-react). Clicking opens the `GitHubItemsPopover`.

The button should only be visible when the project has a valid cwd (it's a real project, not a draft).

**Step 3: Handle item selection**

When an issue is selected:
1. Call `prepareIssueThread` with the project cwd and issue details
2. Create a new thread via orchestration with the returned worktree path
3. Set the first message to the issue title + body
4. Navigate to the new thread

When a PR is selected:
1. Call the existing `preparePullRequestThread` with mode "worktree"
2. Create a new thread with the returned worktree path
3. Set the first message to the PR title + body
4. Navigate to the new thread

**Step 4: Verify**

Run: `bun typecheck`, `bun fmt`, `bun lint`

**Step 5: Commit**

```bash
git add apps/web/src/components/GitHubItemsPopover.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat: add GitHub issues/PRs popover to sidebar for worktree thread creation"
```

---

### Task 6: Final Verification

**Step 1: Run all checks**

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

**Step 2: Rebuild server**

```bash
rm -rf apps/server/dist .turbo node_modules/.cache/turbo
bun run --filter @t3tools/contracts build
bun run --filter t3 build
```

**Step 3: Manual testing**

1. Start desktop app
2. Open a project that has a GitHub remote
3. Click the GitHub icon next to "+"
4. Verify issues and PRs load
5. Click an issue - verify worktree thread is created with issue context
6. Click a PR - verify worktree thread is created with PR branch

**Step 4: Commit**

```bash
git commit -m "feat: GitHub Issues/PRs to Worktree Threads complete"
```
