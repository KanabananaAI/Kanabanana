import type { SessionInfo, SmartAlert } from '../OrchestratorPanel'

interface Props {
  sessions: SessionInfo[]
  alerts: SmartAlert[]
  onOpenTerminal: (taskId: string) => void
  onDismissAlert: (id: string) => void
}

const agentDotColors: Record<string, string> = {
  claude: 'bg-orange-400',
  kilo: 'bg-blue-400',
  gemini: 'bg-purple-400',
  qwen: 'bg-cyan-400',
  droid: 'bg-green-400',
  lmstudio: 'bg-pink-400',
  generic: 'bg-text-muted',
}

const severityStyles: Record<string, { border: string; icon: string; bg: string }> = {
  info: { border: 'border-l-blue-400', icon: 'text-blue-400', bg: 'bg-blue-900/20' },
  warning: { border: 'border-l-yellow-400', icon: 'text-yellow-400', bg: 'bg-yellow-900/20' },
  critical: { border: 'border-l-red-400', icon: 'text-red-400', bg: 'bg-red-900/20' },
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

export default function AgentsTab({ sessions, alerts, onOpenTerminal, onDismissAlert }: Props) {
  return (
    <div>
      {/* Running Agents */}
      <div className="px-3 py-2 border-b border-board-border">
        <div className="text-text-muted font-medium mb-1">Running Agents ({sessions.length})</div>
        {sessions.length === 0 ? (
          <div className="text-text-muted italic py-1">No active agents</div>
        ) : (
          sessions.map(s => (
            <button
              key={s.taskId}
              onClick={() => onOpenTerminal(s.taskId)}
              className="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-board-bg/50 transition-colors text-left"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${agentDotColors[s.agentType] || agentDotColors.generic}`} />
              <span className="text-text-primary truncate flex-1">{s.title}</span>
              <span className="text-text-muted shrink-0">{s.agentType}</span>
            </button>
          ))
        )}
      </div>

      {/* Smart Alerts */}
      <div className="px-3 py-2">
        <div className="text-text-muted font-medium mb-1">Alerts ({alerts.length})</div>
        {alerts.length === 0 ? (
          <div className="text-text-muted italic py-1">No active alerts</div>
        ) : (
          alerts.map(a => {
            const style = severityStyles[a.severity] || severityStyles.info
            return (
              <div
                key={a.id}
                className={`border-l-2 ${style.border} ${style.bg} rounded-r px-2 py-1.5 mb-1.5 group`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <span className={`${style.icon} font-medium`}>
                      {a.severity === 'critical' ? '!!' : a.severity === 'warning' ? '!' : 'i'}
                    </span>
                    <span className="text-text-primary ml-1">{a.message}</span>
                    {a.taskTitle && (
                      <div className="text-text-muted mt-0.5 truncate">{a.taskTitle}</div>
                    )}
                  </div>
                  <button
                    onClick={() => onDismissAlert(a.id)}
                    className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] shrink-0"
                  >
                    x
                  </button>
                </div>
                <div className="text-text-muted text-[10px] mt-0.5">{relativeTime(a.timestamp)}</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
