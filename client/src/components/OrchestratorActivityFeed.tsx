import { useEffect, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'

interface Activity {
  id: string
  type: string
  message: string
  timestamp: string
  source?: 'orchestrator' | 'user' | 'system'
  data?: Record<string, unknown>
}

const TYPE_CONFIG: Record<string, { dot: string; icon: string; label: string }> = {
  'task-created':         { dot: 'bg-blue-400',   icon: '+', label: 'Task Created' },
  'task-started':         { dot: 'bg-cyan-400',   icon: '→', label: 'Task Started' },
  'task-killed':          { dot: 'bg-orange-400', icon: '✕', label: 'Task Killed' },
  'task-completed':       { dot: 'bg-green-400',  icon: '✓', label: 'Task Completed' },
  'task-review':          { dot: 'bg-yellow-400', icon: '◎', label: 'Task Review' },
  'task-verify':          { dot: 'bg-purple-400', icon: '⬡', label: 'Task Verify' },
  'task-feedback':        { dot: 'bg-orange-400', icon: '↻', label: 'Task Feedback' },
  'board-update':         { dot: 'bg-text-muted', icon: '≡', label: 'Board Update' },
}

const ALL_TYPES = Object.keys(TYPE_CONFIG)

const TEXT_COLOR: Record<string, string> = {
  'task-created':         'text-blue-400',
  'task-started':         'text-cyan-400',
  'task-killed':          'text-orange-400',
  'task-completed':       'text-green-400',
  'task-review':          'text-yellow-400',
  'task-verify':          'text-purple-400',
  'task-feedback':        'text-orange-400',
  'board-update':         'text-text-muted',
}

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime()
  if (delta < 5_000) return 'just now'
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s ago`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function OrchestratorActivityFeed() {
  const socket = useSocket()
  const [activities, setActivities] = useState<Activity[]>([])
  const [, setTick] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const listRef = useRef<HTMLDivElement>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(ALL_TYPES))
  const [showAllSources, setShowAllSources] = useState(true)
  const filterRef = useRef<HTMLDivElement>(null)

  // Fetch history on mount
  useEffect(() => {
    fetch('/api/orchestrator/activities')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Activity[]) => setActivities(data))
      .catch(() => {})
  }, [])

  // Refresh relative timestamps every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // Listen for new activities via socket
  useEffect(() => {
    const handler = (activity: Activity) => {
      setActivities((prev) => {
        const next = [...prev, activity]
        if (next.length > 200) next.splice(0, next.length - 200)
        return next
      })
    }
    socket.on('orchestrator:activity', handler)
    return () => {
      socket.off('orchestrator:activity', handler)
    }
  }, [socket])

  // Close filter dropdown when clicking outside
  useEffect(() => {
    if (!showFilter) return
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilter(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showFilter])

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activities])

  // Track whether user has scrolled up
  const handleScroll = () => {
    const el = listRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    autoScrollRef.current = atBottom
  }

  const toggleType = (type: string) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const filteredActivities = activities.filter((a) => {
    // Hide orchestrator lifecycle events from the type list (they show in the header area)
    if (a.type.startsWith('orchestrator-')) return false
    // Source filter: by default only show orchestrator-initiated activities
    if (!showAllSources && a.source && a.source !== 'orchestrator') return false
    // Legacy activities without source field are shown (backward compat)
    return enabledTypes.has(a.type)
  })
  const isFiltered = enabledTypes.size < ALL_TYPES.length || !showAllSources

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-board-border bg-board-bg">
        <span className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold">Activity</span>
        <div className="flex items-center gap-1.5">
          {activities.length > 0 && (
            <span className="text-[10px] text-text-muted">
              {isFiltered ? `${filteredActivities.length}/${activities.length}` : activities.length}
            </span>
          )}
          {/* Filter cog button */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilter((v) => !v)}
              className={`text-[11px] leading-none px-1 py-0.5 rounded transition-colors ${
                showFilter || isFiltered
                  ? 'text-blue-400 bg-blue-500/10'
                  : 'text-text-muted hover:text-text-secondary hover:bg-board-card/40'
              }`}
              title="Filter activity types"
            >
              ⚙
            </button>

            {/* Filter dropdown */}
            {showFilter && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-board-surface border border-board-border rounded shadow-lg z-50 py-1">
                {/* Select all / none */}
                <div className="flex items-center justify-between px-2 py-1 border-b border-board-border mb-1">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider">Filter events</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setEnabledTypes(new Set(ALL_TYPES))}
                      className="text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      All
                    </button>
                    <span className="text-[10px] text-text-muted">·</span>
                    <button
                      onClick={() => setEnabledTypes(new Set())}
                      className="text-[10px] text-text-muted hover:text-text-secondary"
                    >
                      None
                    </button>
                  </div>
                </div>

                {/* Source filter */}
                <div className="px-2 py-1 border-b border-board-border mb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAllSources}
                      onChange={() => setShowAllSources((v) => !v)}
                      className="w-3 h-3 accent-blue-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-text-secondary">Show all sources</span>
                  </label>
                  <p className="text-[9px] text-text-muted mt-0.5">
                    {showAllSources ? 'Showing orchestrator, user & system' : 'Orchestrator actions only'}
                  </p>
                </div>

                {/* Event type checkboxes */}
                {ALL_TYPES.map((type) => {
                  const cfg = TYPE_CONFIG[type]
                  const textColor = TEXT_COLOR[type] || 'text-text-secondary'
                  const checked = enabledTypes.has(type)
                  return (
                    <label
                      key={type}
                      className="flex items-center gap-2 px-2 py-0.5 hover:bg-board-card/40 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleType(type)}
                        className="w-3 h-3 accent-blue-500 cursor-pointer"
                      />
                      <span className={`text-[11px] font-mono ${textColor}`}>{cfg.icon}</span>
                      <span className="text-[10px] text-text-secondary truncate">{cfg.label}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-2 min-h-0"
      >
        {filteredActivities.length === 0 ? (
          <p className="px-3 text-[11px] text-text-muted italic">
            {activities.length === 0 ? 'No activity yet' : 'No matching events'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {filteredActivities.map((a) => {
              const cfg = TYPE_CONFIG[a.type] || { dot: 'bg-text-muted', icon: '·', label: a.type }
              const textColor = TEXT_COLOR[a.type] || 'text-text-secondary'
              return (
                <div key={a.id} className="flex items-start gap-2 px-3 py-1 hover:bg-board-card/40 transition-colors group">
                  <span className={`shrink-0 text-[11px] font-mono mt-0.5 ${textColor}`}>{cfg.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-text-primary leading-snug break-words">{a.message}</p>
                    <p className="text-[10px] text-text-muted">
                      {relativeTime(a.timestamp)}
                      {showAllSources && a.source && (
                        <span className={`ml-1.5 ${
                          a.source === 'orchestrator' ? 'text-blue-400' :
                          a.source === 'system' ? 'text-yellow-400' : 'text-text-muted'
                        }`}>
                          · {a.source}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
