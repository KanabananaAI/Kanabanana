import { useCallback, useEffect, useReducer, useState } from 'react'
import type { Task, Template, Workspace, ColumnId } from './types'
import { useSocket } from './hooks/useSocket'
import { useNotifications } from './hooks/useNotifications'
import KanbanBoard from './components/KanbanBoard'
import TaskCreateModal from './components/TaskCreateModal'
import DependencyGraph from './components/DependencyGraph'
import TaskDetailModal from './components/TaskDetailModal'
import NotificationToast from './components/NotificationToast'
import AgentPanel from './components/AgentPanel'
import { updateSessionsSnapshot } from './components/TaskCard'
import OrchestratorPanel from './components/OrchestratorPanel'
import TerminalPanel, { type TerminalPosition } from './components/TerminalPanel'
import WorkspaceSelector from './components/WorkspaceSelector'
import GitHubPanel from './components/GitHubPanel'
import DeleteConfirmModal from './components/DeleteConfirmModal'
import SettingsPanel from './components/SettingsPanel'
import ArchivePanel from './components/ArchivePanel'
import ScheduleModal from './components/ScheduleModal'
import HelpPanel from './components/HelpPanel'
import WalkthroughOverlay from './components/WalkthroughOverlay'
import WorkspaceTerminalButton from './components/WorkspaceTerminalButton'
import type { AgentType } from './types/agent-config'

// ---- Task reducer ----

type TaskAction =
  | { type: 'SET_ALL'; tasks: Task[] }
  | { type: 'UPSERT'; task: Task }
  | { type: 'REMOVE'; taskId: string }

function taskReducer(state: Task[], action: TaskAction): Task[] {
  switch (action.type) {
    case 'SET_ALL':
      return action.tasks
    case 'UPSERT': {
      const idx = state.findIndex((t) => t.id === action.task.id)
      if (idx === -1) return [...state, action.task]
      const next = [...state]
      next[idx] = action.task
      return next
    }
    case 'REMOVE':
      return state.filter((t) => t.id !== action.taskId)
    default:
      return state
  }
}

// ---- App ----

