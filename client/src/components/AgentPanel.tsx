import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useSocket } from '../hooks/useSocket'
import { BananaMascot } from './BananaIcons'
import OrchestratorActivityFeed from './OrchestratorActivityFeed'

interface SessionInfo {
  taskId: string
  title: string
  agentType: string
  status: string
  column: string
  command: string
  workingDir: string
  connected: boolean
  updatedAt: string
  createdAt: string
  model: string
  workspaceId: string
  workspaceName: string
  type?: string
}

const agentColors: Record<string, string> = {
  claude: 'text-agent-claude',
  kilo: 'text-agent-kilo',
  lmstudio: 'text-agent-lmstudio',
  qwen: 'text-agent-qwen',
  gemini: 'text-agent-gemini',
  droid: 'text-agent-droid',
  generic: 'text-agent-generic',
}

const agentBorderColors: Record<string, string> = {
  claude: 'border-agent-claude/30',
  kilo: 'border-agent-kilo/30',
  lmstudio: 'border-agent-lmstudio/30',
  qwen: 'border-agent-qwen/30',
  gemini: 'border-agent-gemini/30',
  droid: 'border-agent-droid/30',
  generic: 'border-agent-generic/30',
}

const statusConfig: Record<string, { color: string; label: string; pulse: boolean }> = {
  executing: { color: 'bg-status-executing', label: 'Executing', pulse: true },
  thinking: { color: 'bg-status-thinking', label: 'Thinking', pulse: true },
  running: { color: 'bg-status-executing', label: 'Running', pulse: true },
  'waiting-for-input': { color: 'bg-status-thinking', label: 'Waiting', pulse: true },
  error: { color: 'bg-status-error', label: 'Error', pulse: false },
  idle: { color: 'bg-status-idle', label: 'Idle', pulse: false },
  done: { color: 'bg-status-done', label: 'Completed', pulse: false },
}

const agentProviders: Record<string, string> = {
  claude: 'Anthropic',
  kilo: 'Kilo Code',
  lmstudio: 'LM Studio',
  qwen: 'Alibaba',
  gemini: 'Google',
  droid: 'Aider',
  generic: 'Custom',
}

