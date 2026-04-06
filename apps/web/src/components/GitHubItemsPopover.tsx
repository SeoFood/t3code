import type {
  GitHubIssueSummary,
  GitHubPrListSummary,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { getWsRpcClient } from "~/wsRpcClient";
import { Badge } from "./ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";

type GitHubTab = "issues" | "prs";

interface GitHubItemsPopoverProps {
  projectId: ProjectId;
  cwd: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onThreadCreated: (threadId: ThreadId, branch: string, worktreePath: string) => void;
  children: React.ReactNode;
}

export function GitHubItemsPopover({
  cwd,
  open,
  onOpenChange,
  onThreadCreated,
  children,
}: GitHubItemsPopoverProps) {
  const [activeTab, setActiveTab] = useState<GitHubTab>("issues");
  const [issues, setIssues] = useState<readonly GitHubIssueSummary[]>([]);
  const [pullRequests, setPullRequests] = useState<readonly GitHubPrListSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparingItem, setPreparingItem] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);

    const client = getWsRpcClient();

    Promise.all([client.github.listIssues({ cwd }), client.github.listPullRequests({ cwd })])
      .then(([issuesResult, prsResult]) => {
        setIssues(issuesResult.issues);
        setPullRequests(prsResult.pullRequests);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to fetch GitHub data.";
        if (message.includes("auth") || message.includes("login") || message.includes("token")) {
          setError("GitHub CLI is not authenticated. Run `gh auth login` to authenticate.");
        } else {
          setError(message);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [cwd, open]);

  const handleIssueClick = useCallback(
    async (issue: GitHubIssueSummary) => {
      setPreparingItem(issue.number);
      try {
        const client = getWsRpcClient();
        const result = await client.git.prepareIssueThread({
          cwd,
          issueNumber: issue.number,
          issueTitle: issue.title,
        });
        onThreadCreated(undefined as unknown as ThreadId, result.branch, result.worktreePath);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to prepare issue thread.");
      } finally {
        setPreparingItem(null);
      }
    },
    [cwd, onOpenChange, onThreadCreated],
  );

  const handlePrClick = useCallback(
    async (pr: GitHubPrListSummary) => {
      setPreparingItem(pr.number);
      try {
        const client = getWsRpcClient();
        const result = await client.git.preparePullRequestThread({
          cwd,
          reference: String(pr.number),
          mode: "worktree",
        });
        onThreadCreated(undefined as unknown as ThreadId, result.branch, result.worktreePath ?? "");
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to prepare PR thread.");
      } finally {
        setPreparingItem(null);
      }
    },
    [cwd, onOpenChange, onThreadCreated],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverPopup side="right" align="start" sideOffset={8} className="w-80">
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === "issues"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("issues")}
            >
              Issues
            </button>
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === "prs"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("prs")}
            >
              Pull Requests
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-4 text-center text-destructive text-xs">{error}</p>
          ) : activeTab === "issues" ? (
            issues.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-xs">No open issues</p>
            ) : (
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {issues.map((issue) => (
                  <GitHubItemRow
                    key={issue.number}
                    number={issue.number}
                    title={issue.title}
                    authorLogin={issue.author.login}
                    labels={issue.labels}
                    preparing={preparingItem === issue.number}
                    disabled={preparingItem !== null}
                    onClick={() => void handleIssueClick(issue)}
                  />
                ))}
              </div>
            )
          ) : pullRequests.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-xs">No open pull requests</p>
          ) : (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {pullRequests.map((pr) => (
                <GitHubItemRow
                  key={pr.number}
                  number={pr.number}
                  title={pr.title}
                  authorLogin={pr.author.login}
                  labels={pr.labels}
                  preparing={preparingItem === pr.number}
                  disabled={preparingItem !== null}
                  onClick={() => void handlePrClick(pr)}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function GitHubItemRow({
  number,
  title,
  authorLogin,
  labels,
  preparing,
  disabled,
  onClick,
}: {
  number: number;
  title: string;
  authorLogin: string;
  labels: readonly { name: string }[];
  preparing: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      <div className="flex items-start gap-1.5">
        {preparing ? (
          <Spinner className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="mt-px shrink-0 text-[10px] tabular-nums text-muted-foreground">
            #{number}
          </span>
        )}
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{title}</span>
      </div>
      <div className="flex items-center gap-1.5 pl-0.5">
        <span className="text-[10px] text-muted-foreground">@{authorLogin}</span>
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {labels.map((label) => (
              <Badge key={label.name} variant="secondary" size="sm" className="px-1 text-[9px]">
                {label.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
