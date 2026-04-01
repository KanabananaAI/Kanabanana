import { useEffect, useState, useCallback, useRef } from 'react'
import { useSocket } from '../hooks/useSocket'
import type { Plan } from '../types'
import { type AgentType, agentTypes, agentModels, lmStudioToOptions, type LmStudioModel } from '../types/agent-config'
import { useWhisper } from '../hooks/useWhisper'
import DictateButton from './DictateButton'
import Terminal from './Terminal'

interface TaskPlannerModalProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  onCreateTask: (plan: Plan) => void
  defaultAgentType?: AgentType
  defaultModel?: string
}

type ModalStatus = 'idle' | 'interviewing' | 'generating' | 'ready' | 'error'

export default function TaskPlannerModal({
  isOpen,
  onClose,
  workspaceId,
  onCreateTask,
  defaultAgentType = 'claude',
  defaultModel = '',
}: TaskPlannerModalProps) {
  const socket = useSocket()
  const [prompt, setPrompt] = useState('')
  const [agentType, setAgentType] = useState<AgentType>(defaultAgentType)
  const [model, setModel] = useState(defaultModel)
  const [status, setStatus] = useState<ModalStatus>('idle')
  const [error, setError] = useState('')
  const [generatedPlan, setGeneratedPlan] = useState<Plan | null>(null)
  const [savedPlans, setSavedPlans] = useState<Plan[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Array<{ role: 'agent' | 'user'; text: string }>>([])
  const [answerInput, setAnswerInput] = useState('')
  const [isAgentMinimized, setIsAgentMinimized] = useState(false)
  const answerInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Editable fields for the generated plan
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editChecklist, setEditChecklist] = useState<string[]>([])
  const [newChecklistItem, setNewChecklistItem] = useState('')
  const [lmStudioModels, setLmStudioModels] = useState<{ value: string; label: string }[]>([])

  const promptRef = useRef<HTMLTextAreaElement>(null)
  const whisper = useWhisper()
  const whisperBaseRef = useRef('')

  // Fetch LM Studio models when agent type is lmstudio
  useEffect(() => {
    if (agentType !== 'lmstudio') {
      setLmStudioModels([])
      return
    }
    let cancelled = false
    fetch('/api/lmstudio/models')
      .then((r) => r.json())
      .then((data: { available: boolean; models: LmStudioModel[] }) => {
        if (!cancelled && data.available) {
          const opts = lmStudioToOptions(data.models)
          setLmStudioModels(opts)
          // Auto-select first model if none selected
          if (opts.length > 0 && !model) {
            setModel(opts[0].value)
          }
        }
      })
      .catch(() => { /* LM Studio not available */ })
    return () => { cancelled = true }
  }, [agentType, model])

  useEffect(() => {
    if (!whisper.transcript) return
    const base = whisperBaseRef.current
    setPrompt(base ? base + '\n' + whisper.transcript : whisper.transcript)
  }, [whisper.transcript])

  const handleDictate = async () => {
    if (whisper.status === 'recording') {
      const finalText = await whisper.toggle()
      if (finalText) {
        const base = whisperBaseRef.current
        setPrompt(base ? base + '\n' + finalText : finalText)
      }
    } else {
      whisperBaseRef.current = prompt
      await whisper.toggle()
    }
  }

  const fetchSavedPlans = useCallback(() => {
    if (!workspaceId) return
    fetch(`/api/plans?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((data: Plan[]) => {
        setSavedPlans(data.filter((p) => p.status === 'ready' || p.status === 'used'))
      })
      .catch(() => { })
  }, [workspaceId])

  useEffect(() => {
    if (isOpen) {
      fetchSavedPlans()
      requestAnimationFrame(() => promptRef.current?.focus())
    } else {
      // Kill any in-progress planner session when the modal closes
      if (activePlanId) {
        socket.emit('plan:kill', { planId: activePlanId })
      }
      // Stop any active recording when modal closes
      if (whisper.status === 'recording') {
        whisper.stop()
      }
      // Reset state when closing
      setPrompt('')
      setStatus('idle')
      setError('')
      setGeneratedPlan(null)
      setActivePlanId(null)
      setEditTitle('')
      setEditDescription('')
      setEditChecklist([])
      setNewChecklistItem('')
      setMessages([])
      setAnswerInput('')
    }
  }, [isOpen, fetchSavedPlans, activePlanId, socket, whisper])

  // Listen for plan socket events
  useEffect(() => {
    const handlePlanReady = (plan: Plan) => {
      if (plan.id !== activePlanId) return
      setGeneratedPlan(plan)
      setEditTitle(plan.title)
      setEditDescription(plan.description)
      setEditChecklist(plan.checklistItems.map((c) => c.text))
      setStatus('ready')
      fetchSavedPlans()
    }

    const handlePlanFailed = (data: { planId: string; error: string }) => {
      if (data.planId !== activePlanId) return
      setError(data.error || 'Plan generation failed')
      setStatus('error')
    }

    const handlePlanMessage = (data: { planId: string; text: string }) => {
      if (data.planId !== activePlanId) return
      setMessages((prev) => [...prev, { role: 'agent', text: data.text }])
      setStatus('interviewing')
      requestAnimationFrame(() => answerInputRef.current?.focus())
    }

    const handlePlanPhaseChange = (data: { planId: string }) => {
      if (data.planId !== activePlanId) return
      setStatus('generating')
    }

    socket.on('plan:ready', handlePlanReady)
    socket.on('plan:failed', handlePlanFailed)
    socket.on('plan:message', handlePlanMessage)
    socket.on('plan:phase-change', handlePlanPhaseChange)

    return () => {
      socket.off('plan:ready', handlePlanReady)
      socket.off('plan:failed', handlePlanFailed)
      socket.off('plan:message', handlePlanMessage)
      socket.off('plan:phase-change', handlePlanPhaseChange)
    }
  }, [socket, activePlanId, fetchSavedPlans])

  const handleGenerate = async () => {
    if (!prompt.trim() || !workspaceId) return
    setStatus('generating')
    setError('')
    setGeneratedPlan(null)

    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), agentType, model, workspaceId }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create plan')
      }
      const plan: Plan = await res.json()
      setActivePlanId(plan.id)

      // Trigger PTY spawn
      socket.emit('plan:spawn', { planId: plan.id, agentType, model, workspaceId })
    } catch (err) {
      setError(String(err))
      setStatus('error')
    }
  }

  const handleSendAnswer = () => {
    const answer = answerInput.trim()
    if (!answer || !activePlanId) return
    socket.emit('plan:answer', { planId: activePlanId, answer })
    setMessages((prev) => [...prev, { role: 'user', text: answer }])
    setAnswerInput('')
  }

  const handleGenerateNow = () => {
    if (!activePlanId) return
    socket.emit('plan:generate-now', { planId: activePlanId })
    setStatus('generating')
  }

  const handleSavePlan = () => {
    // Plan is already saved as 'ready' in DB; just close
    fetchSavedPlans()
    setStatus('idle')
    setGeneratedPlan(null)
    setActivePlanId(null)
    setPrompt('')
  }

  const handleCreateTaskNow = async () => {
    if (!generatedPlan) return

    // Apply edits to the plan object
    const planToUse: Plan = {
      ...generatedPlan,
      title: editTitle,
      description: editDescription,
      checklistItems: editChecklist.map((text, i) => ({
        id: `edit-${i}`,
        planId: generatedPlan.id,
        text,
        position: i,
      })),
    }

    // Mark plan as used
    try {
      await fetch(`/api/plans/${generatedPlan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'used', usedAt: new Date().toISOString() }),
      })
    } catch { /* non-critical */ }

    onCreateTask(planToUse)
  }

  const handleUseSavedPlan = async (plan: Plan) => {
    setGeneratedPlan(plan)
    setEditTitle(plan.title)
    setEditDescription(plan.description)
    setEditChecklist(plan.checklistItems.map((c) => c.text))
    setStatus('ready')
    setActivePlanId(plan.id)
  }

  const handleDeleteSavedPlan = async (planId: string) => {
    try {
      await fetch(`/api/plans/${planId}`, { method: 'DELETE' })
      setSavedPlans((prev) => prev.filter((p) => p.id !== planId))
    } catch { /* ignore */ }
  }

  const handleAddChecklistItem = () => {
    if (newChecklistItem.trim()) {
      setEditChecklist((prev) => [...prev, newChecklistItem.trim()])
      setNewChecklistItem('')
    }
  }

  const handleRemoveChecklistItem = (idx: number) => {
    setEditChecklist((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`w-full ${isAgentMinimized ? 'max-w-3xl' : 'max-w-[1400px]'} h-[85vh] bg-board-card border border-board-border rounded-lg flex flex-row transition-all duration-300 relative`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left column — planner form */}
        <div className={`flex flex-col ${isAgentMinimized ? 'w-full' : 'flex-1 border-r border-board-border'}`}>
          <div className="flex-1 overflow-y-auto p-6">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="text-blue-400 text-lg">✦</span>
                <h2 className="text-lg font-semibold text-text-primary">Task Planner</h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsAgentMinimized(!isAgentMinimized)}
                  className="px-2 py-1 text-[10px] uppercase tracking-wider font-medium text-text-secondary hover:text-text-primary border border-board-border rounded bg-board-bg"
                >
                  {isAgentMinimized ? 'Show Agent' : 'Hide Agent'}
                </button>
                <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-lg">
                  x
                </button>
              </div>
            </div>

            {/* Agent + Model dropdowns */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-xs text-text-secondary mb-1">Agent</label>
                <select
                  className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500"
                  value={agentType}
                  onChange={(e) => { setAgentType(e.target.value as AgentType); setModel('') }}
                  disabled={status === 'generating' || status === 'interviewing'}
                >
                  {agentTypes.map((at) => (
                    <option key={at.value} value={at.value}>{at.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {(agentModels[agentType]?.length > 0 || agentType === 'lmstudio') && (
              <div className="flex-1">
                <label className="block text-xs text-text-secondary mb-1">Model</label>
                {agentType === 'lmstudio' ? (
                  <>
                    <select
                      className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={status === 'generating' || status === 'interviewing'}
                    >
                      {lmStudioModels.length === 0 && (
                        <option value="">No models found — is LM Studio running?</option>
                      )}
                      {lmStudioModels.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <select
                    className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={status === 'generating' || status === 'interviewing'}
                  >
                    {agentModels[agentType].map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Prompt textarea */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-text-secondary">Describe what you want to build or accomplish</label>
              <DictateButton
                status={whisper.status}
                progress={whisper.progress}
                onToggle={handleDictate}
              />
            </div>
            <textarea
              ref={promptRef}
              className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500 resize-none"
              rows={4}
              placeholder="e.g. Add user authentication with JWT tokens, including login/logout endpoints and protected routes..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={status === 'generating' || status === 'interviewing'}
            />
          </div>

          {/* Generate button */}
          {status !== 'ready' && status !== 'interviewing' && (
            <div className="flex justify-center mb-6">
              {status === 'generating' ? (
                <div className="flex items-center gap-2 text-blue-400 text-sm">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span>Generating plan...</span>
                </div>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || !workspaceId}
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Generate Plan
                </button>
              )}
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
              <p className="font-medium mb-1">Generation failed</p>
              <p className="text-xs">{error}</p>
              <button
                onClick={() => { setStatus('idle'); setError('') }}
                className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Interview chat */}
          {status === 'interviewing' && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">Clarifying Questions</span>
              </div>

              {/* Message thread */}
              <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'agent' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${msg.role === 'agent'
                        ? 'bg-blue-500/10 text-blue-200 border border-blue-500/20'
                        : 'bg-board-bg text-text-primary border border-board-border'
                        }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Answer input */}
              <div className="flex gap-2 mb-2">
                <input
                  ref={answerInputRef}
                  type="text"
                  className="flex-1 bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500"
                  placeholder="Type your answer..."
                  value={answerInput}
                  onChange={(e) => setAnswerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendAnswer()
                    }
                  }}
                />
                <button
                  onClick={handleSendAnswer}
                  disabled={!answerInput.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                >
                  Send
                </button>
              </div>

              {/* Escape hatch */}
              <div className="flex justify-end">
                <button
                  onClick={handleGenerateNow}
                  className="text-xs text-text-secondary hover:text-text-primary underline transition-colors"
                >
                  Generate Plan Now
                </button>
              </div>
            </div>
          )}

          {/* Generated plan result */}
          {status === 'ready' && generatedPlan && (
            <>
              <div className="border-t border-board-border pt-5 mb-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">Generated Plan</span>
                </div>

                {/* Editable title */}
                <div className="mb-3">
                  <label className="block text-xs text-text-secondary mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>

                {/* Editable description */}
                <div className="mb-3">
                  <label className="block text-xs text-text-secondary mb-1">Description</label>
                  <textarea
                    className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500 resize-none"
                    rows={4}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </div>

                {/* Editable checklist */}
                <div className="mb-4">
                  <label className="block text-xs text-text-secondary mb-1">Checklist</label>
                  <div className="space-y-1 mb-2">
                    {editChecklist.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-text-primary">
                        <span className="text-text-muted text-xs">-</span>
                        <span className="flex-1">{item}</span>
                        <button
                          onClick={() => handleRemoveChecklistItem(idx)}
                          className="text-text-muted hover:text-text-secondary text-xs"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-board-bg border border-board-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-blue-500"
                      placeholder="Add checklist item"
                      value={newChecklistItem}
                      onChange={(e) => setNewChecklistItem(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklistItem() } }}
                    />
                    <button
                      onClick={handleAddChecklistItem}
                      className="px-3 py-1.5 text-sm bg-board-bg border border-board-border rounded text-text-secondary hover:text-text-primary"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Suggested tags */}
                {generatedPlan.suggestedTags.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-xs text-text-secondary mb-1">Suggested Tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {generatedPlan.suggestedTags.map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested deps */}
                {generatedPlan.suggestedDeps.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-xs text-text-secondary mb-1">Suggested Dependencies</label>
                    <ul className="text-xs text-text-secondary space-y-0.5 list-disc list-inside">
                      {generatedPlan.suggestedDeps.map((dep, i) => (
                        <li key={i}>{dep}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3 mb-6">
                <button
                  onClick={handleSavePlan}
                  className="flex-1 px-4 py-2 text-sm border border-board-border text-text-secondary rounded hover:text-text-primary hover:border-text-secondary transition-colors"
                >
                  Save Plan
                </button>
                <button
                  onClick={handleCreateTaskNow}
                  disabled={!editTitle.trim()}
                  className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                >
                  Create Task Now
                </button>
              </div>
            </>
          )}

          {/* Saved plans section */}
          {savedPlans.length > 0 && (
            <div className="border-t border-board-border pt-4">
              <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
                Saved Plans
              </h3>
              <div className="space-y-2">
                {savedPlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between p-2.5 bg-board-bg border border-board-border rounded hover:border-blue-500/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">
                          {plan.title || plan.originalPrompt.substring(0, 40) + '...'}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {plan.status === 'used' ? 'Used · ' : ''}{new Date(plan.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <button
                        onClick={() => handleUseSavedPlan(plan)}
                        className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 border border-blue-500/30 rounded hover:border-blue-400 transition-colors"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => handleDeleteSavedPlan(plan.id)}
                        className="text-xs text-text-muted hover:text-red-400 transition-colors"
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>{/* end overflow-y-auto */}
      </div>{/* end left column */}

      {/* Right column — live agent terminal output */}
      {!isAgentMinimized && (
        <div className="w-[500px] shrink-0 flex flex-col bg-[#0a0a0a] rounded-r-lg border-l border-board-border">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-board-border shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
            <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">Agent Output</span>
          </div>
          <div className="flex-1 overflow-hidden relative">
            {activePlanId ? (
              <Terminal taskId={`plan:${activePlanId}`} visible={true} fill={true} />
            ) : (
              <div className="flex items-center justify-center h-full text-text-muted text-sm">
                Waiting for agent...
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
