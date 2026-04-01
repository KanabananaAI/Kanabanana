import { useState, useEffect, useCallback } from 'react'
import { useSocket } from '../hooks/useSocket'
import SystemsTab from './orchestrator-panel/SystemsTab'
import AgentsTab from './orchestrator-panel/AgentsTab'
import ActivityTab from './orchestrator-panel/ActivityTab'

// --- Types ---

export interface OrchestratorStatus {
  running: boolean
  enabled: boolean
  provider: string | null
  model: string | null
  startedAt: string | null
}

export interface HealthStatus {
  lastRun: string | null
  ghostTasksDetected: number
  actionsPerformed: string[]
  status: 'healthy' | 'issues' | 'idle'
}

export interface ServerStats {
  uptime: number
  connectedSockets: number
  dbSizeBytes: number
  memoryUsageMB: number
}

export interface SessionInfo {
  taskId: string
  title: string
  status: string
  agentType: string
  startedAt?: string
}

export interface SmartAlert {
  id: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  taskId: string | null
  taskTitle: string | null
  timestamp: string
}

export interface Activity {
  id: string
  type: string
  message: string
  timestamp: string
}

export interface Directive {
  id: string
  content: string
  sourceChannel: string
  expiresAt: string | null
}

type Tab = 'systems' | 'agents' | 'activity'

interface Props {
  collapsed: boolean
  onToggle: () => void
  onOpenTerminal: (taskId: string) => void
}

