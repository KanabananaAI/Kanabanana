import type { Activity, Directive } from '../OrchestratorPanel'

interface Props {
  activities: Activity[]
  directives: Directive[]
  onDismissDirective: (id: string) => void
}

const typeColors: Record<string, string> = {
  spawn: 'text-cyan-400',
  kill: 'text-red-400',
  review: 'text-green-400',
  move: 'text-yellow-400',
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

export default function ActivityTab({ activities, directives, onDismissDirective }: Props) {
  return (
    <div>
      {/* Directives */}
      {directives.length > 0 && (
        <div className="px-3 py-2 border-b border-board-border">
          <div className="text-text-muted font-medium mb-1">Directives ({directives.length})</div>
          {directives.map(d => (
            <div key={d.id} className="flex items-start gap-1 py-0.5 group">
              <span className="text-yellow-400 mt-0.5 shrink-0">*</span>
              <div className="flex-1 min-w-0">
                <span className="text-text-primary break-words">{d.content}</span>
                <span className="text-text-muted ml-1 text-[10px]">({d.sourceChannel})</span>
                {d.expiresAt && (
                  <span className="text-text-muted ml-1 text-[10px]">
                    expires {relativeTime(d.expiresAt)}
                  </span>
                )}
              </div>
              <button
                onClick={() => onDismissDirective(d.id)}
                className="text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] shrink-0"
                title="Dismiss directive"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Recent Events */}
      <div className="px-3 py-2">
        <div className="text-text-muted font-medium mb-1">Recent Events</div>
        {activities.length === 0 ? (
          <div className="text-text-muted italic py-1">No recent events</div>
        ) : (
          activities.map(a => (
            <div key={a.id} className="flex items-start gap-1.5 py-0.5">
              <span className={`mt-0.5 shrink-0 ${typeColors[a.type] || 'text-text-muted'}`}>-</span>
              <div className="min-w-0">
                <span className="text-text-primary break-words">{a.message}</span>
                <span className="text-text-muted ml-1 text-[10px]">{relativeTime(a.timestamp)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
