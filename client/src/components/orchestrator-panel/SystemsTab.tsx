import { useState } from 'react'
import { useSocket } from '../../hooks/useSocket'
import type { OrchestratorStatus, HealthStatus, ServerStats } from '../OrchestratorPanel'

interface Props {
  orchestrator: OrchestratorStatus
  health: HealthStatus
  server: ServerStats
  loading: Record<string, boolean>
  fetchErrors: Record<string, boolean>
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-900/40 text-green-400 border-green-700',
    red: 'bg-red-900/40 text-red-400 border-red-700',
    yellow: 'bg-yellow-900/40 text-yellow-400 border-yellow-700',
    gray: 'bg-board-bg text-text-muted border-board-border',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors[color] || colors.gray}`}>
      {label}
    </span>
  )
}

function ModuleCard({ title, badge, loading: isLoading, children, defaultOpen = false }: {
  title: string
  badge: { label: string; color: string } | null
  loading?: boolean
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-board-border">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-board-bg/50 transition-colors"
      >
        <span className="text-text-primary font-medium">{title}</span>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <span className="text-text-muted text-[10px]">loading...</span>
          ) : badge ? (
            <StatusBadge label={badge.label} color={badge.color} />
          ) : null}
          <span className="text-text-muted text-[10px]">{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function DetailRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}

export default function SystemsTab({ orchestrator, health, server, loading, fetchErrors }: Props) {
  const socket = useSocket()

  const orchBadge = (() => {
    if (fetchErrors.orchestrator) return { label: 'Unavailable', color: 'gray' }
    if (!orchestrator.enabled) return { label: 'Disabled', color: 'yellow' }
    if (orchestrator.running) return { label: 'Running', color: 'green' }
    return { label: 'Stopped', color: 'gray' }
  })()

  const healthBadge = (() => {
    if (fetchErrors.health) return { label: 'Unavailable', color: 'gray' }
    if (health.status === 'issues') return { label: 'Issues', color: 'yellow' }
    if (health.status === 'healthy') return { label: 'Healthy', color: 'green' }
    return { label: 'Idle', color: 'gray' }
  })()

  const orchUptime = orchestrator.startedAt
    ? formatUptime(Math.floor((Date.now() - new Date(orchestrator.startedAt).getTime()) / 1000))
    : '—'

  return (
    <div>
      <ModuleCard title="Orchestrator" badge={orchBadge} loading={loading.orchestrator} defaultOpen>
        <DetailRow label="Provider" value={orchestrator.provider || '—'} />
        <DetailRow label="Model" value={orchestrator.model || '—'} />
        <DetailRow label="Uptime" value={orchUptime} />
        <div className="flex gap-2 mt-2">
          {orchestrator.running ? (
            <button
              onClick={() => socket.emit('orchestrator:kill')}
              className="flex-1 px-2 py-1 text-[10px] rounded border border-red-700 text-red-400 hover:bg-red-900/30 transition-colors"
            >
              Kill
            </button>
          ) : (
            <button
              onClick={() => socket.emit('orchestrator:spawn', {})}
              className="flex-1 px-2 py-1 text-[10px] rounded border border-green-700 text-green-400 hover:bg-green-900/30 transition-colors"
            >
              Spawn
            </button>
          )}
          <button
            onClick={() => socket.emit('orchestrator:toggle', { enabled: !orchestrator.enabled })}
            className={`flex-1 px-2 py-1 text-[10px] rounded border transition-colors ${
              orchestrator.enabled
                ? 'border-yellow-700 text-yellow-400 hover:bg-yellow-900/30'
                : 'border-green-700 text-green-400 hover:bg-green-900/30'
            }`}
          >
            {orchestrator.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </ModuleCard>

      <ModuleCard title="Health Check" badge={healthBadge} loading={loading.health}>
        <DetailRow label="Last Run" value={health.lastRun ? new Date(health.lastRun).toLocaleTimeString() : 'Never'} />
        <DetailRow label="Ghost Tasks" value={String(health.ghostTasksDetected)} />
        {health.actionsPerformed.length > 0 && (
          <div className="mt-1">
            <span className="text-text-muted">Actions:</span>
            {health.actionsPerformed.map((a, i) => (
              <div key={i} className="text-text-primary pl-2">- {a}</div>
            ))}
          </div>
        )}
      </ModuleCard>

      <ModuleCard title="Server" badge={null} loading={loading.server}>
        <DetailRow label="Uptime" value={formatUptime(server.uptime)} />
        <DetailRow label="Sockets" value={String(server.connectedSockets)} />
        <DetailRow label="DB Size" value={formatBytes(server.dbSizeBytes)} />
        <DetailRow label="Memory" value={`${server.memoryUsageMB} MB`} />
      </ModuleCard>
    </div>
  )
}