export default function OrchestratorPanel({ collapsed, onToggle, onOpenTerminal }: Props) {
  const socket = useSocket()

  // Tab state — persisted to localStorage
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    return (localStorage.getItem('kanaban:orchestratorPanelTab') as Tab) || 'systems'
  })

  // Systems data
  const [orchestratorStatus, setOrchestratorStatus] = useState<OrchestratorStatus>({
    running: false, enabled: true, provider: null, model: null, startedAt: null,
  })
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    lastRun: null, ghostTasksDetected: 0, actionsPerformed: [], status: 'idle',
  })
  const [serverStats, setServerStats] = useState<ServerStats>({
    uptime: 0, connectedSockets: 0, dbSizeBytes: 0, memoryUsageMB: 0,
  })

  // Agents data
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [alerts, setAlerts] = useState<SmartAlert[]>([])

  // Activity data
  const [activities, setActivities] = useState<Activity[]>([])
  const [directives, setDirectives] = useState<Directive[]>([])

  // Loading + error states
  const [loading, setLoading] = useState({
    orchestrator: true, health: true, server: true,
    activities: true, directives: true,
  })
  const [fetchErrors, setFetchErrors] = useState<Record<string, boolean>>({})

  // Persist tab selection
  useEffect(() => {
    localStorage.setItem('kanaban:orchestratorPanelTab', activeTab)
  }, [activeTab])

  // --- REST fetches on mount + reconnect ---
  const fetchAll = useCallback(() => {
    setFetchErrors({})

    fetch('/api/orchestrator/status').then(r => r.json())
      .then(d => { setOrchestratorStatus(d); setLoading(l => ({ ...l, orchestrator: false })) })
      .catch(() => { setLoading(l => ({ ...l, orchestrator: false })); setFetchErrors(e => ({ ...e, orchestrator: true })) })

    fetch('/api/health/status').then(r => r.json())
      .then(d => { setHealthStatus(d); setLoading(l => ({ ...l, health: false })) })
      .catch(() => { setLoading(l => ({ ...l, health: false })); setFetchErrors(e => ({ ...e, health: true })) })

    fetch('/api/server/stats').then(r => r.json())
      .then(d => { setServerStats(d); setLoading(l => ({ ...l, server: false })) })
      .catch(() => { setLoading(l => ({ ...l, server: false })); setFetchErrors(e => ({ ...e, server: true })) })

    fetch('/api/orchestrator/activities').then(r => r.json())
      .then(d => { setActivities((d || []).slice(-20)); setLoading(l => ({ ...l, activities: false })) })
      .catch(() => setLoading(l => ({ ...l, activities: false })))

    fetch('/api/directives').then(r => r.json())
      .then(d => { setDirectives(d || []); setLoading(l => ({ ...l, directives: false })) })
      .catch(() => setLoading(l => ({ ...l, directives: false })))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // --- Socket subscriptions ---
  useEffect(() => {
    const handleOrchestratorStatus = (d: { running: boolean; enabled?: boolean }) => {
      setOrchestratorStatus(prev => ({
        ...prev,
        running: d.running,
        ...(d.enabled !== undefined ? { enabled: d.enabled } : {}),
      }))
    }

    const handleSessions = (data: SessionInfo[]) => {
      setSessions(data.filter(s => s.status === 'running'))
    }

    const handleSmartAlert = (alert: SmartAlert) => {
      setAlerts(prev => [...prev, alert])
    }

    const handleActivity = (a: Activity) => {
      setActivities(prev => [...prev.slice(-19), a])
    }

    socket.on('orchestrator:status', handleOrchestratorStatus)
    socket.on('sessions:status', handleSessions)
    socket.on('orchestrator:smart-alert', handleSmartAlert)
    socket.on('orchestrator:activity', handleActivity)
    socket.on('connect', fetchAll)
    socket.emit('sessions:request')
    socket.emit('orchestrator:request-status')

    return () => {
      socket.off('orchestrator:status', handleOrchestratorStatus)
      socket.off('sessions:status', handleSessions)
      socket.off('orchestrator:smart-alert', handleSmartAlert)
      socket.off('orchestrator:activity', handleActivity)
      socket.off('connect', fetchAll)
    }
  }, [socket, fetchAll])

  // --- Alert auto-expiry (30 min) ---
  const activeAlerts = alerts.filter(a => {
    const age = Date.now() - new Date(a.timestamp).getTime()
    return age < 30 * 60 * 1000
  })

  // --- Worst-case status dot for collapsed view ---
  const worstStatus = (() => {
    if (!orchestratorStatus.running && orchestratorStatus.enabled) return 'red'
    if (healthStatus.status === 'issues') return 'yellow'
    if (orchestratorStatus.running) return 'green'
    return 'gray'
  })()

  const statusColors: Record<string, string> = {
    green: 'bg-green-400',
    yellow: 'bg-yellow-400',
    red: 'bg-red-400',
    gray: 'bg-text-muted',
  }

  // --- Dismiss directive ---
  const dismissDirective = async (id: string) => {
    await fetch(`/api/directives/${id}`, { method: 'DELETE' }).catch(() => {})
    setDirectives(prev => prev.filter(d => d.id !== id))
  }

  // --- Collapsed view ---
  if (collapsed) {
    return (
      <div
        className="w-8 border-l border-board-border bg-board-surface flex flex-col items-center pt-3 cursor-pointer hover:bg-board-bg transition-colors"
        onClick={onToggle}
        title="Expand Orchestrator Panel"
      >
        <div className={`w-2.5 h-2.5 rounded-full ${statusColors[worstStatus]} ${worstStatus === 'green' ? 'animate-pulse' : ''}`} />
        <span className="text-text-muted text-[10px] mt-2" style={{ writingMode: 'vertical-rl' }}>
          Orchestrator
        </span>
      </div>
    )
  }

  // --- Expanded view ---
  const tabs: { key: Tab; label: string }[] = [
    { key: 'systems', label: 'Systems' },
    { key: 'agents', label: 'Agents' },
    { key: 'activity', label: 'Activity' },
  ]

  return (
    <div className="w-[300px] border-l border-board-border bg-board-surface flex flex-col text-xs overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-board-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColors[worstStatus]} ${worstStatus === 'green' ? 'animate-pulse' : ''}`} />
          <span className="text-text-primary font-semibold text-xs">Orchestrator</span>
        </div>
        <button
          onClick={onToggle}
          className="text-text-muted hover:text-text-primary text-xs px-1"
          title="Collapse panel"
        >
          &gt;
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-board-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === t.key
                ? 'text-text-primary border-b-2 border-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'systems' && (
          <SystemsTab
            orchestrator={orchestratorStatus}
            health={healthStatus}
            server={serverStats}
            loading={loading}
            fetchErrors={fetchErrors}
          />
        )}
        {activeTab === 'agents' && (
          <AgentsTab
            sessions={sessions}
            alerts={activeAlerts}
            onOpenTerminal={onOpenTerminal}
            onDismissAlert={(id) => setAlerts(prev => prev.filter(a => a.id !== id))}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityTab
            activities={activities}
            directives={directives}
            onDismissDirective={dismissDirective}
          />
        )}
      </div>
    </div>
  )
}