function getModelDisplay(agentType: string, model: string): string {
  if (!model) {
    const defaults: Record<string, string> = {
      claude: 'Sonnet 4.6',
      gemini: 'Default',
      qwen: 'Default',
      droid: 'Default',
    }
    return defaults[agentType] || ''
  }
  if (agentType === 'claude') {
    if (model === 'sonnet') return 'Sonnet 4.6'
    if (model === 'opus') return 'Opus 4.6'
    if (model === 'haiku') return 'Haiku 4.5'
    // Full model ID: strip claude- prefix and datestamp for readability
    return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  }
  if (agentType === 'kilo') {
    const parts = model.split('/')
    return parts[parts.length - 1]
  }
  if (agentType === 'lmstudio') {
    return model.replace(/^lmstudio:/, '').replace(/^openai\//, '')
  }
  return model
}

function getElapsed(dateStr: string): string {
  if (!dateStr) return '--'
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return '--'
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

interface AgentPanelProps {
  collapsed: boolean
  onToggle: () => void
  onOpenTerminal: (taskId: string) => void
  activeTerminalIds: string[]
  slotCount: number
  activeWorkspaceId: string
}

export default function AgentPanel({ collapsed, onToggle, onOpenTerminal, activeTerminalIds, slotCount, activeWorkspaceId }: AgentPanelProps) {
  const socket = useSocket()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [socketConnected, setSocketConnected] = useState(socket.connected)
  const [_chatSpawning, _setChatSpawning] = useState(false) // DEPRECATED: kept for type compat
  const tickRef = useRef(0)
  const [, setTick] = useState(0)
  // Draggable divider state: activity feed height in pixels (null = use default %)
  const [activityHeight, setActivityHeight] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartY.current = e.clientY
    // Capture current activity height in px
    const panel = panelRef.current
    if (!panel) return
    const currentHeight = activityHeight ?? panel.clientHeight * 0.4
    dragStartHeight.current = currentHeight

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !panelRef.current) return
      const delta = dragStartY.current - ev.clientY
      const panelH = panelRef.current.clientHeight
      const newH = Math.min(Math.max(dragStartHeight.current + delta, 80), panelH - 100)
      setActivityHeight(newH)
    }
    const onMouseUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [activityHeight])

  // Track socket connection state
  useEffect(() => {
    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    setSocketConnected(socket.connected)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [socket])

  // Listen for session status broadcasts + chat spawn results
  useEffect(() => {
    const handleSessions = (data: SessionInfo[]) => {
      console.log(`%c[kanaban:agent] Sessions update — ${data.length} active`, 'color:#3b82f6', data.map(s => ({ task: s.title, status: s.status, agent: s.agentType })))
      setSessions(data)
    }

    const handleConnect = () => {
      socket.emit('sessions:request')
    }

    socket.on('sessions:status', handleSessions)
    socket.on('connect', handleConnect)

    socket.emit('sessions:request')

    // Periodic session poll as safety net (mirrors task poll in App.tsx)
    const interval = setInterval(() => {
      socket.emit('sessions:request')
    }, 10000)

    return () => {
      socket.off('sessions:status', handleSessions)
      socket.off('connect', handleConnect)
      clearInterval(interval)
    }
  }, [socket, onOpenTerminal])

  // Tick every 5 seconds to update elapsed times
  useEffect(() => {
    const interval = setInterval(() => {
      tickRef.current += 1
      setTick(tickRef.current)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Filter sessions by active workspace (show all when no workspace selected)
  // Sort by createdAt descending so newest (most recently deployed) agents appear first
  const filteredSessions = useMemo(() => {
    const filtered = activeWorkspaceId
      ? sessions.filter((s) => s.workspaceId === activeWorkspaceId)
      : sessions
    return [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [sessions, activeWorkspaceId])

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-l border-board-border bg-board-surface flex flex-col items-center pt-3 gap-3">
        <button
          onClick={onToggle}
          className="text-text-secondary hover:text-text-primary text-xs"
          title="Expand agent panel"
        >
          &lt;
        </button>
        {/* Connection indicator */}
        <div
          className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-status-executing' : 'bg-status-error'}`}
          title={socketConnected ? 'Connected' : 'Disconnected'}
        />
        {/* Session count */}
        {filteredSessions.length > 0 && (
          <span className="text-[10px] text-text-muted">{filteredSessions.length}</span>
        )}
        {/* Vertical activity indicators */}
        {filteredSessions.map((s) => {
          const cfg = statusConfig[s.status] || statusConfig.idle
          return (
            <div
              key={s.taskId}
              className={`w-2 h-2 rounded-full ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''} ${s.column === 'review' ? 'opacity-50' : ''}`}
              title={`${s.title} - ${cfg.label}${s.column === 'review' ? ' (In Review)' : ''}`}
            />
          )
        })}
      </div>
    )
  }

  // Session list view
  return (
    <div ref={panelRef} className="w-72 shrink-0 border-l border-board-border bg-board-surface flex flex-col overflow-hidden">
      {/* Panel header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-board-border">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Agents
          </h2>
          <span className="text-[10px] text-text-muted bg-board-bg border border-board-border rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {filteredSessions.length}
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-text-secondary hover:text-text-primary text-xs"
          title="Collapse panel"
        >
          &gt;
        </button>
      </div>

      {/* Server connection status */}
      <div className="shrink-0 px-3 py-2 border-b border-board-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-status-executing' : 'bg-status-error'}`}
            />
            <span className="text-[11px] text-text-secondary">
              {socketConnected ? 'Server connected' : 'Server disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Sessions list — takes available space, shrinks when activity feed needs room */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0">
        {filteredSessions.length === 0 ? (
          <div className="text-center py-4 flex flex-col items-center">
            <BananaMascot size={80} />
            <div className="text-text-muted text-xs mt-2">No active agents</div>
            <div className="text-text-muted text-[10px] mt-1">
              Drag a task to In Progress to start
            </div>
          </div>
        ) : (
          filteredSessions.map((session) => (
            <SessionCard
              key={session.taskId}
              session={session}
              isActive={activeTerminalIds.includes(session.taskId)}
              draggable={slotCount > 1}
              onClick={() => {
                console.log(`%c[kanaban:agent] Opening terminal for "${session.title}"`, 'color:#3b82f6')
                onOpenTerminal(session.taskId)
              }}
            />
          ))
        )}
      </div>

      {/* Panel footer - summary */}
      {filteredSessions.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-t border-board-border">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>
              {filteredSessions.filter((s) => ['executing', 'thinking', 'running'].includes(s.status)).length} active
            </span>
            <span>
              {filteredSessions.filter((s) => s.status === 'waiting-for-input').length} waiting
            </span>
            <span>
              {filteredSessions.filter((s) => s.status === 'error').length} errors
            </span>
          </div>
        </div>
      )}

      {/* Drag handle between sessions and activity feed */}
      <div
        onMouseDown={onDividerMouseDown}
        className="shrink-0 h-1.5 border-t border-b border-board-border bg-board-bg hover:bg-blue-500/20 cursor-ns-resize flex items-center justify-center group transition-colors"
        title="Drag to resize"
      >
        <div className="w-8 h-0.5 rounded-full bg-board-border group-hover:bg-blue-500/50 transition-colors" />
      </div>

      {/* Activity feed — resizable */}
      <div
        className="shrink-0 overflow-visible"
        style={{ height: activityHeight !== null ? activityHeight : '40%', minHeight: 80 }}
      >
        <OrchestratorActivityFeed />
      </div>
    </div>
  )
}

function SessionCard({ session, isActive, draggable, onClick }: { session: SessionInfo; isActive: boolean; draggable?: boolean; onClick: () => void }) {
  const isPlanner = session.type === 'planner'
  const isChat = session.type === 'agent-chat'
  const cfg = statusConfig[session.status] || statusConfig.idle
  const agentColor = isPlanner ? 'text-blue-400' : (agentColors[session.agentType] || agentColors.generic)
  const borderColor = isPlanner ? 'border-blue-500/40' : (agentBorderColors[session.agentType] || agentBorderColors.generic)
  const isInReview = session.column === 'review'

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/kanaban-session', session.taskId)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`border rounded p-2.5 cursor-pointer transition-colors ${isPlanner ? 'bg-blue-500/5 border-blue-500/40 hover:border-blue-400' : `bg-board-card ${isActive ? 'border-blue-500/50 ring-1 ring-blue-500/20' : borderColor} hover:border-text-secondary`} ${isInReview ? 'opacity-50' : ''} ${draggable && !isPlanner ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onClick={onClick}
      draggable={draggable && !isPlanner}
      onDragStart={draggable && !isPlanner ? handleDragStart : undefined}
    >
      {/* Planner badge */}
      {isPlanner && (
        <div className="text-[10px] font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 mb-1.5 text-center uppercase tracking-wider">
          AI Planner
        </div>
      )}

      {isChat && (
        <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">
          Terminal
        </span>
      )}

      {/* In Review badge */}
      {isInReview && !isPlanner && (
        <div className="text-[10px] font-medium text-yellow-500/80 bg-yellow-500/10 border border-yellow-500/20 rounded px-1.5 py-0.5 mb-1.5 text-center uppercase tracking-wider">
          In Review
        </div>
      )}

      {/* Title + status */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${isPlanner ? 'bg-blue-500 animate-pulse' : cfg.color} ${!isPlanner && cfg.pulse ? 'animate-pulse' : ''}`}
        />
        <span className={`text-xs font-medium truncate flex-1 ${isInReview ? 'text-text-muted' : isPlanner ? 'text-blue-300' : 'text-text-primary'}`}>
          {session.title}
        </span>
      </div>

      {/* Info rows */}
      <div className="space-y-1">
        {/* Agent type + status */}
        <div className="flex items-center justify-between">
          <span className={`text-[10px] font-medium ${isInReview ? 'text-text-muted' : agentColor}`}>
            {isChat ? 'Terminal' : isPlanner ? 'Planner' : session.agentType}
          </span>
          <span className="text-[10px] text-text-secondary">
            {isPlanner ? 'Generating...' : cfg.label}
          </span>
        </div>

        {/* Provider + model */}
        {(() => {
          const provider = agentProviders[session.agentType] || session.agentType
          const modelLabel = getModelDisplay(session.agentType, session.model)
          return (
            <div className="flex items-center gap-1 text-[10px] text-text-muted truncate" title={`${provider}${modelLabel ? ` · ${modelLabel}` : ''}`}>
              <span className="shrink-0">⚡</span>
              <span className="truncate">
                {provider}{modelLabel ? <span className="text-text-secondary"> · {modelLabel}</span> : null}
              </span>
            </div>
          )
        })()}

        {/* Workspace */}
        {session.workspaceName && (
          <div className="flex items-center gap-1 text-[10px] text-text-muted truncate" title={`Workspace: ${session.workspaceName}`}>
            <span className="shrink-0">◈</span>
            <span className="truncate text-text-secondary">{session.workspaceName}</span>
          </div>
        )}

        {/* Elapsed time */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-muted">Uptime</span>
          <span className="text-[10px] text-text-secondary font-mono">
            {getElapsed(session.createdAt)}
          </span>
        </div>
      </div>

      {/* Click hint */}
      <div className="text-[9px] text-text-muted mt-1.5 text-center">
        {isPlanner ? 'Click to watch planner work' : draggable ? 'Drag to terminal slot' : 'Click to view terminal'}
      </div>
    </div>
  )
}