export default function App() {
  const [tasks, dispatch] = useReducer(taskReducer, [])
  const [templates, setTemplates] = useState<Template[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => {
    return localStorage.getItem('kanaban:activeWorkspace') || ''
  })
  const [theme, setTheme] = useState<'light' | 'dark' | 'banana-dark' | 'banana-light' | 'experimental'>(() => {
    return (localStorage.getItem('kanaban:theme') as 'light' | 'dark' | 'banana-dark' | 'banana-light' | 'experimental') || 'dark'
  })
  const [reviewDoneCardStyle, setReviewDoneCardStyle] = useState<'expanded' | 'collapsed'>(() => {
    return (localStorage.getItem('kanaban:reviewDoneCardStyle') as 'expanded' | 'collapsed') || 'expanded'
  })
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createModalColumn, setCreateModalColumn] = useState<ColumnId>('backlog')
  const [graphOpen, setGraphOpen] = useState(false)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false)
  const [orchestratorPanelCollapsed, setOrchestratorPanelCollapsed] = useState(() => {
    return localStorage.getItem('kanaban:orchestratorPanelCollapsed') === 'true'
  })
  const [terminalSlots, setTerminalSlots] = useState<(string | null)[]>([])
  const [terminalPosition, setTerminalPosition] = useState<TerminalPosition>(() => {
    return (localStorage.getItem('kanaban:terminalPosition') as TerminalPosition) || 'right'
  })
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [editTaskForSettings, setEditTaskForSettings] = useState<Task | null>(null)
  const [scheduleModalTask, setScheduleModalTask] = useState<Task | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [walkthroughActive, setWalkthroughActive] = useState(false)
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)
  const [restartCountdown, setRestartCountdown] = useState<number | null>(null)
  const [defaultAgent, setDefaultAgent] = useState<AgentType>(() => {
    try { return JSON.parse(localStorage.getItem('kanaban:defaultAgent') || '"claude"') } catch { return 'claude' }
  })
  const [defaultYolo, setDefaultYolo] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('kanaban:defaultYolo') || 'false') } catch { return false }
  })
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('kanaban:defaultModels') || '{}') } catch { return {} }
  })

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)

  const fetchTemplates = useCallback(() => {
    fetch('/api/templates')
      .then((res) => (res.ok ? res.json() : []))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((data: any[]) => setTemplates(data.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        agentType: t.agent_type ?? t.agentType ?? 'claude',
        command: t.command ?? '',
        checklistDefaults: t.checklist_defaults ?? t.checklistDefaults ?? [],
      } as Template))))
      .catch(() => { })
  }, [])

  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false)
    // Re-read defaults in case they changed in the settings panel
    try { setDefaultAgent(JSON.parse(localStorage.getItem('kanaban:defaultAgent') || '"claude"')) } catch { /* noop */ }
    try { setDefaultYolo(JSON.parse(localStorage.getItem('kanaban:defaultYolo') || 'false')) } catch { /* noop */ }
    try { setDefaultModels(JSON.parse(localStorage.getItem('kanaban:defaultModels') || '{}')) } catch { /* noop */ }
  }, [])
  const socket = useSocket()
  const { toasts, dismissToast } = useNotifications()

  // Persist active workspace to localStorage
  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem('kanaban:activeWorkspace', activeWorkspaceId)
    } else {
      localStorage.removeItem('kanaban:activeWorkspace')
    }
  }, [activeWorkspaceId])

  // Theme effect
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('dark', 'banana-dark', 'banana-light', 'experimental')
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'banana-dark') {
      root.classList.add('dark', 'banana-dark')
    } else if (theme === 'banana-light') {
      root.classList.add('banana-light')
    } else if (theme === 'experimental') {
      root.classList.add('dark', 'experimental')
    }
    localStorage.setItem('kanaban:theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('kanaban:terminalPosition', terminalPosition)
  }, [terminalPosition])

  useEffect(() => {
    localStorage.setItem('kanaban:orchestratorPanelCollapsed', String(orchestratorPanelCollapsed))
  }, [orchestratorPanelCollapsed])

  // Fetch workspaces on mount
  useEffect(() => {
    fetch('/api/workspaces')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Workspace[]) => {
        setWorkspaces(data)
        // If stored workspace no longer exists, clear it
        const storedId = localStorage.getItem('kanaban:activeWorkspace')
        if (storedId && !data.some((w) => w.id === storedId)) {
          setActiveWorkspaceId('')
        }
      })
      .catch(() => { })
  }, [])

  // Fetch tasks when active workspace changes
  useEffect(() => {
    const params = activeWorkspaceId ? `?workspace_id=${activeWorkspaceId}` : ''
    fetch(`/api/tasks${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Task[]) => {
        dispatch({ type: 'SET_ALL', tasks: data })
      })
      .catch((err) => console.error('[kanaban:app] Failed to fetch tasks:', err))
  }, [activeWorkspaceId])

  // Fetch templates on mount
  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  // Reusable fetch-all-tasks helper
  const fetchAllTasks = useCallback(() => {
    const params = activeWorkspaceId ? `?workspace_id=${activeWorkspaceId}` : ''
    return fetch(`/api/tasks${params}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Task[]) => {
        dispatch({ type: 'SET_ALL', tasks: data })
        return data
      })
  }, [activeWorkspaceId])

  // Socket.io real-time events
  useEffect(() => {
    // Track recently seen task:updated events to detect missed ones
    const recentlyUpdated = new Set<string>()

    const handleTaskUpdate = (task: Task) => {
      // Only show tasks belonging to the active workspace (or all if no workspace selected)
      if (activeWorkspaceId && task.workspaceId !== activeWorkspaceId) return
      recentlyUpdated.add(task.id)
      // Clear from tracking after 2s
      setTimeout(() => recentlyUpdated.delete(task.id), 2000)
      dispatch({ type: 'UPSERT', task })
    }

    const handleTaskDelete = (data: { taskId: string }) => {
      dispatch({ type: 'REMOVE', taskId: data.taskId })
    }

    const handleConnect = () => {
      fetchAllTasks().catch((err) => console.error('[kanaban:app] Failed to fetch tasks on connect:', err))
    }

    // Lightweight fallback: if we get tasks:changed but missed the full task:updated,
    // fetch the individual task to ensure we stay in sync
    const handleTasksChanged = (data: { taskId: string; timestamp: number }) => {
      // Give the full task:updated event 500ms to arrive first
      setTimeout(() => {
        if (!recentlyUpdated.has(data.taskId)) {
          fetch(`/api/tasks/${data.taskId}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((task: Task | null) => {
              if (!task) return
              if (activeWorkspaceId && task.workspaceId !== activeWorkspaceId) return
              dispatch({ type: 'UPSERT', task })
            })
            .catch(() => {})
        }
      }, 500)
    }

    socket.on('connect', handleConnect)
    socket.on('task:updated', handleTaskUpdate)
    socket.on('task:created', handleTaskUpdate)
    socket.on('task:deleted', handleTaskDelete)
    socket.on('tasks:changed', handleTasksChanged)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('task:updated', handleTaskUpdate)
      socket.off('task:created', handleTaskUpdate)
      socket.off('task:deleted', handleTaskDelete)
      socket.off('tasks:changed', handleTasksChanged)
    }
  }, [socket, activeWorkspaceId, fetchAllTasks])

  // Periodic sync — poll every 5s as safety net for missed socket events
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAllTasks().catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchAllTasks])

  // Keep the module-level sessions snapshot updated so TaskCards can
  // initialize hasPtySession immediately on mount (no stale false).
  useEffect(() => {
    const handleSessions = (data: Array<{ taskId: string }>) => {
      updateSessionsSnapshot(data)
    }
    socket.on('sessions:status', handleSessions)
    return () => {
      socket.off('sessions:status', handleSessions)
    }
  }, [socket])

  // Re-sync when tab becomes visible (user switches back to this tab)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchAllTasks().catch(() => {})
        socket.emit('sessions:request')
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [fetchAllTasks, socket])

  // Sync detailTask when the corresponding task in tasks is updated (e.g. after edit save)
  useEffect(() => {
    if (!detailTask) return
    const updated = tasks.find((t) => t.id === detailTask.id)
    if (updated && updated !== detailTask) {
      setDetailTask(updated)
    }
  }, [tasks, detailTask])

  const handleTaskUpdate = useCallback((task: Task) => {
    dispatch({ type: 'UPSERT', task })
  }, [])

  const handleOpenCreateModal = useCallback((column: ColumnId) => {
    setCreateModalColumn(column)
    setCreateModalOpen(true)
  }, [])

  const handleCreateTask = useCallback(
    async (taskData: Partial<Task> & { tags?: { id: string }[] }, images?: File[]) => {
      try {
        const tagIds = taskData.tags?.map((t) => t.id) || []
        const { tags: _tags, ...rest } = taskData
        const payload = {
          ...rest,
          column: createModalColumn,
          workspaceId: activeWorkspaceId || undefined,
          tagIds,
        }
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          const created: Task = await res.json()
          dispatch({ type: 'UPSERT', task: created })

          // Upload images if any (before yolo spawn so they're available in prompt)
          if (images && images.length > 0) {
            try {
              const imageData = await Promise.all(
                images.map(async (file) => {
                  const buffer = await file.arrayBuffer()
                  const base64 = btoa(
                    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                  )
                  return { data: base64, name: file.name, type: file.type }
                })
              )
              const imgRes = await fetch(`/api/tasks/${created.id}/images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images: imageData }),
              })
              if (!imgRes.ok) {
                console.error(`[kanaban:app] Image upload failed — HTTP ${imgRes.status}`)
              }
            } catch (imgErr) {
              console.error('[kanaban:app] Image upload error:', imgErr)
            }
          }

          if (created.agentType !== 'generic' && !created.waitlisted) {
            socket.emit('task:spawn', { taskId: created.id })
          }
        } else {
          console.error(`[kanaban:app] Create task failed — HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[kanaban:app] Create task error:', err)
      }
    },
    [createModalColumn, activeWorkspaceId, socket]
  )

  const handleEditTaskSettings = useCallback(
    async (taskId: string, taskData: Partial<Task> & { tags?: { id: string }[] }, images?: File[]) => {
      try {
        const tagIds = taskData.tags?.map((t) => t.id) || []
        const { tags: _tags, checklistItems, ...rest } = taskData
        const payload = {
          ...rest,
          replaceChecklist: true,
          checklistItems: (checklistItems || []).map((ci) => ({ text: ci.text })),
          replaceTags: true,
          tagIds,
        }
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          const updated: Task = await res.json()
          dispatch({ type: 'UPSERT', task: updated })

          // Upload new images if provided
          if (images && images.length > 0) {
            try {
              const imageData = await Promise.all(
                images.map(async (file) => {
                  const buffer = await file.arrayBuffer()
                  const base64 = btoa(
                    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                  )
                  return { data: base64, name: file.name, type: file.type }
                })
              )
              await fetch(`/api/tasks/${taskId}/images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images: imageData }),
              })
            } catch (imgErr) {
              console.error('[kanaban:app] Image upload error during edit:', imgErr)
            }
          }
        } else {
          console.error(`[kanaban:app] Edit task settings failed — HTTP ${res.status}`)
        }
      } catch (err) {
        console.error('[kanaban:app] Edit task settings error:', err)
      }
    },
    []
  )

  const handleArchiveTask = useCallback(async (task: Task) => {
    try {
      await fetch(`/api/tasks/${task.id}/archive`, { method: 'POST' })
      dispatch({ type: 'REMOVE', taskId: task.id })
    } catch (err) {
      console.error('[kanaban:app] Archive task error:', err)
    }
  }, [])

  const handleWorkspaceCreated = useCallback((workspace: Workspace) => {
    setWorkspaces((prev) => [...prev, workspace])
    setActiveWorkspaceId(workspace.id)
  }, [])

  const handleWorkspaceUpdated = useCallback((workspace: Workspace) => {
    setWorkspaces((prev) => prev.map((w) => (w.id === workspace.id ? workspace : w)))
  }, [])

  // Terminal slot management — slots are (string | null)[] where null = empty slot
  const handleOpenTerminal = useCallback((taskId: string) => {
    setTerminalSlots((prev) => {
      // Already in a slot? Do nothing
      if (prev.includes(taskId)) return prev
      // If no panel open yet, create 1 slot with this task
      if (prev.length === 0) return [taskId]
      // Single slot mode: replace the content
      if (prev.length === 1) return [taskId]
      // Multi-slot: fill first empty slot if available
      const emptyIdx = prev.indexOf(null)
      if (emptyIdx >= 0) {
        const next = [...prev]
        next[emptyIdx] = taskId
        return next
      }
      return prev // all slots full, do nothing
    })
  }, [])

  const handleCycleSlots = useCallback(() => {
    setTerminalSlots((prev) => {
      if (prev.length === 0) return [null] // shouldn't happen, but safety
      if (prev.length < 6) return [...prev, null] // 1→2→3→4→5→6
      // 6 → 1: keep only the first occupied slot
      const firstFilled = prev.find((s) => s !== null) ?? null
      return firstFilled ? [firstFilled] : [null]
    })
  }, [])

  const handleTourAction = useCallback((action: string) => {
    switch (action) {
      case 'open-terminal':
        setTerminalSlots([null])
        break
      case 'split-terminal':
        setTerminalSlots((prev) => prev.length < 2 ? [...prev, null] : prev)
        break
      case 'close-terminal':
        setTerminalSlots([])
        break
    }
  }, [])

  const handleCloseSlot = useCallback((slotIndex: number) => {
    setTerminalSlots((prev) => {
      if (prev.length === 1) {
        // Single slot: close the whole panel
        return []
      }
      // Multi-slot: clear the slot (set to null)
      const next = [...prev]
      next[slotIndex] = null
      return next
    })
  }, [])

  const handleDropToSlot = useCallback((taskId: string, slotIndex: number) => {
    setTerminalSlots((prev) => {
      // Remove taskId from any existing slot first
      const next = prev.map((s) => (s === taskId ? null : s))
      if (slotIndex < next.length) next[slotIndex] = taskId
      return next
    })
  }, [])

  const handleWorkspaceDeleted = useCallback((id: string) => {
    setWorkspaces((prev) => prev.filter((w) => w.id !== id))
    if (activeWorkspaceId === id) {
      setActiveWorkspaceId('')
    }
  }, [activeWorkspaceId])

  const handleDeleteTask = useCallback(async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/tasks/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        dispatch({ type: 'REMOVE', taskId: deleteTarget.id })
        if (detailTask?.id === deleteTarget.id) setDetailTask(null)
        setTerminalSlots((prev) => prev.map((s) => (s === deleteTarget.id ? null : s)))
      }
    } catch (err) {
      console.error('[kanaban:app] Delete task error:', err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, detailTask])

  return (
    <div className="h-screen flex flex-col bg-board-bg">
      {/* Header */}
      <header data-tour="header" className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-board-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <img src="/mascot.png" alt="Kanabanana" className="w-6 h-6 object-contain" />
            <h1 className="text-base font-bold text-text-primary tracking-tight">
              Kanabanana
            </h1>
          </div>
          <div data-tour="workspace-selector" className="flex items-center gap-2 ml-4">
            <span className="text-xs font-medium text-yellow-400 uppercase tracking-wider">Workspace</span>
            <WorkspaceSelector
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={setActiveWorkspaceId}
              onCreated={handleWorkspaceCreated}
              onDeleted={handleWorkspaceDeleted}
              onUpdated={handleWorkspaceUpdated}
            />
          </div>
          <button
            data-tour="new-task-btn"
            onClick={() => handleOpenCreateModal('backlog')}
            disabled={!activeWorkspaceId}
            className={`text-xs px-3 py-1 rounded border font-medium transition-colors ${activeWorkspaceId
                ? 'bg-text-primary text-board-bg border-text-primary hover:opacity-80'
                : 'bg-board-surface text-text-muted border-board-border cursor-not-allowed opacity-50'
              }`}
            title={activeWorkspaceId ? 'Create new task' : 'Select a workspace first'}
          >
            + New Task
          </button>
          <div data-tour="workspace-terminal">
          <WorkspaceTerminalButton
            workspaceId={activeWorkspaceId}
            defaultAgentType={defaultAgent}
            defaultModel={defaultModels[defaultAgent] || ''}
            defaultYolo={defaultYolo}
            disabled={!activeWorkspaceId}
          />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-tour="theme-btn"
            onClick={() => {
              const cycle = ['dark', 'experimental', 'banana-dark', 'banana-light', 'light'] as const
              const idx = cycle.indexOf(theme)
              setTheme(cycle[(idx + 1) % cycle.length])
            }}
            className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 border border-board-border rounded hover:border-text-secondary transition-colors"
            title={`Theme: ${{ dark: 'Dark', experimental: 'Experimental', 'banana-dark': 'Banana Dark', 'banana-light': 'Banana Light', light: 'Light' }[theme]}`}
          >
            {{ dark: 'Dark', experimental: 'Experimental', 'banana-dark': 'Banana Dark', 'banana-light': 'Banana Light', light: 'Light' }[theme]}
          </button>
          <button
            data-tour="settings-btn"
            onClick={() => setSettingsOpen(true)}
            className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 border border-board-border rounded hover:border-text-secondary transition-colors"
            title="Settings"
          >
            Settings
          </button>
          <button
            data-tour="restart-btn"
            onClick={() => restartCountdown !== null ? undefined : setRestartConfirmOpen(true)}
            disabled={restartCountdown !== null}
            className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 border border-board-border rounded hover:border-text-secondary transition-colors disabled:opacity-50"
            title="Restart server (~20s)"
          >
            {restartCountdown !== null ? 'Restarting...' : 'Restart'}
          </button>
          <button
            data-tour="archive-btn"
            onClick={() => setArchiveOpen(true)}
            className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 border border-board-border rounded hover:border-text-secondary transition-colors"
            title="View archived tasks"
          >
            Archive
          </button>
          <button
            data-tour="deps-btn"
            onClick={() => setGraphOpen(true)}
            className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 border border-board-border rounded hover:border-text-secondary transition-colors"
            title="View dependency graph"
          >
            Deps
          </button>
          <button
            data-tour="help-btn"
            onClick={() => setHelpOpen(true)}
            className="text-xs text-text-secondary hover:text-yellow-400 px-2 py-1 border border-board-border rounded hover:border-yellow-400/50 transition-colors"
            title="Help & Reference"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      {/* Board + Terminal + Agent Panel — layout varies by terminal position */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left-side terminal panel */}
        {terminalPosition === 'left' && terminalSlots.length > 0 && (
          <TerminalPanel
            slots={terminalSlots}
            position="left"
            onCycleSlots={handleCycleSlots}
            onCloseSlot={handleCloseSlot}
            onDropToSlot={handleDropToSlot}
          />
        )}

        {/* Board area — wraps board + optional bottom terminal */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden pt-3">
            <KanbanBoard
              tasks={tasks}
              onTaskUpdate={handleTaskUpdate}
              onOpenCreateModal={handleOpenCreateModal}
              onCardClick={setDetailTask}
              onDeleteTask={setDeleteTarget}
              onArchiveTask={handleArchiveTask}
              onEditTaskSettings={setEditTaskForSettings}
              onScheduleTask={setScheduleModalTask}
              canCreateTasks={!!activeWorkspaceId}
              reviewDoneCardStyle={reviewDoneCardStyle}
            />
          </main>

          {/* Bottom terminal panel */}
          {terminalPosition === 'bottom' && terminalSlots.length > 0 && (
            <TerminalPanel
              slots={terminalSlots}
              position="bottom"
              onCycleSlots={handleCycleSlots}
              onCloseSlot={handleCloseSlot}
              onDropToSlot={handleDropToSlot}
            />
          )}
        </div>

        {/* Right-side terminal panel */}
        {terminalPosition === 'right' && terminalSlots.length > 0 && (
          <TerminalPanel
            slots={terminalSlots}
            position="right"
            onCycleSlots={handleCycleSlots}
            onCloseSlot={handleCloseSlot}
            onDropToSlot={handleDropToSlot}
          />
        )}

        {/* GitHub panel — shown when active workspace has a linked repo */}
        {activeWorkspace?.githubRepo && (
          <GitHubPanel
            workspaceId={activeWorkspace.id}
            githubRepo={activeWorkspace.githubRepo}
          />
        )}

        {/* Orchestrator Panel */}
        <div data-tour="orchestrator-panel" className="flex">
        <OrchestratorPanel
          collapsed={orchestratorPanelCollapsed}
          onToggle={() => setOrchestratorPanelCollapsed(v => !v)}
          onOpenTerminal={handleOpenTerminal}
        />
        </div>

        {/* Agent panel — always far right */}
        <div data-tour="agent-panel" className="flex">
        <AgentPanel
          collapsed={agentPanelCollapsed}
          onToggle={() => setAgentPanelCollapsed((v) => !v)}
          onOpenTerminal={handleOpenTerminal}
          activeTerminalIds={terminalSlots.filter((s): s is string => s !== null)}
          slotCount={terminalSlots.length}
          activeWorkspaceId={activeWorkspaceId}
        />
        </div>
      </div>

      {/* Create / Edit Settings modal */}
      <TaskCreateModal
        isOpen={createModalOpen || !!editTaskForSettings}
        onClose={() => { setCreateModalOpen(false); setEditTaskForSettings(null) }}
        onCreate={handleCreateTask}
        onEdit={handleEditTaskSettings}
        editTask={editTaskForSettings ?? undefined}
        existingTasks={editTaskForSettings ? tasks.filter((t) => t.id !== editTaskForSettings.id) : tasks}
        templates={templates}
        defaultAgentType={defaultAgent}
        defaultModel={defaultModels[defaultAgent] === '__custom__' ? (defaultModels[`${defaultAgent}:custom`] || '') : (defaultModels[defaultAgent] || '')}
        defaultYolo={defaultYolo}
        workspaceId={activeWorkspaceId || ''}
      />

      {/* Task detail modal */}
      <TaskDetailModal
        task={detailTask}
        onClose={() => setDetailTask(null)}
        onUpdate={(updated) => {
          handleTaskUpdate(updated)
          setDetailTask(updated)
        }}
      />

      {/* Delete confirmation modal */}
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        taskTitle={deleteTarget?.title || ''}
        onConfirm={handleDeleteTask}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Schedule modal */}
      {scheduleModalTask && (
        <ScheduleModal
          task={scheduleModalTask}
          onClose={() => setScheduleModalTask(null)}
          onSaved={(schedule) => {
            // Update the task in local state with the new schedule info
            dispatch({ type: 'UPSERT', task: { ...scheduleModalTask, schedule: schedule ?? undefined } })
          }}
        />
      )}

      {/* Dependency graph */}
      <DependencyGraph
        tasks={tasks}
        isOpen={graphOpen}
        onClose={() => setGraphOpen(false)}
      />

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <NotificationToast
            key={toast.id}
            toast={toast}
            onDismiss={dismissToast}
          />
        ))}
      </div>

      {/* Settings panel */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={handleSettingsClose}
        theme={theme}
        onThemeChange={setTheme}
        reviewDoneCardStyle={reviewDoneCardStyle}
        onReviewDoneCardStyleChange={(style) => {
          setReviewDoneCardStyle(style)
          localStorage.setItem('kanaban:reviewDoneCardStyle', style)
        }}
        terminalPosition={terminalPosition}
        onTerminalPositionChange={setTerminalPosition}
        onTemplatesChange={fetchTemplates}
      />

      {/* Help panel */}
      <HelpPanel
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        onStartTour={() => { setHelpOpen(false); setWalkthroughActive(true) }}
      />

      {/* Interactive walkthrough */}
      {walkthroughActive && (
        <WalkthroughOverlay onClose={() => setWalkthroughActive(false)} onAction={handleTourAction} />
      )}

      {/* Archive panel */}
      <ArchivePanel
        isOpen={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        activeWorkspaceId={activeWorkspaceId}
        onUnarchived={(task) => dispatch({ type: 'UPSERT', task })}
      />

      {/* Restart confirmation modal */}
      {restartConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setRestartConfirmOpen(false)}
        >
          <div
            className="bg-board-card border border-board-border rounded-lg p-5 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-text-primary mb-3">Restart Server</h2>
            <p className="text-xs text-text-secondary mb-4">
              Active agents will be killed. The server will restart automatically.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRestartConfirmOpen(false)}
                className="px-3 py-1.5 text-xs bg-board-bg border border-board-border rounded text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setRestartConfirmOpen(false)
                  fetch('/api/server/restart', { method: 'POST' }).catch(() => { })
                  setRestartCountdown(0) // Show "reconnecting" overlay immediately
                  // Poll for server to come back
                  const poll = setInterval(() => {
                    fetch('/api/sessions').then(r => {
                      if (r.ok) {
                        clearInterval(poll)
                        window.location.reload()
                      }
                    }).catch(() => { })
                  }, 2000)
                }}
                className="px-3 py-1.5 text-xs bg-orange-900/40 border border-orange-700 rounded text-orange-400 hover:text-orange-300 hover:border-orange-500 transition-colors"
              >
                Restart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restart overlay */}
      {restartCountdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 pointer-events-none">
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-400 mb-2 animate-pulse">
              Restarting server...
            </div>
            <div className="text-sm text-text-secondary">
              Reconnecting automatically
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
