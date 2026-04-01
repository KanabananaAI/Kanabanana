import { useEffect, useRef, useState, useCallback } from 'react'
import type { Task, ChecklistItem, Tag } from '../types'
import { agentModels } from '../types/agent-config'
import MarkdownRenderer from './MarkdownRenderer'

interface TaskDetailModalProps {
  task: Task | null
  onClose: () => void
  onUpdate: (task: Task) => void
}

const agentColors: Record<string, string> = {
  claude: 'bg-agent-claude/20 text-agent-claude border-agent-claude/30',
  kilo: 'bg-agent-kilo/20 text-agent-kilo border-agent-kilo/30',
  lmstudio: 'bg-agent-lmstudio/20 text-agent-lmstudio border-agent-lmstudio/30',
  qwen: 'bg-agent-qwen/20 text-agent-qwen border-agent-qwen/30',
  gemini: 'bg-agent-gemini/20 text-agent-gemini border-agent-gemini/30',
  droid: 'bg-agent-droid/20 text-agent-droid border-agent-droid/30',
  generic: 'bg-agent-generic/20 text-agent-generic border-agent-generic/30',
}

const statusDotColors: Record<string, string> = {
  executing: 'bg-status-executing',
  thinking: 'bg-status-thinking',
  running: 'bg-status-executing',
  error: 'bg-status-error',
  idle: 'bg-status-idle',
  done: 'bg-status-done',
  'waiting-for-input': 'bg-status-thinking',
}

const statusLabels: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  executing: 'Running',
  running: 'Running',
  'waiting-for-input': 'Waiting',
  error: 'Error',
  done: 'Completed',
}

type TabId = 'details' | 'walkthrough'

