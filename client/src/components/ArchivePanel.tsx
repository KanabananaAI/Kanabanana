import { useEffect, useState } from 'react'
import type { Task } from '../types'
import MarkdownRenderer from './MarkdownRenderer'

interface ArchivePanelProps {
  isOpen: boolean
  onClose: () => void
  activeWorkspaceId: string
  onUnarchived: (task: Task) => void
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function ArchivePanel({ isOpen, onClose, activeWorkspaceId, onUnarchived }: ArchivePanelProps) {
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [walkthroughTask, setWalkthroughTask] = useState<Task | null>(null)
  const [walkthroughContent, setWalkthroughContent] = useState<string | null>(null)
  const [walkthroughLoading, setWalkthroughLoading] = useState(false)
  const [walkthroughError, setWalkthroughError] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    const params = activeWorkspaceId ? `?workspace_id=${activeWorkspaceId}` : ''
    fetch(`/api/tasks/archived${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Task[]) => setArchivedTasks(data))
      .catch(() => setArchivedTasks([]))
      .finally(() => setLoading(false))
  }, [isOpen, activeWorkspaceId])

  const handleViewWalkthrough = async (task: Task) => {
    setWalkthroughTask(task)
    setWalkthroughContent(null)
    setWalkthroughError(false)
    setWalkthroughLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/walkthrough`)
      if (!res.ok) throw new Error('Not found')
      const data: { content: string } = await res.json()
      setWalkthroughContent(data.content)
    } catch {
      setWalkthroughError(true)
    } finally {
      setWalkthroughLoading(false)
    }
  }

  const handleUnarchive = async (task: Task) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/unarchive`, { method: 'POST' })
      if (res.ok) {
        setArchivedTasks((prev) => prev.filter((t) => t.id !== task.id))
        onUnarchived({ ...task, archived: false })
      }
    } catch {
      // Failed to unarchive
    }
  }

  if (!isOpen) return null

  // Walkthrough overlay
  if (walkthroughTask) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={() => setWalkthroughTask(null)} />
        <div className="relative bg-board-card border border-board-border rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-board-border">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setWalkthroughTask(null)}
                className="text-text-muted hover:text-text-primary transition-colors shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                </svg>
              </button>
              <h2 className="text-sm font-semibold text-text-primary truncate">{walkthroughTask.title}</h2>
              <span className="text-[10px] text-text-muted shrink-0">· walkthrough.md</span>
            </div>
            <button
              onClick={() => setWalkthroughTask(null)}
              className="text-text-muted hover:text-text-primary transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {walkthroughLoading ? (
              <p className="text-sm text-text-muted text-center py-8">Loading...</p>
            ) : walkthroughError ? (
              <p className="text-sm text-text-muted text-center py-8">No walkthrough found for this task.</p>
            ) : walkthroughContent ? (
              <MarkdownRenderer content={walkthroughContent} />
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-board-card border border-board-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-board-border">
          <h2 className="text-sm font-semibold text-text-primary">
            Archive
            {archivedTasks.length > 0 && (
              <span className="ml-2 text-[10px] text-text-muted border border-board-border rounded-full px-1.5 py-0.5">
                {archivedTasks.length}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-text-muted text-center py-8">Loading...</p>
          ) : archivedTasks.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No archived tasks</p>
          ) : (
            <div className="space-y-2">
              {archivedTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between bg-board-bg border border-board-border rounded p-3"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm text-text-primary truncate">{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-text-muted">{task.agentType}</span>
                      <span className="text-[10px] text-text-muted">·</span>
                      <span className="text-[10px] text-text-muted">{relativeTime(task.updatedAt)}</span>
                      {task.checklistItems.length > 0 && (
                        <>
                          <span className="text-[10px] text-text-muted">·</span>
                          <span className="text-[10px] text-text-muted">
                            {task.checklistItems.filter((i) => i.done).length}/{task.checklistItems.length} checklist
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleViewWalkthrough(task)}
                      className="text-xs px-2 py-1 rounded border border-board-border text-text-muted hover:text-text-primary hover:border-text-secondary transition-colors font-mono"
                      title="View walkthrough"
                    >
                      .md
                    </button>
                    <button
                      onClick={() => handleUnarchive(task)}
                      className="text-xs px-2 py-1 rounded border border-board-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors shrink-0"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
