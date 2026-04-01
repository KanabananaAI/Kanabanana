import { useState, useEffect, useCallback } from 'react'

interface RepoInfo {
  name: string
  fullName: string
  description: string | null
  stars: number
  defaultBranch: string
  openIssuesCount: number
  htmlUrl: string
  private: boolean
}

interface Issue {
  number: number
  title: string
  body: string | null
  htmlUrl: string
  state: string
  createdAt: string
  author: string
  labels: { name: string; color: string }[]
}

interface PullRequest {
  number: number
  title: string
  htmlUrl: string
  state: string
  createdAt: string
  author: string
  branch: string
  draft: boolean
}

interface GitHubPanelProps {
  workspaceId: string
  githubRepo: string
}

type PanelTab = 'issues' | 'pulls'

export default function GitHubPanel({ workspaceId, githubRepo }: GitHubPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('issues')
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [pulls, setPulls] = useState<PullRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importingIssue, setImportingIssue] = useState<number | null>(null)
  const [importedIssues, setImportedIssues] = useState<Set<number>>(new Set())
  const [collapsed, setCollapsed] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [repoRes, issuesRes, pullsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/github`),
        fetch(`/api/workspaces/${workspaceId}/github/issues`),
        fetch(`/api/workspaces/${workspaceId}/github/pulls`),
      ])

      if (!repoRes.ok) {
        const d = await repoRes.json()
        setError(d.error || 'Failed to fetch repo info')
        setLoading(false)
        return
      }

      const [repoData, issuesData, pullsData] = await Promise.all([
        repoRes.json(),
        issuesRes.ok ? issuesRes.json() : [],
        pullsRes.ok ? pullsRes.json() : [],
      ])

      setRepoInfo(repoData)
      setIssues(issuesData)
      setPulls(pullsData)
    } catch {
      setError('Network error — check server connection')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleImportIssue = async (issue: Issue) => {
    if (importingIssue === issue.number) return
    setImportingIssue(issue.number)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/github/import-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueNumber: issue.number }),
      })
      if (res.ok) {
        setImportedIssues((prev) => new Set([...prev, issue.number]))
      }
    } catch {
      // ignore
    } finally {
      setImportingIssue(null)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="flex flex-col border-l border-board-border bg-board-card" style={{ width: collapsed ? '36px' : '280px', transition: 'width 0.2s', minWidth: collapsed ? '36px' : '280px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-board-border shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-semibold text-text-primary truncate" title={githubRepo}>
              ⎇ {githubRepo}
            </span>
            {repoInfo && (
              <span className="text-[10px] text-text-muted shrink-0">★{repoInfo.stars}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {!collapsed && (
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1 text-text-muted hover:text-text-primary disabled:opacity-40"
              title="Refresh"
            >
              <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="p-1 text-text-muted hover:text-text-primary"
            title={collapsed ? 'Expand GitHub panel' : 'Collapse GitHub panel'}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={collapsed ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
            </svg>
          </button>
        </div>
      </div>

      {collapsed && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-text-muted text-[10px]" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            GitHub
          </span>
        </div>
      )}

      {!collapsed && (
        <>
          {/* Repo description */}
          {repoInfo?.description && (
            <div className="px-3 py-2 border-b border-board-border">
              <p className="text-[10px] text-text-muted leading-relaxed">{repoInfo.description}</p>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div className="px-3 py-3">
              <p className="text-xs text-red-400">{error}</p>
              <button onClick={fetchData} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                Retry
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="px-3 py-4 text-xs text-text-muted">Loading...</div>
          )}

          {/* Tabs */}
          {!loading && !error && repoInfo && (
            <>
              <div className="flex border-b border-board-border shrink-0">
                <button
                  onClick={() => setActiveTab('issues')}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${activeTab === 'issues' ? 'text-text-primary border-b-2 border-blue-500' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  Issues ({issues.length})
                </button>
                <button
                  onClick={() => setActiveTab('pulls')}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${activeTab === 'pulls' ? 'text-text-primary border-b-2 border-blue-500' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  PRs ({pulls.length})
                </button>
              </div>

              {/* Issues list */}
              {activeTab === 'issues' && (
                <div className="flex-1 overflow-y-auto">
                  {issues.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-text-muted">No open issues</div>
                  ) : (
                    issues.map((issue) => (
                      <div key={issue.number} className="px-3 py-2.5 border-b border-board-border hover:bg-board-hover group">
                        <div className="flex items-start gap-1.5">
                          <span className="text-[10px] text-text-muted font-mono shrink-0 mt-0.5">#{issue.number}</span>
                          <div className="flex-1 min-w-0">
                            <a
                              href={issue.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-text-primary hover:text-blue-400 leading-tight line-clamp-2"
                            >
                              {issue.title}
                            </a>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="text-[9px] text-text-muted">{issue.author}</span>
                              <span className="text-[9px] text-text-muted">{formatDate(issue.createdAt)}</span>
                            </div>
                            {issue.labels.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {issue.labels.map((label) => (
                                  <span
                                    key={label.name}
                                    className="text-[9px] px-1 rounded"
                                    style={{
                                      backgroundColor: `#${label.color}33`,
                                      color: `#${label.color}`,
                                      border: `1px solid #${label.color}66`,
                                    }}
                                  >
                                    {label.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-1.5">
                          <button
                            onClick={() => handleImportIssue(issue)}
                            disabled={importingIssue === issue.number || importedIssues.has(issue.number)}
                            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                              importedIssues.has(issue.number)
                                ? 'border-green-800 text-green-500 cursor-default'
                                : 'border-board-border text-text-muted hover:border-blue-500 hover:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed'
                            }`}
                          >
                            {importingIssue === issue.number
                              ? 'Importing...'
                              : importedIssues.has(issue.number)
                              ? 'Imported'
                              : 'Import as Task'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* PRs list */}
              {activeTab === 'pulls' && (
                <div className="flex-1 overflow-y-auto">
                  {pulls.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-text-muted">No open pull requests</div>
                  ) : (
                    pulls.map((pr) => (
                      <div key={pr.number} className="px-3 py-2.5 border-b border-board-border hover:bg-board-hover">
                        <div className="flex items-start gap-1.5">
                          <span className="text-[10px] text-text-muted font-mono shrink-0 mt-0.5">#{pr.number}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              {pr.draft && (
                                <span className="text-[9px] text-gray-400 border border-gray-700 rounded px-1">Draft</span>
                              )}
                              <a
                                href={pr.htmlUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-text-primary hover:text-blue-400 leading-tight line-clamp-2"
                              >
                                {pr.title}
                              </a>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className="text-[9px] text-text-muted">{pr.author}</span>
                              <span className="text-[9px] text-text-muted font-mono">{pr.branch}</span>
                              <span className="text-[9px] text-text-muted">{formatDate(pr.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