export default function TaskDetailModal({ task, onClose, onUpdate }: TaskDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('details')
  const [walkthrough, setWalkthrough] = useState<string | null>(null)
  const [walkthroughLoading, setWalkthroughLoading] = useState(false)
  const [walkthroughError, setWalkthroughError] = useState(false)

  // Reset tab when task changes
  useEffect(() => {
    if (task) {
      setActiveTab('details')
      setWalkthrough(null)
      setWalkthroughError(false)
    }
  }, [task?.id])

  // Prevent browser back gesture / back button from navigating away while modal is open
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const isOpen = !!task

  useEffect(() => {
    if (!isOpen) return

    window.history.pushState({ modal: 'task-detail' }, '')

    let poppedByBack = false

    const handlePopState = () => {
      poppedByBack = true
      onCloseRef.current()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (!poppedByBack && window.history.state?.modal === 'task-detail') {
        window.history.back()
      }
    }
  }, [isOpen])

  // Fetch walkthrough when tab switches
  useEffect(() => {
    if (!task || activeTab !== 'walkthrough') return
    if (walkthrough !== null) return

    setWalkthroughLoading(true)
    setWalkthroughError(false)
    fetch(`/api/tasks/${task.id}/walkthrough`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found')
        return res.json()
      })
      .then((data: { content: string }) => {
        setWalkthrough(data.content)
      })
      .catch(() => {
        setWalkthroughError(true)
        setWalkthrough(null)
      })
      .finally(() => setWalkthroughLoading(false))
  }, [task?.id, activeTab, walkthrough])

  if (!task) return null

  const completedChecklist = task.checklistItems.filter((ci) => ci.done).length
  const totalChecklist = task.checklistItems.length

  const handleToggleChecklist = async (item: ChecklistItem) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/checklist/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !item.done }),
      })
      if (res.ok) {
        const updatedItems = task.checklistItems.map((ci) =>
          ci.id === item.id ? { ...ci, done: !ci.done } : ci
        )
        onUpdate({ ...task, checklistItems: updatedItems })
      }
    } catch {
      // Failed to update
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-board-card border border-board-border rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColors[task.status] || 'bg-status-idle'}`}
              />
              <h2 className="text-lg font-semibold text-text-primary truncate">{task.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary text-lg shrink-0 ml-3"
            >
              x
            </button>
          </div>

          {/* Status & Agent row */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-text-secondary">
              {statusLabels[task.status] || task.status}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${agentColors[task.agentType] || agentColors.generic}`}
            >
              {task.agentType}
            </span>
            {(() => {
              const label = agentModels[task.agentType]?.find((m) => m.value === (task.model || ''))?.label || task.model
              if (!label) return null
              return (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-board-border bg-board-surface text-text-secondary">
                  {label}
                </span>
              )
            })()}
            {task.tags && task.tags.length > 0 && task.tags.map((tag) => (
              <span
                key={tag.id}
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{
                  backgroundColor: `${tag.color}25`,
                  color: tag.color,
                  border: `1px solid ${tag.color}40`,
                }}
              >
                {tag.name}
              </span>
            ))}
            <span className="text-[10px] text-text-muted ml-auto">
              {task.column}
            </span>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-b border-board-border -mx-6 px-6">
            <button
              onClick={() => setActiveTab('details')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'details'
                  ? 'text-text-primary border-text-primary'
                  : 'text-text-secondary border-transparent hover:text-text-primary'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('walkthrough')}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'walkthrough'
                  ? 'text-text-primary border-text-primary'
                  : 'text-text-secondary border-transparent hover:text-text-primary'
              }`}
            >
              Walkthrough
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'details' && (
            <DetailsTab
              task={task}
              completedChecklist={completedChecklist}
              totalChecklist={totalChecklist}
              onToggleChecklist={handleToggleChecklist}
              onUpdate={onUpdate}
            />
          )}
          {activeTab === 'walkthrough' && (
            <WalkthroughTab
              loading={walkthroughLoading}
              error={walkthroughError}
              content={walkthrough}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function DetailsTab({
  task,
  completedChecklist,
  totalChecklist,
  onToggleChecklist,
  onUpdate,
}: {
  task: Task
  completedChecklist: number
  totalChecklist: number
  onToggleChecklist: (item: ChecklistItem) => void
  onUpdate: (task: Task) => void
}) {
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [showTagPicker, setShowTagPicker] = useState(false)

  useEffect(() => {
    fetch('/api/tags')
      .then((r) => r.json())
      .then((data: Tag[]) => setAllTags(data))
      .catch(() => {})
  }, [])

  const handleAddTag = useCallback(async (tagId: string) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      })
      if (res.ok) {
        const tag = allTags.find((t) => t.id === tagId)
        if (tag) {
          onUpdate({ ...task, tags: [...(task.tags || []), tag] })
        }
      }
    } catch {}
  }, [task, allTags, onUpdate])

  const handleRemoveTag = useCallback(async (tagId: string) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/tags/${tagId}`, { method: 'DELETE' })
      if (res.ok) {
        onUpdate({ ...task, tags: (task.tags || []).filter((t) => t.id !== tagId) })
      }
    } catch {}
  }, [task, onUpdate])

  const taskTagIds = (task.tags || []).map((t) => t.id)
  const availableToAdd = allTags.filter((t) => !taskTagIds.includes(t.id))

  return (
    <>
      {/* Tags */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] text-text-secondary uppercase tracking-wider">Tags</span>
          <button
            onClick={() => setShowTagPicker(!showTagPicker)}
            className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 border border-board-border rounded transition-colors"
          >
            {showTagPicker ? 'Done' : '+ Add'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(task.tags || []).map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium group"
              style={{
                backgroundColor: `${tag.color}25`,
                color: tag.color,
                border: `1px solid ${tag.color}40`,
              }}
            >
              {tag.name}
              <button
                onClick={() => handleRemoveTag(tag.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] ml-0.5 hover:brightness-125"
                title="Remove tag"
              >
                x
              </button>
            </span>
          ))}
          {(task.tags || []).length === 0 && !showTagPicker && (
            <span className="text-xs text-text-muted">No tags</span>
          )}
        </div>
        {showTagPicker && availableToAdd.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-board-border">
            {availableToAdd.map((tag) => (
              <button
                key={tag.id}
                onClick={() => handleAddTag(tag.id)}
                className="text-xs px-2 py-0.5 rounded transition-all font-medium hover:brightness-110"
                style={{
                  backgroundColor: 'transparent',
                  color: tag.color,
                  border: `1px dashed ${tag.color}60`,
                }}
              >
                + {tag.name}
              </button>
            ))}
          </div>
        )}
        {showTagPicker && availableToAdd.length === 0 && (
          <p className="text-xs text-text-muted mt-2">No more tags available. Create tags in Settings.</p>
        )}
      </div>

      {/* Description */}
      {task.description && (
        <div className="mb-5">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">Description</div>
          <p className="text-sm text-text-primary whitespace-pre-wrap">{task.description}</p>
        </div>
      )}

      {/* Command */}
      {task.command && (
        <div className="mb-5">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">Command</div>
          <code className="block text-xs text-text-primary font-mono bg-board-bg border border-board-border rounded px-3 py-2 break-all">
            {task.command}
          </code>
        </div>
      )}

      {/* Working Directory */}
      {task.workingDir && (
        <div className="mb-5">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">Working Directory</div>
          <code className="block text-xs text-text-primary font-mono bg-board-bg border border-board-border rounded px-3 py-2 break-all">
            {task.workingDir}
          </code>
        </div>
      )}

      {/* Checklist */}
      {totalChecklist > 0 && (
        <div className="mb-5">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">
            Checklist ({completedChecklist}/{totalChecklist})
          </div>
          <div className="space-y-1.5">
            {task.checklistItems.map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary"
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => onToggleChecklist(item)}
                  className="mt-0.5 rounded-sm border-board-border"
                />
                <span className={item.done ? 'line-through text-text-muted' : ''}>
                  {item.text}
                </span>
                {item.source === 'agent' && (
                  <span className="text-[9px] text-text-muted ml-auto shrink-0">[bot]</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Attached Images */}
      {task.images && task.images.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">
            Attached Images ({task.images.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {task.images.map((img) => (
              <a
                key={img.id}
                href={`/api/tasks/${task.id}/images/${img.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative"
              >
                <img
                  src={`/api/tasks/${task.id}/images/${img.id}/file`}
                  alt={img.originalName}
                  className="w-20 h-20 object-cover rounded border border-board-border group-hover:border-text-secondary transition-colors"
                />
                <p className="text-[9px] text-text-muted truncate max-w-[80px] mt-0.5">
                  {img.originalName}
                </p>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {task.dependsOn.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">Dependencies</div>
          <div className="space-y-1">
            {task.dependsOn.map((depId) => (
              <div key={depId} className="text-xs text-text-secondary font-mono">
                {depId}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="border-t border-board-border pt-3 mt-3 flex gap-4">
        <div className="text-[10px] text-text-muted">
          Created: {new Date(task.createdAt).toLocaleString()}
        </div>
        <div className="text-[10px] text-text-muted">
          Updated: {new Date(task.updatedAt).toLocaleString()}
        </div>
      </div>
    </>
  )
}

function WalkthroughTab({
  loading,
  error,
  content,
}: {
  loading: boolean
  error: boolean
  content: string | null
}) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="text-text-secondary text-sm">Loading walkthrough...</div>
      </div>
    )
  }

  if (error || content === null) {
    return (
      <div className="text-center py-12">
        <div className="text-text-muted text-sm">No walkthrough available</div>
        <div className="text-text-muted text-xs mt-1">
          A walkthrough is generated when the agent completes a task
        </div>
      </div>
    )
  }

  return <MarkdownRenderer content={content} />
}
