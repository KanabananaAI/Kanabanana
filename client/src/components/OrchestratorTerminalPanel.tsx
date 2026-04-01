import { useCallback, useEffect, useRef, useState } from 'react'
import { useSocket } from '../hooks/useSocket'
import OrchestratorTerminal from './OrchestratorTerminal'
import OrchestratorActivityFeed from './OrchestratorActivityFeed'

const MIN_HEIGHT = 150
const MAX_HEIGHT = 800
const DEFAULT_HEIGHT = 300

const providers = [
  { value: 'claude', label: 'Claude' },
  { value: 'kilo', label: 'Kilo Code' },
]

const modelsByProvider: Record<string, { value: string; label: string }[]> = {
  claude: [
    { value: '', label: 'Default' },
    { value: 'sonnet', label: 'Sonnet 4.6' },
    { value: 'opus', label: 'Opus 4.6' },
    { value: 'haiku', label: 'Haiku 4.5' },
  ],
  kilo: [
    { value: '', label: 'Default (config-driven)' },
    { value: 'kilo-auto/frontier', label: 'Auto Frontier' },
    { value: 'kilo-auto/small', label: 'Auto Small' },
    { value: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
    { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
    { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  ],
}

interface OrchestratorTerminalPanelProps {
  onClose: () => void
  orchestratorRunning: boolean
  orchestratorEnabled: boolean
}

export default function OrchestratorTerminalPanel({ onClose, orchestratorRunning, orchestratorEnabled }: OrchestratorTerminalPanelProps) {
  const socket = useSocket()
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [provider, setProvider] = useState(() => localStorage.getItem('kanaban:orch-provider') || 'claude')
  const [model, setModel] = useState(() => localStorage.getItem('kanaban:orch-model') || '')
  const [customModel, setCustomModel] = useState(() => localStorage.getItem('kanaban:orch-custom-model') || '')
  const isCustom = model === '__custom__'
  const availableModels = modelsByProvider[provider] || [{ value: '', label: 'Default' }]
  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

  // Persist settings
  useEffect(() => {
    localStorage.setItem('kanaban:orch-provider', provider)
  }, [provider])
  useEffect(() => {
    localStorage.setItem('kanaban:orch-model', model)
  }, [model])
  useEffect(() => {
    localStorage.setItem('kanaban:orch-custom-model', customModel)
  }, [customModel])

  // Join/leave orchestrator room
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('%c[kanaban:orch-panel] Joining orchestrator room', 'color:#a855f7')
      socket.emit('orchestrator:join')
    }, 200)
    return () => {
      clearTimeout(timer)
      console.log('%c[kanaban:orch-panel] Leaving orchestrator room', 'color:#a855f7')
      socket.emit('orchestrator:leave')
    }
  }, [socket])

  // LM Studio models not needed for orchestrator (only Claude/Kilo)

  // Drag-to-resize handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startY.current = e.clientY
    startHeight.current = height
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }, [height])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startY.current - e.clientY
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight.current + delta))
      setHeight(newHeight)
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
  }, [])

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    setModel('')
    setCustomModel('')
  }

  const handleStart = () => {
    const resolvedModel = isCustom ? customModel : model
    socket.emit('orchestrator:spawn', {
      provider,
      model: resolvedModel || undefined,
    })
  }

  const handleStop = () => {
    socket.emit('orchestrator:kill')
  }

  const handleToggleEnable = () => {
    socket.emit('orchestrator:toggle', { enabled: !orchestratorEnabled })
  }

  return (
    <div className="shrink-0 border-t border-board-border bg-board-surface flex flex-col" style={{ height }}>
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="shrink-0 h-1.5 cursor-ns-resize hover:bg-purple-500/30 active:bg-purple-500/50 transition-colors"
      />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-board-border bg-board-bg">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[10px] text-text-secondary uppercase tracking-wider font-semibold">Orchestrator</span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${!orchestratorEnabled ? 'bg-red-500' : orchestratorRunning ? 'bg-green-500 animate-pulse' : 'bg-text-muted'}`} />
          <span className="text-[10px] text-text-secondary">
            {!orchestratorEnabled ? 'Disabled' : orchestratorRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {orchestratorEnabled && !orchestratorRunning && (
            <>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="text-[10px] bg-board-bg text-text-primary border border-board-border rounded px-1.5 py-0.5 focus:outline-none focus:border-text-secondary appearance-auto"
              >
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="text-[10px] bg-board-bg text-text-primary border border-board-border rounded px-1.5 py-0.5 focus:outline-none focus:border-text-secondary appearance-auto"
              >
                {availableModels.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                <option value="__custom__">Custom...</option>
              </select>
              {isCustom && (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="model id"
                  className="text-[10px] bg-board-bg text-text-primary border border-board-border rounded px-1.5 py-0.5 w-36 focus:outline-none focus:border-text-secondary placeholder-text-muted"
                />
              )}
            </>
          )}
          {orchestratorRunning ? (
            <button
              onClick={handleStop}
              className="text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 border border-red-500/30 rounded hover:border-red-500/50 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="text-[10px] text-green-400 hover:text-green-300 px-2 py-0.5 border border-green-500/30 rounded hover:border-green-500/50 transition-colors"
            >
              Start
            </button>
          )}

          <button
            onClick={handleToggleEnable}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ml-2 ${orchestratorEnabled ? 'bg-green-500' : 'bg-board-border'}`}
            title={orchestratorEnabled ? 'Disable Orchestrator' : 'Enable Orchestrator'}
          >
            <span className="sr-only">Enable Orchestrator</span>
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${orchestratorEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`}
            />
          </button>

          <div className="w-px h-3 bg-board-border mx-1" />

          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary text-xs px-1.5 py-0.5 hover:bg-board-card rounded transition-colors"
            title="Close orchestrator"
          >
            &#10005;
          </button>
        </div>
      </div>

      {/* Content: Terminal + Activity Feed */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        <div className="flex-1 overflow-hidden">
          <OrchestratorTerminal visible={true} fill />
        </div>
        <div className="w-64 shrink-0 border-l border-board-border overflow-visible flex flex-col">
          <OrchestratorActivityFeed />
        </div>
      </div>
    </div>
  )
}
