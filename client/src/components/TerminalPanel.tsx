import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'
import { useWhisper } from '../hooks/useWhisper'
import DictateButton from './DictateButton'
import Terminal from './Terminal'

interface SessionInfo {
  taskId: string
  title: string
  agentType: string
  status: string
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

const statusConfig: Record<string, { color: string; label: string; pulse: boolean }> = {
  executing: { color: 'bg-status-executing', label: 'Executing', pulse: true },
  thinking: { color: 'bg-status-thinking', label: 'Thinking', pulse: true },
  running: { color: 'bg-status-executing', label: 'Running', pulse: true },
  'waiting-for-input': { color: 'bg-status-thinking', label: 'Waiting', pulse: true },
  error: { color: 'bg-status-error', label: 'Error', pulse: false },
  idle: { color: 'bg-status-idle', label: 'Idle', pulse: false },
  done: { color: 'bg-status-done', label: 'Completed', pulse: false },
}

export type TerminalPosition = 'left' | 'right' | 'bottom'

const MIN_SIZE = 200
const MAX_SIDE = 900
const MAX_BOTTOM = 600
const DEFAULT_SIDE = 500
const DEFAULT_BOTTOM = 300

interface TerminalPanelProps {
  slots: (string | null)[]
  position: TerminalPosition
  onCycleSlots: () => void
  onCloseSlot: (slotIndex: number) => void
  onDropToSlot: (taskId: string, slotIndex: number) => void
}

export default function TerminalPanel({ slots, position, onCycleSlots, onCloseSlot, onDropToSlot }: TerminalPanelProps) {
  const socket = useSocket()
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({})
  const [sideWidth, setSideWidth] = useState(DEFAULT_SIDE)
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM)
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(0)
  const whisper = useWhisper()
  const [dictating, setDictating] = useState(false)
  const [dictateSlot, setDictateSlot] = useState<number>(0)
  const [inputReadyMap, setInputReadyMap] = useState<Record<string, boolean>>({})
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null)
  // Per-slot command input — filled by typing or voice dictation
  const [commandInputs, setCommandInputs] = useState<Record<string, string>>({})

  // Stabilize filledIds so effects don't re-run on every render
  const filledIds = useMemo(() => slots.filter((s): s is string => s !== null), [slots])

  // Track when server signals input is ready
  useEffect(() => {
    const handleReady = (data: { taskId: string }) => {
      if (filledIds.includes(data.taskId)) {
        setInputReadyMap((prev) => ({ ...prev, [data.taskId]: true }))
      }
    }
    const handleSpawn = (data: { taskId: string }) => {
      if (filledIds.includes(data.taskId)) {
        setInputReadyMap((prev) => ({ ...prev, [data.taskId]: false }))
      }
    }
    socket.on('task:input-ready', handleReady)
    socket.on('task:spawn:result', handleSpawn)
    return () => {
      socket.off('task:input-ready', handleReady)
      socket.off('task:spawn:result', handleSpawn)
    }
  }, [filledIds, socket])

  // Room join/leave is now handled by each Terminal component itself

  // Track session info
  useEffect(() => {
    const handleSessions = (data: SessionInfo[]) => {
      const map: Record<string, SessionInfo> = {}
      data.forEach((s) => {
        if (filledIds.includes(s.taskId)) map[s.taskId] = s
      })
      setSessions(map)
    }
    socket.on('sessions:status', handleSessions)
    socket.emit('sessions:request')
    return () => { socket.off('sessions:status', handleSessions) }
  }, [filledIds, socket])

  // Resize drag — works for horizontal (left/right) and vertical (bottom)
  const isBottom = position === 'bottom'
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startPos.current = isBottom ? e.clientY : e.clientX
    startSize.current = isBottom ? bottomHeight : sideWidth
    document.body.style.cursor = isBottom ? 'ns-resize' : 'ew-resize'
    document.body.style.userSelect = 'none'
  }, [isBottom, bottomHeight, sideWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      if (isBottom) {
        const delta = startPos.current - e.clientY
        setBottomHeight(Math.min(MAX_BOTTOM, Math.max(MIN_SIZE, startSize.current + delta)))
      } else {
        const delta = position === 'right'
          ? startPos.current - e.clientX
          : e.clientX - startPos.current
        setSideWidth(Math.min(MAX_SIDE, Math.max(MIN_SIZE, startSize.current + delta)))
      }
    }
    const onMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [isBottom, position])

  // Live-sync interim transcript into the command input while recording
  useEffect(() => {
    if (!dictating || !whisper.transcript) return
    const taskId = slots[dictateSlot]
    if (!taskId) return
    setCommandInputs(prev => ({ ...prev, [taskId]: whisper.transcript }))
  }, [whisper.transcript, dictating, dictateSlot, slots])

  // Dictation toggle — pressing record again clears the input and starts fresh
  const handleDictate = async (slotIndex: number) => {
    const taskId = slots[slotIndex]
    if (!taskId) return
    setDictateSlot(slotIndex)
    if (whisper.status === 'recording') {
      const text = await whisper.stop()
      const cleaned = (text || '').replace(/\s+/g, ' ').trim()
      setDictating(false)
      if (cleaned) setCommandInputs(prev => ({ ...prev, [taskId]: cleaned }))
    } else if (whisper.status === 'idle') {
      // Clear any previous text so each recording starts on a clean line
      setCommandInputs(prev => ({ ...prev, [taskId]: '' }))
      setDictating(true)
      await whisper.toggle()
    }
  }

  // Send a command from the input bar to the PTY
  const handleSendCommand = (taskId: string) => {
    const input = commandInputs[taskId]?.trim()
    if (!input) return
    socket.emit('task:input', { taskId, input: input + '\r' })
    setCommandInputs(prev => ({ ...prev, [taskId]: '' }))
  }

  // Enter key while recording: stop + send immediately; otherwise just send
  const handleCommandEnter = async (taskId: string, slotIndex: number) => {
    if (dictating && dictateSlot === slotIndex && whisper.status === 'recording') {
      const text = await whisper.stop()
      setDictating(false)
      const cleaned = (text || commandInputs[taskId] || '').replace(/\s+/g, ' ').trim()
      if (cleaned) socket.emit('task:input', { taskId, input: cleaned + '\r' })
      setCommandInputs(prev => ({ ...prev, [taskId]: '' }))
    } else {
      handleSendCommand(taskId)
    }
  }

  // Drop handlers
  const handleDragOver = (e: React.DragEvent, slotIndex: number) => {
    if (slots[slotIndex] !== null) return // only accept on empty slots
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverSlot(slotIndex)
  }

  const handleDragLeave = () => setDragOverSlot(null)

  const handleDrop = (e: React.DragEvent, slotIndex: number) => {
    e.preventDefault()
    setDragOverSlot(null)
    const taskId = e.dataTransfer.getData('application/kanaban-session')
    if (taskId) onDropToSlot(taskId, slotIndex)
  }

  const borderClass = isBottom ? 'border-t' : position === 'left' ? 'border-r' : 'border-l'
  const sizeStyle = isBottom ? { height: bottomHeight } : { width: sideWidth }

  const resizeHandle = isBottom ? (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 right-0 top-0 h-1.5 cursor-ns-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors z-10"
    />
  ) : position === 'left' ? (
    <div
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors z-10"
    />
  ) : (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-blue-500/30 active:bg-blue-500/50 transition-colors z-10"
    />
  )

  return (
    <div data-tour="terminal-panel" className={`shrink-0 ${borderClass} border-board-border bg-board-surface flex flex-col relative`} style={sizeStyle}>
      {resizeHandle}

      {/* Panel header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-board-border bg-board-bg">
        <span className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold">
          Terminals
        </span>
        <button
          data-tour="terminal-split-btn"
          onClick={onCycleSlots}
          className="text-[10px] font-mono text-text-secondary hover:text-text-primary px-1.5 py-0.5 hover:bg-board-card rounded transition-colors"
          title={`Split: ${slots.length} slot${slots.length > 1 ? 's' : ''} — click to cycle`}
        >
          ×{slots.length}
        </button>
      </div>

      {/* Slots area — vertical stack for left/right, horizontal for bottom */}
      <div className={`flex-1 flex ${isBottom ? 'flex-row' : 'flex-col'} min-h-0 min-w-0 relative`}>
        {slots.map((taskId, i) => {
          const session = taskId ? sessions[taskId] : null
          const cfg = session ? (statusConfig[session.status] || statusConfig.idle) : statusConfig.idle
          const agentColor = session ? (agentColors[session.agentType] || agentColors.generic) : agentColors.generic
          const inputReady = taskId ? (inputReadyMap[taskId] !== false) : true
          const isOver = dragOverSlot === i
          const slotBorder = i > 0 ? (isBottom ? 'border-l border-board-border' : 'border-t border-board-border') : ''

          return (
            <div
              key={i}
              className={`flex flex-col min-h-0 min-w-0 ${slotBorder}`}
              style={{ flex: '1 1 0%' }}
            >
              {taskId ? (
                /* Filled slot */
                <>
                  {/* Slot header */}
                  <div className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-board-border/50 bg-board-bg/50 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`} />
                    {session ? (
                      <>
                        <span className={`text-[10px] font-medium shrink-0 ${agentColor}`}>
                          {session.agentType}
                        </span>
                        <span className="text-[10px] text-text-primary truncate flex-1">
                          {session.title}
                        </span>
                        <span className="text-[10px] text-text-secondary shrink-0">{cfg.label}</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-text-secondary truncate flex-1">
                        {taskId.slice(0, 8)}...
                      </span>
                    )}
                    {!inputReady && (
                      <span className="text-[10px] text-yellow-500/70 animate-pulse shrink-0">injecting...</span>
                    )}
                    <button
                      onClick={() => onCloseSlot(i)}
                      className="text-text-secondary hover:text-text-primary text-[10px] px-1 hover:bg-board-card rounded transition-colors shrink-0"
                      title="Close terminal"
                    >
                      ✕
                    </button>
                  </div>
                  {/* Command input bar — voice dictation fills this; Enter sends to PTY */}
                  <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 border-b border-board-border/50 bg-board-bg/20">
                    <DictateButton
                      status={dictating && dictateSlot === i ? whisper.status : 'idle'}
                      progress={whisper.progress}
                      onToggle={() => handleDictate(i)}
                    />
                    <input
                      type="text"
                      className="flex-1 bg-transparent text-[11px] text-text-primary font-mono focus:outline-none min-w-0 placeholder:text-text-muted"
                      placeholder={dictating && dictateSlot === i ? 'Listening…' : 'Type or dictate a command…'}
                      value={commandInputs[taskId] || ''}
                      onChange={(e) => setCommandInputs(prev => ({ ...prev, [taskId]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleCommandEnter(taskId, i)
                        }
                        e.stopPropagation()
                      }}
                    />
                    {(commandInputs[taskId] || '').trim() && (
                      <button
                        onClick={() => handleSendCommand(taskId)}
                        className="shrink-0 text-[10px] px-1.5 py-0.5 bg-board-card border border-board-border rounded text-text-secondary hover:text-text-primary transition-colors"
                        title="Send (Enter)"
                      >
                        ↵
                      </button>
                    )}
                  </div>
                  {/* Terminal */}
                  <div className="flex-1 overflow-hidden">
                    <Terminal taskId={taskId} visible={true} fill />
                  </div>
                </>
              ) : (
                /* Empty slot — drop target */
                <div
                  className={`flex-1 flex items-center justify-center border-2 border-dashed rounded m-2 transition-colors ${
                    isOver
                      ? 'border-blue-500/60 bg-blue-500/10'
                      : 'border-board-border/40 bg-board-bg/30'
                  }`}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, i)}
                >
                  <div className="text-center">
                    <div className={`text-xs mb-1 ${isOver ? 'text-blue-400' : 'text-text-muted'}`}>
                      {isOver ? 'Drop here' : 'Drop agent here'}
                    </div>
                    <div className="text-[10px] text-text-muted/60">
                      Drag from agent panel
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
