import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task, ChecklistItem, NextStep, Skill } from '../types'
import { useSocket } from '../hooks/useSocket'
import { agentTypes, agentModels } from '../types/agent-config'
import MarkdownRenderer from './MarkdownRenderer'
import { useWhisper } from '../hooks/useWhisper'
import DictateButton from './DictateButton'

// Module-level cache of the latest sessions:status data.
// Lets newly mounted TaskCards initialize hasPtySession immediately
// instead of waiting for the next server broadcast.
let lastSessionsSnapshot: Array<{ taskId: string }> = []
export function updateSessionsSnapshot(sessions: Array<{ taskId: string }>) {
  lastSessionsSnapshot = sessions
}

interface TaskCardProps {
  task: Task
  onUpdate: (task: Task) => void
  onCardClick: (task: Task) => void
  onDelete: (task: Task) => void
  onArchive?: (task: Task) => void
  onEditSettings?: (task: Task) => void
  onScheduleTask?: (task: Task) => void
  reviewDoneCardStyle?: 'expanded' | 'collapsed'
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

const agentAccentColors: Record<string, string> = {
  claude: '#e67e22',
  kilo: '#06b6d4',
  lmstudio: '#10b981',
  qwen: '#3b82f6',
  gemini: '#a855f7',
  droid: '#22c55e',
  generic: '#6b7280',
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

function formatTokenCount(count: number): string {
  if (count === 0) return '0'
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(1)}M`
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

function formatScheduledAt(isoString: string): string {
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  if (diffMs < 0) return 'overdue'
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `in ${diffMins}m`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `in ${diffHrs}h`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function TaskCard({ task, onUpdate, onCardClick, onDelete, onArchive, onEditSettings, onScheduleTask, reviewDoneCardStyle = 'expanded' }: TaskCardProps) {
  const socket = useSocket()
  const [commandInput, setCommandInput] = useState('')
  const [feedbackInput, setFeedbackInput] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [skills, setSkills] = useState<Skill[]>([])
  const [showSkills, setShowSkills] = useState(false)

  const [walkthrough, setWalkthrough] = useState<string | null>(null)
  const whisper = useWhisper()
  const feedbackBaseRef = useRef('')
  const [hasPtySession, setHasPtySession] = useState(false)

  // Live-update feedback field as whisper transcript changes during recording
  useEffect(() => {
    if (!whisper.transcript) return
    const base = feedbackBaseRef.current
    const combined = base ? base + '\n' + whisper.transcript : whisper.transcript
    setFeedbackInput(combined)
  }, [whisper.transcript])

  const handleDictate = useCallback(async () => {
    if (whisper.status === 'recording') {
      const finalText = await whisper.toggle()
      if (finalText) {
        const base = feedbackBaseRef.current
        setFeedbackInput(base ? base + '\n' + finalText : finalText)
      }
      feedbackBaseRef.current = ''
    } else if (whisper.status === 'idle') {
      feedbackBaseRef.current = feedbackInput
      await whisper.toggle()
    }
  }, [whisper, feedbackInput])

  // Track whether this task has an actual PTY session running (mirrors agents panel)
  useEffect(() => {
    const handleSessions = (data: Array<{ taskId: string }>) => {
      setHasPtySession(data.some((s) => s.taskId === task.id))
    }
    socket.on('sessions:status', handleSessions)
    // Initialize from the last known sessions snapshot (avoids waiting for next broadcast)
    if (lastSessionsSnapshot.length > 0) {
      setHasPtySession(lastSessionsSnapshot.some((s) => s.taskId === task.id))
    }
    return () => {
      socket.off('sessions:status', handleSessions)
    }
  }, [socket, task.id])

  const canChangeAgent = useCallback(
    async (field: 'agentType' | 'model', value: string) => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })
        if (res.ok) {
          const updated = await res.json()
          onUpdate(updated)
        }
      } catch {
        // Failed to update
      }
    },
    [task.id, onUpdate]
  )

  const isActive = task.column === 'in-progress'
  const isInspecting = task.column === 'inspect'
  const isReview = task.column === 'review'
  const isRunning = ['executing', 'thinking', 'running', 'waiting-for-input'].includes(task.status)
  // isLive = task status says running AND an actual PTY session exists in the agents panel
  const isLive = isRunning && hasPtySession
  const isReworking = isReview && isLive
  const isAwaitingFeedback = isReview && !isLive
  const hasUnmetDeps = task.dependsOn.length > 0 && task.status === 'idle'

  // Join/leave task room for real-time updates
  useEffect(() => {
    if (isActive || isInspecting || isReworking) {
      console.log(`%c[kanaban:card] Joining room for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#a855f7')
      socket.emit('task:join', task.id)
      return () => {
        console.log(`%c[kanaban:card] Leaving room for "${task.title}" (id=${task.id.slice(0, 8)})`, 'color:#a855f7')
        socket.emit('task:leave', task.id)
      }
    }
  }, [isActive, isInspecting, isReworking, task.id, task.title, socket])

  // Listen for room-scoped real-time events (spawn result, exit) when active, inspecting, or reworking
  useEffect(() => {
    if (!isActive && !isInspecting && !isReworking) return

    const handleSpawnResult = (data: { taskId: string; success: boolean }) => {
      if (data.taskId === task.id) {
        console.log(`%c[kanaban:card] Spawn result — "${task.title}": ${data.success ? 'SUCCESS' : 'FAILED'}`, data.success ? 'color:#22c55e;font-weight:bold' : 'color:#ef4444;font-weight:bold')
      }
    }

    const handleExit = (data: { taskId: string; exitCode: number }) => {
      if (data.taskId === task.id) {
        console.log(`%c[kanaban:card] Agent exited — "${task.title}": exitCode=${data.exitCode}`, data.exitCode === 0 ? 'color:#22c55e;font-weight:bold' : 'color:#ef4444;font-weight:bold')
      }
    }

    socket.on('task:spawn:result', handleSpawnResult)
    socket.on('task:exit', handleExit)

    return () => {
      socket.off('task:spawn:result', handleSpawnResult)
      socket.off('task:exit', handleExit)
    }
  }, [isActive, isInspecting, isReworking, task.id, task.title, socket])

  // Fetch walkthrough when in review, inspect, or done
  const isDone = task.column === 'done'
  useEffect(() => {
    if (isAwaitingFeedback || isDone) {
      fetch(`/api/tasks/${task.id}/walkthrough`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setWalkthrough(data?.content || null))
        .catch(() => setWalkthrough(null))
    } else {
      setWalkthrough(null)
    }
  }, [isAwaitingFeedback, isDone, task.id])

  // Fetch available skills for this agent type
  useEffect(() => {
    if (isActive) {
      fetch(`/api/skills?agentType=${task.agentType}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((data: Skill[]) => setSkills(data))
        .catch(() => setSkills([]))
    }
  }, [isActive, task.agentType])

  const handleToggleChecklist = useCallback(
    async (item: ChecklistItem) => {
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
    },
    [task, onUpdate]
  )

  const handleSendCommand = useCallback(() => {
    if (!commandInput.trim()) return
    console.log(`%c[kanaban:card] Sending command to "${task.title}": ${commandInput}`, 'color:#f97316')
    socket.emit('task:input', { taskId: task.id, input: commandInput + '\r' })
    setCommandInput('')
  }, [commandInput, task.id, task.title, socket])

  const handleToggleYolo = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      console.log(`%c[kanaban:card] Toggling YOLO for "${task.title}" (currently ${task.yolo ? 'ON' : 'OFF'})`, 'color:#f59e0b;font-weight:bold')
      socket.emit('task:toggle-yolo', { taskId: task.id })
    },
    [task.id, task.title, task.yolo, socket]
  )

  const handleToggleAutoReview = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      console.log(`%c[kanaban:card] Toggling Auto Review for "${task.title}" (currently ${task.autoReview ? 'ON' : 'OFF'})`, 'color:#3b82f6;font-weight:bold')
      socket.emit('task:toggle-auto-review', { taskId: task.id })
    },
    [task.id, task.title, task.autoReview, socket]
  )

  const handleToggleWaitlist = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      console.log(`%c[kanaban:card] Toggling waitlist for "${task.title}" (currently ${task.waitlisted ? 'ON' : 'OFF'})`, 'color:#a855f7;font-weight:bold')
      socket.emit('task:toggle-waitlist', { taskId: task.id })
    },
    [task.id, task.title, task.waitlisted, socket]
  )

  const handleToggleAutoComplete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      console.log(`%c[kanaban:card] Toggling Auto Complete for "${task.title}" (currently ${task.autoComplete ? 'ON' : 'OFF'})`, 'color:#22c55e;font-weight:bold')
      socket.emit('task:toggle-auto-complete', { taskId: task.id })
    },
    [task.id, task.title, task.autoComplete, socket]
  )

  const handleManualComplete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      console.log(`%c[kanaban:card] Manual task complete for "${task.title}"`, 'color:#22c55e;font-weight:bold')
      socket.emit('task:manual-complete', { taskId: task.id })
    },
    [task.id, task.title, socket]
  )

  const handleNextStepAction = useCallback(
    (step: NextStep) => {
      if (step.command) {
        socket.emit('task:input', { taskId: task.id, input: step.command + '\r' })
      }
      // Mark as actioned
      fetch(`/api/tasks/${task.id}/next-steps/${step.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actioned: true }),
      }).catch(() => { })
    },
    [task.id, socket]
  )

  const handleSkillAction = useCallback(
    (skill: Skill) => {
      socket.emit('task:input', { taskId: task.id, input: skill.command + '\r' })
      setShowSkills(false)
    },
    [task.id, socket]
  )

  const handleSendFeedback = useCallback(() => {
    // Strip zero-width space interim markers from voice input before sending
    const cleaned = feedbackInput.replace(/\u200B.*$/, '').trim()
    if (!cleaned || feedbackSending) return
    console.log(`%c[kanaban:card] Sending feedback for "${task.title}": ${cleaned.slice(0, 80)}...`, 'color:#f97316')
    setFeedbackSending(true)
    socket.emit('task:feedback', { taskId: task.id, feedback: cleaned })
    socket.once('task:feedback:result', () => {
      setFeedbackSending(false)
      setFeedbackInput('')
    })
  }, [feedbackInput, feedbackSending, task.id, socket])

  const handlePause = () => {
    console.log(`%c[kanaban:card] Pause — "${task.title}"`, 'color:#eab308;font-weight:bold')
    socket.emit('task:pause', { taskId: task.id })
  }
  const handleStop = () => {
    console.log(`%c[kanaban:card] Stop — "${task.title}"`, 'color:#ef4444;font-weight:bold')
    socket.emit('task:kill', { taskId: task.id })
  }
  const handleRestart = () => {
    console.log(`%c[kanaban:card] Start/Restart — "${task.title}"`, 'color:#22c55e;font-weight:bold')
    socket.emit('task:spawn', { taskId: task.id })
  }
  const handleVerify = () => {
    console.log(`%c[kanaban:card] Verify — "${task.title}"`, 'color:#3b82f6;font-weight:bold')
    // Read verify model settings from localStorage
    const verifyAgent = (() => { try { return JSON.parse(localStorage.getItem('kanaban:verifyAgent') || 'null') } catch { return null } })()
    const verifyModels = (() => { try { return JSON.parse(localStorage.getItem('kanaban:verifyModels') || '{}') } catch { return {} } })()
    const verifyModelRaw: string = verifyAgent ? (verifyModels[verifyAgent] || '') : ''
    const verifyModelCustom: string = (verifyAgent && verifyModelRaw === '__custom__')
      ? (verifyModels[`${verifyAgent}:custom`] || '')
      : verifyModelRaw
    const payload: Record<string, string> = { taskId: task.id }
    if (verifyAgent) payload.verifyAgent = verifyAgent
    if (verifyModelCustom) payload.verifyModel = verifyModelCustom
    socket.emit('task:verify', payload)
  }

  const completedChecklist = task.checklistItems.filter((ci) => ci.done).length
  const totalChecklist = task.checklistItems.length

  // Review card — grayed out when reworking, feedback prompt when idle
  if (isReview) {
    const reviewAccent = agentAccentColors[task.agentType] || agentAccentColors.generic
    return (
      <div
        className={`rounded p-3 transition-all duration-300 ${isReworking ? 'opacity-70 pointer-events-none' : 'bg-board-card border border-board-border hover:border-text-secondary'
          }`}
        style={isReworking ? {
          backgroundColor: 'var(--board-card)',
          border: `1px solid ${reviewAccent}50`,
          boxShadow: `0 0 0 1px ${reviewAccent}25, 0 0 20px 0 ${reviewAccent}15`,
        } : undefined}
      >
        {/* Scan bar for reworking */}
        {isReworking && (
          <div className="relative overflow-hidden h-[2px] -mx-3 -mt-3 mb-2 rounded-t">
            <div
              className="scan-sweep absolute inset-y-0 w-1/4"
              style={{ background: `linear-gradient(90deg, transparent, ${reviewAccent}, transparent)` }}
            />
          </div>
        )}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-1 min-w-0 mt-0.5">
            {isReworking ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="live-ping absolute inline-flex h-full w-full rounded-full" style={{ backgroundColor: reviewAccent }} />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${statusDotColors[task.status] || 'bg-status-idle'}`} />
              </span>
            ) : (
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[task.status] || 'bg-status-idle'}`} />
            )}
            <h3
              className="text-sm font-medium text-text-primary truncate flex-1 cursor-pointer hover:text-text-primary"
              onClick={() => !isReworking && onCardClick(task)}
              title={task.title}
            >
              {task.title}
            </h3>
          </div>
          {!isReworking && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(task)
              }}
              className="text-text-muted hover:text-red-400 hover:bg-board-surface/50 rounded flex items-center justify-center p-0.5 transition-colors shrink-0"
              title="Delete task"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
            </button>
          )}
        </div>

        <div className="flex items-center flex-wrap gap-2 mt-2 mb-2">
          {isReworking && (
            <span
              className="live-badge flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `${reviewAccent}20`,
                color: reviewAccent,
                border: `1px solid ${reviewAccent}40`,
              }}
            >
              <span className="live-dot inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: reviewAccent }} />
              live
            </span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${agentColors[task.agentType] || agentColors.generic}`}
          >
            {task.agentType}
          </span>
          {(() => {
            const label = agentModels[task.agentType]?.find((m) => m.value === (task.model || ''))?.label || task.model
            if (!label) return null
            return (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-board-border bg-board-surface/60 text-text-secondary">
                {label}
              </span>
            )
          })()}
          <button
            onClick={handleToggleYolo}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              task.yolo
                ? 'border-amber-700 bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
                : 'border-board-border bg-board-surface/60 text-text-muted hover:border-amber-700/50 hover:text-amber-400/60'
            }`}
            title={task.yolo ? 'YOLO mode ON — click to disable' : 'YOLO mode OFF — click to enable'}
          >
            YOLO
          </button>
          <button
            onClick={handleToggleAutoReview}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              task.autoReview
                ? 'border-blue-700 bg-blue-900/40 text-blue-400 hover:bg-blue-900/60'
                : 'border-board-border bg-board-surface/60 text-text-muted hover:border-blue-700/50 hover:text-blue-400/60'
            }`}
            title={task.autoReview ? 'Auto Review ON — click to disable' : 'Auto Review OFF — click to enable'}
          >
            AR
          </button>
          <button
            onClick={handleToggleAutoComplete}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              task.autoComplete
                ? 'border-green-700 bg-green-900/40 text-green-400 hover:bg-green-900/60'
                : 'border-board-border bg-board-surface/60 text-text-muted hover:border-green-700/50 hover:text-green-400/60'
            }`}
            title={task.autoComplete ? 'Task Complete: ON — agent will auto-finalize. Click to disable' : 'Task Complete: OFF — agent finalization disabled. Click to enable'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline-block">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
          </button>
          {task.parentTaskId && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-board-border bg-board-surface/60 text-text-muted" title={`Sub-task of ${task.parentTaskId.slice(0, 8)}`}>
              sub
            </span>
          )}
        </div>

        {/* Tags — prominent row */}
        {task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {task.tags.map((tag) => (
              <span
                key={tag.id}
                className="text-[10px] px-2 py-0.5 rounded-sm font-semibold"
                style={{
                  backgroundColor: `${tag.color}30`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Token consumption */}
        {task.totalTokens > 0 && (
          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-secondary">
            <span title={`Total: ${task.totalTokens.toLocaleString()}`}>
              Tokens: {formatTokenCount(task.totalTokens)}
            </span>
            {task.inputTokens > 0 && (
              <span className="text-text-muted" title={`Input: ${task.inputTokens.toLocaleString()}`}>
                in: {formatTokenCount(task.inputTokens)}
              </span>
            )}
            {task.outputTokens > 0 && (
              <span className="text-text-muted" title={`Output: ${task.outputTokens.toLocaleString()}`}>
                out: {formatTokenCount(task.outputTokens)}
              </span>
            )}
            {task.cacheReadTokens > 0 && (
              <span className="text-text-muted" title={`Cache read: ${task.cacheReadTokens.toLocaleString()}`}>
                cache: {formatTokenCount(task.cacheReadTokens)}
              </span>
            )}
          </div>
        )}

        {/* Agent/model selector when not running */}
        {isAwaitingFeedback && (
          <div className="flex gap-1.5 mt-2">
            <select
              className="flex-1 bg-board-bg border border-board-border rounded px-1.5 py-1 text-[11px] text-text-primary focus:outline-none focus:border-text-secondary"
              value={task.agentType}
              onChange={(e) => {
                canChangeAgent('agentType', e.target.value)
                canChangeAgent('model', '')
              }}
            >
              {agentTypes.map((at) => (
                <option key={at.value} value={at.value}>{at.label}</option>
              ))}
            </select>
            {agentModels[task.agentType].length > 0 && (
              <select
                className="flex-1 bg-board-bg border border-board-border rounded px-1.5 py-1 text-[11px] text-text-primary focus:outline-none focus:border-text-secondary"
                value={task.model || ''}
                onChange={(e) => canChangeAgent('model', e.target.value)}
              >
                {agentModels[task.agentType].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Reworking indicator */}
        {isReworking && (
          <div className="flex items-center gap-2 text-[11px] text-text-secondary mt-1">
            <span>Reworking based on feedback</span>
            <span className="flex items-end gap-px" style={{ height: 10 }}>
              {[0, 200, 400].map((delay) => (
                <span
                  key={delay}
                  className="agent-bar inline-block w-[3px] h-[10px] rounded-sm"
                  style={{ backgroundColor: reviewAccent, animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          </div>
        )}

        {/* Walkthrough when awaiting feedback */}
        {isAwaitingFeedback && walkthrough && reviewDoneCardStyle === 'expanded' && (
          <div className="mt-2">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">
              Walkthrough
            </div>
            <div className="max-h-48 overflow-y-auto bg-board-bg border border-board-border rounded p-2">
              <MarkdownRenderer content={walkthrough} compact />
            </div>
          </div>
        )}

        {/* Feedback prompt when awaiting feedback */}
        {isAwaitingFeedback && (
          <div className="mt-2">
            <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">
              Review Feedback
            </div>
            <textarea
              className="w-full bg-board-bg border border-board-border rounded px-2 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-text-secondary resize-none"
              placeholder="Enter feedback for the agent..."
              rows={3}
              value={feedbackInput}
              onChange={(e) => setFeedbackInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  handleSendFeedback()
                }
              }}
            />
            <div className="flex items-center justify-between mt-1.5">
              <div className="flex items-center gap-2">
                <DictateButton
                  status={whisper.status}
                  progress={whisper.progress}
                  onToggle={handleDictate}
                />
                <span className="text-[10px] text-text-muted">
                  {whisper.status === 'recording' ? 'Recording… click to stop' : whisper.status === 'transcribing' ? 'Transcribing…' : 'Ctrl+Enter to send'}
                </span>
              </div>
              <button
                onClick={handleSendFeedback}
                disabled={!feedbackInput.trim() || feedbackSending}
                className="px-3 py-1 text-[11px] bg-board-bg border border-board-border rounded text-text-secondary hover:text-text-primary hover:border-text-secondary disabled:opacity-30 transition-colors"
              >
                {feedbackSending ? 'Sending...' : 'Send Feedback'}
              </button>
            </div>
          </div>
        )}

        {/* Checklist progress */}
        {totalChecklist > 0 && !isReworking && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-text-secondary">
              {completedChecklist}/{totalChecklist} completed
            </span>
          </div>
        )}

        {/* Restart, Verify & Delegate buttons for review cards */}
        {isAwaitingFeedback && (
          <div className="flex justify-end gap-1.5 mt-2">
            <button
              onClick={handleVerify}
              className="px-3 py-1 text-[11px] bg-board-bg border border-board-border rounded text-blue-500/70 hover:text-blue-400 hover:border-blue-500/30 transition-colors"
            >
              Verify
            </button>
            <button
              onClick={handleRestart}
              className="px-3 py-1 text-[11px] bg-board-bg border border-board-border rounded text-green-500/70 hover:text-green-400 hover:border-green-500/30 transition-colors"
            >
              Restart
            </button>
          </div>
        )}
      </div>
    )
  }

  // Compact view (backlog, todo, done)
  if (!isActive) {
    return (
      <div
        className="bg-board-card border border-board-border rounded p-3 hover:border-text-secondary transition-colors cursor-pointer"
        onClick={() => onCardClick(task)}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-1 min-w-0 mt-0.5">
            {/* Status dot */}
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[task.status] || 'bg-status-idle'}`}
            />
            <h3 className="text-sm font-medium text-text-primary truncate flex-1">
              {task.title}
            </h3>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Schedule button — todo only */}
            {task.column === 'todo' && onScheduleTask && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onScheduleTask(task)
                }}
                className={`hover:bg-board-surface/50 rounded flex items-center justify-center p-0.5 transition-colors shrink-0 ${task.schedule?.isActive ? 'text-blue-400 hover:text-blue-300' : 'text-text-muted hover:text-text-secondary'}`}
                title={task.schedule?.isActive ? `Scheduled: ${new Date(task.schedule.scheduledAt).toLocaleString()}` : 'Schedule task'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {/* Edit settings button — backlog and todo only */}
            {(task.column === 'backlog' || task.column === 'todo') && onEditSettings && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onEditSettings(task)
                }}
                className="text-text-muted hover:text-text-secondary hover:bg-board-surface/50 rounded flex items-center justify-center p-0.5 transition-colors shrink-0"
                title="Edit task settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(task)
              }}
              className="text-text-muted hover:text-red-400 hover:bg-board-surface/50 rounded flex items-center justify-center p-0.5 transition-colors shrink-0"
              title="Delete task"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
            </button>
          </div>
        </div>

        {/* Tags — prominent row */}
        {task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {task.tags.map((tag) => (
              <span
                key={tag.id}
                className="text-[10px] px-2 py-0.5 rounded-sm font-semibold"
                style={{
                  backgroundColor: `${tag.color}30`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center flex-wrap gap-2">
            {/* Completion timestamp for done cards */}
            {task.column === 'done' && (task.completedAt || task.updatedAt) && (
              <span className="text-[10px] text-text-muted">
                {relativeTime(task.completedAt || task.updatedAt)}
              </span>
            )}
            {/* Agent badge */}
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
            <button
              onClick={handleToggleYolo}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                task.yolo
                  ? 'border-amber-700 bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
                  : 'border-board-border bg-board-surface/60 text-text-muted hover:border-amber-700/50 hover:text-amber-400/60'
              }`}
              title={task.yolo ? 'YOLO mode ON — click to disable' : 'YOLO mode OFF — click to enable'}
            >
              YOLO
            </button>
            <button
              onClick={handleToggleAutoReview}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                task.autoReview
                  ? 'border-blue-700 bg-blue-900/40 text-blue-400 hover:bg-blue-900/60'
                  : 'border-board-border bg-board-surface/60 text-text-muted hover:border-blue-700/50 hover:text-blue-400/60'
              }`}
              title={task.autoReview ? 'Auto Review ON — click to disable' : 'Auto Review OFF — click to enable'}
            >
              AR
            </button>
            <button
              onClick={handleToggleAutoComplete}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                task.autoComplete
                  ? 'border-green-700 bg-green-900/40 text-green-400 hover:bg-green-900/60'
                  : 'border-board-border bg-board-surface/60 text-text-muted hover:border-green-700/50 hover:text-green-400/60'
              }`}
              title={task.autoComplete ? 'Task Complete: ON — agent will auto-finalize. Click to disable' : 'Task Complete: OFF — agent finalization disabled. Click to enable'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline-block">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
            </button>
            {/* Waitlist clock — backlog and todo only */}
            {(task.column === 'backlog' || task.column === 'todo') && (
              <button
                onClick={handleToggleWaitlist}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  task.waitlisted
                    ? 'border-purple-700 bg-purple-900/40 text-purple-400 hover:bg-purple-900/60'
                    : 'border-board-border bg-board-surface/60 text-text-muted hover:border-purple-700/50 hover:text-purple-400/60'
                }`}
                title={task.waitlisted ? 'Waitlisted — will wait for in-progress tasks to finish. Click to disable' : 'Not waitlisted — click to enable waitlist'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline-block">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            {task.parentTaskId && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-board-border bg-board-surface/60 text-text-muted" title={`Sub-task of ${task.parentTaskId.slice(0, 8)}`}>
                sub
              </span>
            )}

            {/* Checklist progress */}
            {totalChecklist > 0 && (
              <span className="text-[10px] text-text-secondary">
                {completedChecklist}/{totalChecklist}
              </span>
            )}

            {/* Token consumption for done cards */}
            {task.totalTokens > 0 && (
              <span className="text-[10px] text-text-muted" title={`Total: ${task.totalTokens.toLocaleString()} | In: ${task.inputTokens.toLocaleString()} | Out: ${task.outputTokens.toLocaleString()}`}>
                {formatTokenCount(task.totalTokens)} tokens
              </span>
            )}

            {/* Lock icon for unmet dependencies */}
            {hasUnmetDeps && (
              <span className="text-[10px] text-text-muted" title="Has unmet dependencies">
                [locked]
              </span>
            )}

            {/* Schedule badge for todo and scheduled tasks */}
            {(task.column === 'todo' || task.column === 'scheduled') && task.schedule?.isActive && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border border-blue-800/60 bg-blue-950/40 text-blue-400 flex items-center gap-1"
                title={`Scheduled: ${new Date(task.schedule.scheduledAt).toLocaleString()}${task.schedule.recurrenceIntervalMinutes ? ' · recurring' : ''}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path fillRule="evenodd" d="M4.75 1a.75.75 0 01.75.75V3h5V1.75a.75.75 0 011.5 0V3h.25A2.25 2.25 0 0114.5 5.25v7A2.25 2.25 0 0112.25 14.5h-8.5A2.25 2.25 0 011.5 12.25v-7A2.25 2.25 0 013.75 3H4V1.75A.75.75 0 014.75 1zM3 6.5v5.75c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75V6.5H3z" clipRule="evenodd" />
                </svg>
                {formatScheduledAt(task.schedule.scheduledAt)}
                {task.schedule.recurrenceIntervalMinutes && ' ↻'}
              </span>
            )}
          </div>

          {/* Walkthrough for done cards */}
          {isDone && walkthrough && reviewDoneCardStyle === 'expanded' && (
            <div>
              <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">
                Walkthrough
              </div>
              <div className="max-h-48 overflow-y-auto bg-board-bg border border-board-border rounded p-2">
                <MarkdownRenderer content={walkthrough} compact />
              </div>
            </div>
          )}


          {task.column === 'done' && (
            <div className="flex items-center justify-end gap-1.5 shrink-0">
              {/* Restart button for done tasks */}
              {task.column === 'done' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRestart()
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-board-surface border border-board-border text-text-secondary hover:text-text-primary hover:border-text-primary transition-colors font-medium cursor-pointer"
                >
                  Restart
                </button>
              )}

              {/* Archive button for done tasks */}
              {task.column === 'done' && onArchive && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onArchive(task)
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-board-surface border border-board-border text-text-muted hover:text-text-secondary hover:border-text-secondary transition-colors font-medium cursor-pointer"
                  title="Move to archive"
                >
                  Archive
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Expanded view (in-progress column)
  const agentAccent = agentAccentColors[task.agentType] || agentAccentColors.generic

  return (
    <div
      className="bg-board-card rounded p-3 transition-all duration-300"
      style={isLive ? {
        border: `1px solid ${agentAccent}70`,
        boxShadow: `0 0 0 1px ${agentAccent}40, 0 0 28px 0 ${agentAccent}30`,
      } : {
        border: '1px solid var(--board-border)',
      }}
    >
      {/* Agent running scan bar */}
      {isLive && (
        <div className="relative overflow-hidden h-[2px] -mx-3 -mt-3 mb-3 rounded-t">
          <div
            className="scan-sweep absolute inset-y-0 w-1/4"
            style={{ background: `linear-gradient(90deg, transparent, ${agentAccent}, transparent)` }}
          />
        </div>
      )}
      {/* Header */}
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0 mt-0.5">
          {isLive ? (
            <span className="relative flex h-2 w-2 shrink-0">
              <span
                className="live-ping absolute inline-flex h-full w-full rounded-full"
                style={{ backgroundColor: agentAccent }}
              />
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${statusDotColors[task.status] || 'bg-status-idle'}`}
              />
            </span>
          ) : (
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColors[task.status] || 'bg-status-idle'}`} />
          )}
          <h3
            className="text-sm font-medium text-text-primary truncate flex-1 cursor-pointer hover:text-text-primary"
            onClick={() => onCardClick(task)}
            title={task.title}
          >
            {task.title}
          </h3>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(task)
          }}
          className="text-text-muted hover:text-red-400 hover:bg-board-surface/50 rounded flex items-center justify-center p-0.5 transition-colors shrink-0"
          title="Delete task"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
        </button>
      </div>

      <div className="flex items-center flex-wrap gap-2 mb-3">
        {/* LIVE badge when agent is running */}
        {isLive && (
          <span
            className="live-badge flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${agentAccent}20`,
              color: agentAccent,
              border: `1px solid ${agentAccent}40`,
            }}
          >
            <span
              className="live-dot inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: agentAccent }}
            />
            live
          </span>
        )}
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
        <button
          onClick={handleToggleYolo}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            task.yolo
              ? 'border-amber-700 bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
              : 'border-board-border bg-board-surface/60 text-text-muted hover:border-amber-700/50 hover:text-amber-400/60'
          }`}
          title={task.yolo ? 'YOLO mode ON — click to disable' : 'YOLO mode OFF — click to enable'}
        >
          YOLO
        </button>
        <button
          onClick={handleToggleAutoReview}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            task.autoReview
              ? 'border-blue-700 bg-blue-900/40 text-blue-400 hover:bg-blue-900/60'
              : 'border-board-border bg-board-surface/60 text-text-muted hover:border-blue-700/50 hover:text-blue-400/60'
          }`}
          title={task.autoReview ? 'Auto Review ON — click to disable' : 'Auto Review OFF — click to enable'}
        >
          AR
        </button>
        <button
          onClick={handleToggleAutoComplete}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            task.autoComplete
              ? 'border-green-700 bg-green-900/40 text-green-400 hover:bg-green-900/60'
              : 'border-board-border bg-board-surface/60 text-text-muted hover:border-green-700/50 hover:text-green-400/60'
          }`}
          title={task.autoComplete ? 'Task Complete: ON — agent will auto-finalize. Click to disable' : 'Task Complete: OFF — agent finalization disabled. Click to enable'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 inline-block">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        </button>
        {/* Waitlist indicator for in-progress tasks */}
        {task.waitlisted && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded border border-purple-700 bg-purple-900/40 text-purple-400 flex items-center gap-1"
            title="Waitlisted — waiting for other tasks to finish"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
            </svg>
            waiting
          </span>
        )}
        {task.parentTaskId && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-board-border bg-board-surface/60 text-text-muted" title={`Sub-task of ${task.parentTaskId.slice(0, 8)}`}>
            sub
          </span>
        )}
      </div>

      {/* Tags — prominent row */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="text-[10px] px-2 py-0.5 rounded-sm font-semibold"
              style={{
                backgroundColor: `${tag.color}30`,
                color: tag.color,
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Status label / Activity indicator */}
      <div className="flex items-center gap-2 text-[11px] text-text-secondary mb-3">
        <span>{statusLabels[task.status] || task.status}</span>
        {isLive && (
          <span className="flex items-end gap-px" style={{ height: 10 }}>
            {[0, 200, 400].map((delay) => (
              <span
                key={delay}
                className="agent-bar inline-block w-[3px] h-[10px] rounded-sm"
                style={{ backgroundColor: agentAccent, animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        )}
      </div>

      {/* Agent/model selector when not running */}
      {!isLive && task.status !== 'done' && (
        <div className="flex gap-1.5 mb-3">
          <select
            className="flex-1 bg-board-bg border border-board-border rounded px-1.5 py-1 text-[11px] text-text-primary focus:outline-none focus:border-text-secondary"
            value={task.agentType}
            onChange={(e) => {
              canChangeAgent('agentType', e.target.value)
              canChangeAgent('model', '')
            }}
          >
            {agentTypes.map((at) => (
              <option key={at.value} value={at.value}>{at.label}</option>
            ))}
          </select>
          {agentModels[task.agentType].length > 0 && (
            <select
              className="flex-1 bg-board-bg border border-board-border rounded px-1.5 py-1 text-[11px] text-text-primary focus:outline-none focus:border-text-secondary"
              value={task.model || ''}
              onChange={(e) => canChangeAgent('model', e.target.value)}
            >
              {agentModels[task.agentType].map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Checklist */}
      {task.checklistItems.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">
            Checklist ({completedChecklist}/{totalChecklist})
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {task.checklistItems.map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer hover:text-text-primary group"
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => handleToggleChecklist(item)}
                  className="mt-0.5 rounded-sm border-board-border"
                />
                <span className={item.done ? 'line-through text-text-muted' : ''}>
                  {item.text}
                </span>
                {item.source === 'agent' && (
                  <span className="text-[9px] text-text-muted ml-auto shrink-0" title="Agent-sourced">
                    [bot]
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Next Steps */}
      {task.nextSteps.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider mb-1.5">
            Next Steps
          </div>
          <div className="space-y-1">
            {task.nextSteps
              .filter((s) => !s.actioned)
              .map((step) => (
                <button
                  key={step.id}
                  onClick={() => handleNextStepAction(step)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded bg-board-bg border border-board-border text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors"
                  title={step.command || undefined}
                >
                  {step.command && (
                    <span className="text-text-muted font-mono mr-1">&gt;</span>
                  )}
                  {step.text}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Skills dropdown */}
      {skills.length > 0 && (
        <div className="mb-3 relative">
          <button
            onClick={() => setShowSkills(!showSkills)}
            className="text-[10px] text-text-secondary uppercase tracking-wider hover:text-text-secondary"
          >
            Skills {showSkills ? '[-]' : '[+]'}
          </button>
          {showSkills && (
            <div className="mt-1 space-y-1 bg-board-bg border border-board-border rounded p-2">
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => handleSkillAction(skill)}
                  className="w-full text-left text-xs px-2 py-1 rounded text-text-secondary hover:text-text-primary hover:bg-board-hover transition-colors"
                  title={skill.description}
                >
                  <span className="font-mono text-text-muted mr-1">&gt;</span>
                  {skill.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      <div className="mb-2">
        <div className="flex gap-1.5">
          <input
            type="text"
            className="flex-1 bg-board-bg border border-board-border rounded px-2 py-1 text-xs text-text-primary font-mono focus:outline-none focus:border-text-secondary"
            placeholder="Send command..."
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSendCommand()
              }
            }}
          />
          <button
            onClick={handleSendCommand}
            disabled={!commandInput.trim()}
            className="px-2 py-1 text-xs bg-board-bg border border-board-border rounded text-text-secondary hover:text-text-primary hover:border-text-secondary disabled:opacity-30"
          >
            Send
          </button>
        </div>
        <div className="flex gap-1.5 mt-1.5">
          {isLive && (
            <>
              <button
                onClick={handlePause}
                className="px-2 py-1 text-[10px] bg-board-bg border border-board-border rounded text-yellow-500/70 hover:text-yellow-400 hover:border-yellow-500/30"
              >
                Pause
              </button>
              <button
                onClick={handleStop}
                className="px-2 py-1 text-[10px] bg-board-bg border border-board-border rounded text-red-500/70 hover:text-red-400 hover:border-red-500/30"
              >
                Stop
              </button>
            </>
          )}
          {!isLive && task.status !== 'done' && (
            <button
              onClick={handleRestart}
              className="px-2 py-1 text-[10px] bg-board-bg border border-board-border rounded text-green-500/70 hover:text-green-400 hover:border-green-500/30"
            >
              Start
            </button>
          )}
          <button
            onClick={handleManualComplete}
            className="ml-auto px-2 py-1 text-[10px] bg-board-bg border border-green-700/60 rounded text-green-500/80 hover:text-green-300 hover:border-green-500/50 transition-colors"
            title="Manually finalize this task — moves to review and creates walkthrough"
          >
            Complete Now
          </button>
        </div>
      </div>
    </div>
  )
}
