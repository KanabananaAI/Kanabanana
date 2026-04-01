import { useState, useRef, useEffect } from 'react'
import { useSocket } from '../hooks/useSocket'
import { type AgentType, agentTypes, agentModels } from '../types/agent-config'

interface WorkspaceTerminalButtonProps {
  workspaceId: string
  defaultAgentType: AgentType
  defaultModel: string
  defaultYolo: boolean
  disabled?: boolean
}

export default function WorkspaceTerminalButton({
  workspaceId,
  defaultAgentType,
  defaultModel,
  defaultYolo,
  disabled = false,
}: WorkspaceTerminalButtonProps) {
  const socket = useSocket()
  const [open, setOpen] = useState(false)
  const [agentType, setAgentType] = useState<AgentType>(defaultAgentType)
  const [model, setModel] = useState(defaultModel)
  const [yolo, setYolo] = useState(defaultYolo)
  const [spawning, setSpawning] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Reset defaults when they change
  useEffect(() => {
    setAgentType(defaultAgentType)
    setModel(defaultModel)
    setYolo(defaultYolo)
  }, [defaultAgentType, defaultModel, defaultYolo])

  // Close popover on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Listen for spawn result
  useEffect(() => {
    if (!socket) return
    const handleResult = (data: { success: boolean; error?: string; chatId?: string }) => {
      setSpawning(false)
      if (data.success) {
        setOpen(false)
        console.log(`%c[kanaban:wterm] Workspace terminal spawned chatId=${data.chatId?.slice(0, 8)}`, 'color:#22d3ee')
      } else {
        console.warn(`[kanaban:wterm] Spawn failed: ${data.error}`)
        alert(data.error || 'Failed to spawn workspace terminal')
      }
    }
    socket.on('agent-chat:spawn:result', handleResult)
    return () => { socket.off('agent-chat:spawn:result', handleResult) }
  }, [socket])

  const handleSpawn = () => {
    if (!socket || !workspaceId || spawning) return
    setSpawning(true)
    socket.emit('agent-chat:spawn', { workspaceId, agentType, model, yolo })
  }

  const models = agentModels[agentType] || []

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`text-xs px-3 py-1 rounded border font-medium transition-colors ${
          disabled
            ? 'bg-board-surface text-text-muted border-board-border cursor-not-allowed opacity-50'
            : 'border-purple-500/50 text-purple-400 hover:bg-purple-500/10 hover:border-purple-400'
        }`}
        title={disabled ? 'Select a workspace first' : 'Open workspace terminal'}
      >
        ⌘ Terminal
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-board-surface border border-board-border rounded-lg shadow-xl p-3 min-w-[240px]">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Workspace Terminal
          </h3>

          {/* Agent Type */}
          <label className="block text-[10px] text-text-muted mb-1">Agent</label>
          <select
            value={agentType}
            onChange={(e) => {
              setAgentType(e.target.value as AgentType)
              setModel('')
            }}
            className="w-full text-xs bg-board-bg border border-board-border rounded px-2 py-1 text-text-primary mb-2"
          >
            {agentTypes.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>

          {/* Model */}
          {models.length > 0 && (
            <>
              <label className="block text-[10px] text-text-muted mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full text-xs bg-board-bg border border-board-border rounded px-2 py-1 text-text-primary mb-2"
              >
                {models.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </>
          )}

          {/* Yolo Toggle */}
          <label className="flex items-center gap-2 text-xs text-text-secondary mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={yolo}
              onChange={(e) => setYolo(e.target.checked)}
              className="rounded"
            />
            Yolo mode
          </label>

          {/* Spawn Button */}
          <button
            onClick={handleSpawn}
            disabled={spawning}
            className="w-full text-xs px-3 py-1.5 rounded bg-purple-600 text-white font-medium hover:bg-purple-500 disabled:opacity-50 transition-colors"
          >
            {spawning ? 'Spawning...' : 'Launch Terminal'}
          </button>
        </div>
      )}
    </div>
  )
}
