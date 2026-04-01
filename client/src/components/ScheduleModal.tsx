import { useState, useEffect } from 'react'
import type { Task, TaskSchedule } from '../types'

interface ScheduleModalProps {
  task: Task
  onClose: () => void
  onSaved: (schedule: TaskSchedule | null) => void
}

const INTERVAL_PRESETS = [
  { label: 'Hourly', minutes: 60 },
  { label: 'Daily', minutes: 1440 },
  { label: 'Weekly', minutes: 10080 },
  { label: 'Custom', minutes: 0 },
]

function formatLocalDatetime(isoString: string): string {
  const d = new Date(isoString)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toLocalDatetimeDefault(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes from now
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ScheduleModal({ task, onClose, onSaved }: ScheduleModalProps) {
  const existing = task.schedule

  const [scheduledAt, setScheduledAt] = useState<string>(() => {
    if (existing?.scheduledAt) return formatLocalDatetime(existing.scheduledAt)
    return toLocalDatetimeDefault()
  })
  const [isRecurring, setIsRecurring] = useState<boolean>(() => {
    return !!existing?.recurrenceIntervalMinutes
  })
  const [intervalPreset, setIntervalPreset] = useState<number>(() => {
    if (!existing?.recurrenceIntervalMinutes) return 1440
    const known = INTERVAL_PRESETS.find((p) => p.minutes === existing.recurrenceIntervalMinutes && p.minutes !== 0)
    return known ? known.minutes : 0
  })
  const [customInterval, setCustomInterval] = useState<string>(() => {
    if (!existing?.recurrenceIntervalMinutes) return '60'
    const known = INTERVAL_PRESETS.find((p) => p.minutes === existing.recurrenceIntervalMinutes && p.minutes !== 0)
    return known ? '60' : String(existing.recurrenceIntervalMinutes)
  })
  const [maxExecutions, setMaxExecutions] = useState<string>(() => {
    if (existing?.maxExecutions === null || existing?.maxExecutions === undefined) return '0'
    return String(existing.maxExecutions)
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const effectiveInterval = intervalPreset === 0 ? parseInt(customInterval, 10) || 60 : intervalPreset

  const handleSave = async () => {
    if (!scheduledAt) { setError('Please set a start date/time'); return }
    const startDate = new Date(scheduledAt)
    if (isNaN(startDate.getTime())) { setError('Invalid date/time'); return }

    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        scheduledAt: startDate.toISOString(),
        recurrenceIntervalMinutes: isRecurring ? effectiveInterval : null,
        maxExecutions: maxExecutions === '0' ? null : parseInt(maxExecutions, 10) || 1,
      }

      const res = await fetch(`/api/tasks/${task.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to save schedule')
        return
      }

      const saved: TaskSchedule = await res.json()
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${task.id}/schedule`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to delete schedule')
        return
      }
      onSaved(null)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-board-card border border-board-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Schedule Task</h2>
            <p className="text-[11px] text-text-muted mt-0.5 truncate max-w-[320px]" title={task.title}>{task.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Start date/time */}
          <div>
            <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
              Start Date &amp; Time
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-text-secondary"
            />
          </div>

          {/* Recurring toggle */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${isRecurring ? 'bg-blue-600' : 'bg-board-surface border border-board-border'}`}
                onClick={() => setIsRecurring((v) => !v)}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isRecurring ? 'translate-x-4' : ''}`}
                />
              </div>
              <span className="text-xs text-text-primary font-medium">Recurring</span>
            </label>
          </div>

          {/* Recurrence interval */}
          {isRecurring && (
            <div>
              <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                Repeat Every
              </label>
              <div className="flex gap-2 flex-wrap">
                {INTERVAL_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setIntervalPreset(preset.minutes)}
                    className={`px-3 py-1.5 text-xs rounded border transition-colors ${intervalPreset === preset.minutes
                        ? 'border-blue-600 bg-blue-900/40 text-blue-400'
                        : 'border-board-border bg-board-surface text-text-secondary hover:border-text-secondary'
                      }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {intervalPreset === 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={customInterval}
                    onChange={(e) => setCustomInterval(e.target.value)}
                    className="w-24 bg-board-bg border border-board-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-text-secondary"
                    placeholder="60"
                  />
                  <span className="text-xs text-text-muted">minutes</span>
                </div>
              )}
            </div>
          )}

          {/* Max executions */}
          <div>
            <label className="block text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
              {isRecurring ? 'Run At Most' : 'Runs'}
            </label>
            <div className="flex gap-2 flex-wrap">
              {(isRecurring ? ['1', '2', '5', '10', '0'] : ['1']).map((val) => (
                <button
                  key={val}
                  onClick={() => setMaxExecutions(val)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${maxExecutions === val
                      ? 'border-blue-600 bg-blue-900/40 text-blue-400'
                      : 'border-board-border bg-board-surface text-text-secondary hover:border-text-secondary'
                    }`}
                >
                  {val === '0' ? 'Infinite' : `${val}×`}
                </button>
              ))}
              {isRecurring && !['1', '2', '5', '10', '0'].includes(maxExecutions) && (
                <span className="px-3 py-1.5 text-xs rounded border border-blue-600 bg-blue-900/40 text-blue-400">
                  {maxExecutions}×
                </span>
              )}
            </div>
            {isRecurring && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={maxExecutions === '0' ? '' : maxExecutions}
                  onChange={(e) => setMaxExecutions(e.target.value || '0')}
                  className="w-20 bg-board-bg border border-board-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-text-secondary"
                  placeholder="∞"
                />
                <span className="text-xs text-text-muted">or leave blank for infinite</span>
              </div>
            )}
          </div>

          {/* Summary */}
          {scheduledAt && (
            <div className="bg-board-bg border border-board-border rounded px-3 py-2 text-[11px] text-text-secondary">
              <span className="text-text-primary">Will run</span>{' '}
              {isRecurring
                ? <>every {effectiveInterval >= 1440 ? `${effectiveInterval / 1440}d` : effectiveInterval >= 60 ? `${effectiveInterval / 60}h` : `${effectiveInterval}m`}{maxExecutions !== '0' ? `, up to ${maxExecutions} time${maxExecutions === '1' ? '' : 's'}` : ', indefinitely'}</>
                : 'once'}
              {' '}starting{' '}
              <span className="text-text-primary">{new Date(scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-board-border">
          <div>
            {existing && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded border border-red-900/50 text-red-400 hover:bg-red-950/30 transition-colors disabled:opacity-40"
              >
                Remove Schedule
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded border border-board-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !scheduledAt}
              className="text-xs px-4 py-1.5 rounded border border-blue-700 bg-blue-900/40 text-blue-300 hover:bg-blue-900/60 transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving...' : existing ? 'Update Schedule' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
