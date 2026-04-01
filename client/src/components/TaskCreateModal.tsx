import { useEffect, useRef, useState, useCallback } from 'react'
import type { Task, Template, Tag, Plan } from '../types'
import { useWhisper } from '../hooks/useWhisper'
import DictateButton from './DictateButton'
import { type AgentType, agentTypes, agentModels, commandPlaceholders, lmStudioToOptions, type LmStudioModel } from '../types/agent-config'

interface TaskCreateModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (task: Partial<Task>, images?: File[]) => void
  onEdit?: (taskId: string, task: Partial<Task> & { tags?: Tag[] }, images?: File[]) => void
  editTask?: Task
  existingTasks: Task[]
  templates: Template[]
  defaultAgentType?: AgentType
  defaultModel?: string
  defaultYolo?: boolean
  prefillPlan?: Plan | null
  workspaceId?: string
}

export default function TaskCreateModal({
  isOpen,
  onClose,
  onCreate,
  onEdit,
  editTask,
  existingTasks,
  templates,
  defaultAgentType = 'claude',
  defaultModel = '',
  defaultYolo = false,
  prefillPlan = null,
  workspaceId = '',
}: TaskCreateModalProps) {
  const [mode, setMode] = useState<'scratch' | 'template' | 'plan'>('scratch')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agentType, setAgentType] = useState<AgentType>(defaultAgentType)
  const [model, setModel] = useState(defaultModel)
  const [command, setCommand] = useState('')
  const [checklistItems, setChecklistItems] = useState<string[]>([])
  const [newChecklistItem, setNewChecklistItem] = useState('')
  const focusedChecklistIndexRef = useRef<number | null>(null)
  const [yolo, setYolo] = useState(defaultYolo)
  const [autoReview, setAutoReview] = useState(false)
  const [autoComplete, setAutoComplete] = useState(true)
  const [waitlisted, setWaitlisted] = useState(false)
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const whisper = useWhisper()
  type DictateTarget = 'title' | 'description' | 'command' | 'checklist'
  const [dictateTarget, setDictateTarget] = useState<DictateTarget | null>(null)
  const baseTextRef = useRef('')
  const [customModel, setCustomModel] = useState('')
  const [lmStudioModels, setLmStudioModels] = useState<{ value: string; label: string }[]>([])
  const isCustom = model === '__custom__'
  const [pastedText, setPastedText] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [savedPlans, setSavedPlans] = useState<Plan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState('')

  const getFieldValue = (target: DictateTarget) => {
    switch (target) {
      case 'title': return title
      case 'description': return description
      case 'command': return command
      case 'checklist': {
        const idx = focusedChecklistIndexRef.current
        return idx !== null ? (checklistItems[idx] ?? '') : newChecklistItem
      }
    }
  }

  const setFieldValue = (target: DictateTarget, value: string) => {
    switch (target) {
      case 'title': setTitle(value); break
      case 'description': setDescription(value); break
      case 'command': setCommand(value); break
      case 'checklist': {
        const idx = focusedChecklistIndexRef.current
        if (idx !== null) {
          setChecklistItems((prev) => prev.map((item, i) => i === idx ? value : item))
        } else {
          setNewChecklistItem(value)
        }
        break
      }
    }
  }

  // Live-update the target field as transcript changes during recording
  useEffect(() => {
    if (!dictateTarget || !whisper.transcript) return
    const base = baseTextRef.current
    const sep = dictateTarget === 'description' ? '\n' : ' '
    const combined = base ? base + sep + whisper.transcript : whisper.transcript
    setFieldValue(dictateTarget, combined)
  }, [whisper.transcript, dictateTarget])

  const handleDictate = async (target: DictateTarget) => {
    if (whisper.status === 'recording') {
      const finalText = await whisper.toggle()
      if (finalText && dictateTarget) {
        const base = baseTextRef.current
        const sep = dictateTarget === 'description' ? '\n' : ' '
        const combined = base ? base + sep + finalText : finalText
        setFieldValue(dictateTarget, combined)
      }
      setDictateTarget(null)
    } else {
      baseTextRef.current = getFieldValue(target)
      setDictateTarget(target)
      await whisper.toggle()
    }
  }

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
      })
      fetch('/api/tags')
        .then((r) => r.json())
        .then((data: Tag[]) => setAvailableTags(data))
        .catch(() => {})
    }
  }, [isOpen])

  // Auto-fill from prefillPlan when provided
  useEffect(() => {
    if (!isOpen || !prefillPlan) return
    setMode('plan')
    setTitle(prefillPlan.title)
    setDescription(prefillPlan.description)
    setChecklistItems(prefillPlan.checklistItems.map((c) => c.text))
  }, [isOpen, prefillPlan])

  // Fetch saved plans when switching to plan mode
  useEffect(() => {
    if (mode !== 'plan') return
    fetch(`/api/plans?workspaceId=${workspaceId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: Plan[]) => setSavedPlans(data.filter((p) => p.status === 'ready')))
      .catch(() => {})
  }, [mode, workspaceId])

  useEffect(() => {
    if (!isOpen) {
      // Stop any active recording when modal closes
      if (whisper.status === 'recording') {
        whisper.stop()
      }
      setDictateTarget(null)
      setTitle('')
      setDescription('')
      setAgentType(defaultAgentType)
      setModel(defaultModel)
      setCommand('')
      setChecklistItems([])
      setNewChecklistItem('')
      setYolo(defaultYolo)
      setAutoReview(false)
      setAutoComplete(true)
      setWaitlisted(false)
      setDependsOn([])
      setSelectedTemplateId('')
      setSelectedPlanId('')
      setSavedPlans([])
      setMode('scratch')
      setPastedText('')
      // Revoke object URLs to prevent memory leaks
      imagePreviews.forEach((url) => URL.revokeObjectURL(url))
      setImageFiles([])
      setImagePreviews([])
      setSelectedTagIds([])
    }
  }, [isOpen, defaultAgentType, defaultModel, defaultYolo])

  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

  const addImages = useCallback((files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type))
    if (validFiles.length === 0) return
    setImageFiles((prev) => [...prev, ...validFiles])
    setImagePreviews((prev) => [...prev, ...validFiles.map((f) => URL.createObjectURL(f))])
  }, [])

  const removeImage = useCallback((index: number) => {
    setImagePreviews((prev) => {
      URL.revokeObjectURL(prev[index])
      return prev.filter((_, i) => i !== index)
    })
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) addImages(e.dataTransfer.files)
  }, [addImages])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      addImages(files)
    }
  }, [addImages])

  // Initialize fields from editTask when opening in edit mode
  useEffect(() => {
    if (!isOpen || !editTask) return
    setTitle(editTask.title)
    setDescription(editTask.description || '')
    setPastedText(editTask.pastedText || '')
    setAgentType(editTask.agentType as AgentType)
    setCommand(editTask.command || '')
    setYolo(editTask.yolo)
    setAutoReview(editTask.autoReview)
    setAutoComplete(editTask.autoComplete)
    setWaitlisted(editTask.waitlisted)
    setDependsOn(editTask.dependsOn || [])
    setChecklistItems(
      (editTask.checklistItems || []).filter((ci) => ci.source === 'manual').map((ci) => ci.text)
    )
    setSelectedTagIds((editTask.tags || []).map((t) => t.id))
    setMode('scratch')
    // Handle custom model
    const knownValues = (agentModels[editTask.agentType as AgentType] || []).map((m) => m.value)
    if (editTask.model && !knownValues.includes(editTask.model)) {
      setModel('__custom__')
      setCustomModel(editTask.model)
    } else {
      setModel(editTask.model || '')
      setCustomModel('')
    }
  }, [isOpen, editTask])

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
  }, [agentType])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const template = templates.find((t) => t.id === templateId)
    if (template) {
      setTitle(template.name)
      setDescription(template.description)
      setAgentType(template.agentType as AgentType)
      setCommand(template.command)
      setChecklistItems(template.checklistDefaults)
    }
  }

  const handleAddChecklistItem = () => {
    if (newChecklistItem.trim()) {
      setChecklistItems((prev) => [...prev, newChecklistItem.trim()])
      setNewChecklistItem('')
    }
  }

  const handleRemoveChecklistItem = (index: number) => {
    setChecklistItems((prev) => prev.filter((_, i) => i !== index))
  }

  const toggleDependency = (taskId: string) => {
    setDependsOn((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    )
  }

  const handleSubmit = () => {
    if (!title.trim()) return
    const resolvedModel = isCustom ? customModel.trim() : model
    const sharedData = {
      title: title.trim(),
      description: description.trim(),
      pastedText: pastedText.trim() || undefined,
      agentType,
      model: resolvedModel,
      command: command.trim(),
      yolo,
      autoReview,
      autoComplete,
      waitlisted,
      dependsOn,
      checklistItems: checklistItems.map((text, i) => ({
        id: `temp-${i}`,
        taskId: '',
        text,
        done: false,
        source: 'manual' as const,
        position: i,
      })),
      tags: selectedTagIds.map((id) => availableTags.find((t) => t.id === id)!).filter(Boolean),
    }
    const newImages = imageFiles.length > 0 ? imageFiles : undefined
    if (editTask && onEdit) {
      onEdit(editTask.id, sharedData as Partial<Task> & { tags?: Tag[] }, newImages)
    } else {
      onCreate({
        ...sharedData,
        delegated: false,
        column: 'backlog',
        templateId: selectedTemplateId || undefined,
      } as Partial<Task> & { tags?: Tag[] }, newImages)
    }
    onClose()
  }

  // Prevent browser back gesture / back button from navigating away while modal is open
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen) return

    window.history.pushState({ modal: 'create-task' }, '')

    let poppedByBack = false

    const handlePopState = () => {
      poppedByBack = true
      onCloseRef.current()
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      // If modal closed via Escape/Cancel/backdrop (not back), remove our history entry
      if (!poppedByBack && window.history.state?.modal === 'create-task') {
        window.history.back()
      }
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  if (!isOpen) return null

  // Detect placeholders in command
  const placeholders = command.match(/\{(\w+)\}/g) || []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-board-card border border-board-border rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-text-primary">
            {editTask ? 'Edit Task Settings' : 'Create Task'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary text-lg"
          >
            x
          </button>
        </div>

        {/* Mode tabs — hidden when editing */}
        {!editTask && (
          <div className="flex gap-2 mb-5">
            <button
              className={`px-3 py-1.5 text-sm rounded ${mode === 'scratch'
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-200'
                  : 'bg-board-bg text-text-secondary hover:text-text-primary'
                }`}
              onClick={() => setMode('scratch')}
            >
              From Scratch
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded ${mode === 'template'
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-200'
                  : 'bg-board-bg text-text-secondary hover:text-text-primary'
                }`}
              onClick={() => setMode('template')}
            >
              From Template
            </button>
            <button
              className={`px-3 py-1.5 text-sm rounded ${mode === 'plan'
                ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                : 'bg-board-bg text-text-secondary hover:text-text-primary'
              }`}
              onClick={() => setMode('plan')}
            >
              From Plan
            </button>
          </div>
        )}

        {/* Template selector */}
        {mode === 'template' && (
          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1">Template</label>
            <select
              className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
              value={selectedTemplateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
            >
              <option value="">Select a template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Plan selector */}
        {mode === 'plan' && (
          <div className="mb-4">
            {prefillPlan ? (
              <div className="flex items-center gap-2 p-2.5 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-400">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <span>Pre-filled from plan: <strong>{prefillPlan.title}</strong></span>
              </div>
            ) : savedPlans.length === 0 ? (
              <p className="text-xs text-text-muted">No saved plans available. Use the Task Planner to generate one.</p>
            ) : (
              <>
                <label className="block text-xs text-text-secondary mb-1">Select a plan</label>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {savedPlans.map((plan) => (
                    <div
                      key={plan.id}
                      onClick={() => {
                        setSelectedPlanId(plan.id)
                        setTitle(plan.title)
                        setDescription(plan.description)
                        setChecklistItems(plan.checklistItems.map((c) => c.text))
                      }}
                      className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer transition-colors ${selectedPlanId === plan.id ? 'bg-blue-500/10 border-blue-500/40 text-blue-300' : 'bg-board-bg border-board-border text-text-primary hover:border-blue-500/30'}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{plan.title || plan.originalPrompt.substring(0, 40) + '...'}</p>
                        <p className="text-[10px] text-text-muted">{new Date(plan.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Title */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1">Title</label>
          <div className="flex gap-2">
            <input
              ref={titleInputRef}
              type="text"
              className="flex-1 bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <DictateButton
              status={dictateTarget === 'title' ? whisper.status : 'idle'}
              progress={whisper.progress}
              onToggle={() => handleDictate('title')}
            />
          </div>
        </div>

        {/* Description */}
        <div className="mb-4">
          <div className="flex items-start justify-between mb-1">
            <label className="block text-xs text-text-secondary">Description</label>
            <DictateButton
              status={dictateTarget === 'description' ? whisper.status : 'idle'}
              progress={whisper.progress}
              onToggle={() => handleDictate('description')}
              className="ml-2"
            />
          </div>
          <textarea
            className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary resize-none"
            rows={3}
            placeholder="Describe what this agent should accomplish"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Pasted Text */}
        <div className="mb-4">
          <div className="mb-1">
            <label className="block text-xs text-text-secondary">Pasted Text</label>
            <p className="text-xs text-text-muted">Content injected into the prompt as reference material</p>
          </div>
          <textarea
            className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary resize-none font-mono"
            rows={4}
            placeholder="Paste any text here (code, logs, docs, etc.) — it will be sent to the agent as reference"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />
        </div>

        {/* Images */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1">
            Images {imageFiles.length > 0 && `(${imageFiles.length} new)`}
            {editTask && (editTask.images?.length ?? 0) > 0 && (
              <span className="ml-1 text-text-muted">
                ({editTask.images!.length} existing)
              </span>
            )}
          </label>
          <div
            className={`border-2 border-dashed rounded p-3 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-board-border hover:border-text-secondary'
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onPaste={handlePaste}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addImages(e.target.files)
                e.target.value = ''
              }}
            />
            {imageFiles.length === 0 ? (
              <p className="text-xs text-text-muted py-1">
                Drop images here, click to browse, or paste from clipboard
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 justify-center">
                {imagePreviews.map((src, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={src}
                      alt={imageFiles[i]?.name}
                      className="w-16 h-16 object-cover rounded border border-board-border"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(i) }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 text-white text-[10px] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      x
                    </button>
                    <p className="text-[9px] text-text-muted truncate max-w-[64px] mt-0.5">
                      {imageFiles[i]?.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Agent Type */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1">Agent Type</label>
          <select
            className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
            value={agentType}
            onChange={(e) => { setAgentType(e.target.value as AgentType); setModel(''); }}
          >
            {agentTypes.map((at) => (
              <option key={at.value} value={at.value}>
                {at.label}
              </option>
            ))}
          </select>
        </div>

        {/* Model */}
        {(agentModels[agentType]?.length > 0 || agentType === 'lmstudio') && (
          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1">Model</label>
            {agentType === 'lmstudio' ? (
              <>
                <select
                  className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
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
                <p className="text-xs text-text-muted mt-1">
                  Models served by LM Studio at localhost:1234
                </p>
              </>
            ) : (
              <>
                <select
                  className="w-full bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
                  value={model}
                  onChange={(e) => { setModel(e.target.value); setCustomModel(''); }}
                >
                  {(agentModels[agentType] || []).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {isCustom && (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="e.g. openai/my-model"
                    className="w-full mt-2 bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-text-secondary placeholder-text-muted"
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* Command */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1">Command</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 bg-board-bg border border-board-border rounded px-3 py-2 text-sm text-text-primary font-mono focus:outline-none focus:border-text-secondary"
              placeholder={commandPlaceholders[agentType]}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <DictateButton
              status={dictateTarget === 'command' ? whisper.status : 'idle'}
              progress={whisper.progress}
              onToggle={() => handleDictate('command')}
            />
          </div>
          {placeholders.length > 0 && (
            <p className="text-xs text-text-secondary mt-1">
              Placeholders detected: {placeholders.join(', ')}
            </p>
          )}
        </div>

        {/* YOLO Mode */}
        {agentType !== 'generic' && (
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${yolo ? 'bg-amber-600' : 'bg-board-bg border border-board-border'
                  }`}
                onClick={() => setYolo(!yolo)}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white dark:bg-gray-300 shadow ${yolo ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                />
              </div>
              <div>
                <span className="text-sm text-text-primary">
                  YOLO Mode
                </span>
                <p className="text-xs text-text-secondary">
                  Auto-accept all agent permission prompts
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Auto Review */}
        {agentType !== 'generic' && (
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${autoReview ? 'bg-blue-600' : 'bg-board-bg border border-board-border'
                  }`}
                onClick={() => setAutoReview(!autoReview)}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white dark:bg-gray-300 shadow ${autoReview ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                />
              </div>
              <div>
                <span className="text-sm text-text-primary">
                  Auto Review
                </span>
                <p className="text-xs text-text-secondary">
                  Automatically verify and inspect task when it reaches review
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Auto Complete */}
        {agentType !== 'generic' && (
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${autoComplete ? 'bg-green-600' : 'bg-board-bg border border-board-border'}`}
                onClick={() => setAutoComplete(!autoComplete)}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white dark:bg-gray-300 shadow ${autoComplete ? 'translate-x-4' : 'translate-x-0.5'}`}
                />
              </div>
              <div>
                <span className="text-sm text-text-primary">Auto Complete</span>
                <p className="text-xs text-text-secondary">
                  Automatically move task to review when agent signals completion
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Waitlisted */}
        {agentType !== 'generic' && (
          <div className="mb-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${waitlisted ? 'bg-purple-600' : 'bg-board-bg border border-board-border'
                  }`}
                onClick={() => setWaitlisted(!waitlisted)}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform bg-white dark:bg-gray-300 shadow ${waitlisted ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                />
              </div>
              <div>
                <span className="text-sm text-text-primary">
                  Waitlisted
                </span>
                <p className="text-xs text-text-secondary">
                  Wait for all in-progress tasks to finish before starting
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Checklist Items */}
        <div className="mb-4">
          <label className="block text-xs text-text-secondary mb-1">
            Checklist Items
          </label>
          <div className="space-y-1 mb-2">
            {checklistItems.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-2 text-sm text-text-primary"
              >
                <span className="text-text-muted text-xs">-</span>
                <input
                  type="text"
                  className="flex-1 bg-transparent border-b border-transparent focus:border-board-border focus:outline-none text-sm text-text-primary"
                  value={item}
                  onChange={(e) => setChecklistItems((prev) => prev.map((it, i) => i === index ? e.target.value : it))}
                  onFocus={() => { focusedChecklistIndexRef.current = index }}
                />
                <button
                  onClick={() => handleRemoveChecklistItem(index)}
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
              className="flex-1 bg-board-bg border border-board-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
              placeholder="Add checklist item"
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              onFocus={() => { focusedChecklistIndexRef.current = null }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddChecklistItem()
                }
              }}
            />
            <DictateButton
              status={dictateTarget === 'checklist' ? whisper.status : 'idle'}
              progress={whisper.progress}
              onToggle={() => handleDictate('checklist')}
            />
            <button
              onClick={handleAddChecklistItem}
              className="px-3 py-1.5 text-sm bg-board-bg border border-board-border rounded text-text-secondary hover:text-text-primary hover:border-text-secondary"
            >
              +
            </button>
          </div>
        </div>

        {/* Tags */}
        {availableTags.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setSelectedTagIds((prev) =>
                      selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                    )}
                    className="text-xs px-2 py-1 rounded transition-all font-medium"
                    style={{
                      backgroundColor: selected ? `${tag.color}30` : 'transparent',
                      color: selected ? tag.color : 'var(--text-muted)',
                      border: `1px solid ${selected ? tag.color : 'var(--board-border)'}`,
                    }}
                  >
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Dependencies */}
        <div className="mb-6">
          <label className="block text-xs text-text-secondary mb-1">
            Dependencies
          </label>
          {existingTasks.length === 0 ? (
            <p className="text-xs text-text-muted">No existing tasks to depend on</p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {existingTasks.map((task) => (
                <label
                  key={task.id}
                  className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary"
                >
                  <input
                    type="checkbox"
                    checked={dependsOn.includes(task.id)}
                    onChange={() => toggleDependency(task.id)}
                    className="rounded border-board-border"
                  />
                  <span className="truncate">{task.title}</span>
                  <span className="text-xs text-text-muted">({task.column})</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {editTask ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
