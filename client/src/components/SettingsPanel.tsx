import { useState, useEffect, useCallback } from 'react'
import { agentTypes, agentModels, type AgentType, lmStudioToOptions, type LmStudioModel } from '../types/agent-config'
import { soundPresets, type SoundPreset, useSound } from '../hooks/useSound'
import type { Tag, Template } from '../types'
import type { TerminalPosition } from './TerminalPanel'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  theme: 'light' | 'dark' | 'banana-dark' | 'banana-light' | 'experimental'
  onThemeChange: (theme: 'light' | 'dark' | 'banana-dark' | 'banana-light' | 'experimental') => void
  reviewDoneCardStyle: 'expanded' | 'collapsed'
  onReviewDoneCardStyleChange: (style: 'expanded' | 'collapsed') => void
  terminalPosition: TerminalPosition
  onTerminalPositionChange: (pos: TerminalPosition) => void
  onTemplatesChange?: () => void
}

type Tab = 'appearance' | 'models' | 'verification' | 'sound' | 'tags' | 'templates' | 'github'

const TABS: { id: Tab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'models', label: 'Models' },
  { id: 'verification', label: 'Verification' },
  { id: 'sound', label: 'Sound' },
  { id: 'tags', label: 'Tags' },
  { id: 'templates', label: 'Templates' },
  { id: 'github', label: 'GitHub' },
]

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#6b7280',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeTpl(t: any): Template {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    agentType: t.agent_type ?? t.agentType ?? 'claude',
    command: t.command ?? '',
    checklistDefaults: t.checklist_defaults ?? t.checklistDefaults ?? [],
  }
}

function loadPref<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  try { return JSON.parse(raw) as T } catch { return raw as unknown as T }
}

export default function SettingsPanel({ isOpen, onClose, theme, onThemeChange, reviewDoneCardStyle, onReviewDoneCardStyleChange, terminalPosition, onTerminalPositionChange, onTemplatesChange }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('appearance')

  const [defaultAgent, setDefaultAgent] = useState<AgentType>(() =>
    loadPref<AgentType>('kanaban:defaultAgent', 'claude')
  )
  const [defaultChatAgent, setDefaultChatAgent] = useState<string>(() => {
    try { return localStorage.getItem('kanaban:defaultChatAgent') || 'claude'; } catch { return 'claude'; }
  })
  const [defaultYolo, setDefaultYolo] = useState<boolean>(() =>
    loadPref<boolean>('kanaban:defaultYolo', false)
  )
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>(() =>
    loadPref<Record<string, string>>('kanaban:defaultModels', {})
  )
  const [customModel, setCustomModel] = useState('')
  const [lmStudioModels, setLmStudioModels] = useState<{ value: string; label: string }[]>([])
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    localStorage.getItem('kanaban:soundEnabled') !== 'false'
  )
  const [selectedSound, setSelectedSound] = useState<SoundPreset>(() =>
    (localStorage.getItem('kanaban:selectedSound') as SoundPreset) || 'chime'
  )
  const { previewSound } = useSound()

  const [verifyAgent, setVerifyAgent] = useState<AgentType>(() =>
    loadPref<AgentType>('kanaban:verifyAgent', 'claude')
  )
  const [verifyModels, setVerifyModels] = useState<Record<string, string>>(() =>
    loadPref<Record<string, string>>('kanaban:verifyModels', {})
  )
  const [verifyCustomModel, setVerifyCustomModel] = useState('')
  const [verifyLmStudioModels, setVerifyLmStudioModels] = useState<{ value: string; label: string }[]>([])

  // GitHub state
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(false)
  const [githubTokenInput, setGithubTokenInput] = useState('')
  const [githubSaving, setGithubSaving] = useState(false)
  const [githubSaveError, setGithubSaveError] = useState('')
  const [githubSaveSuccess, setGithubSaveSuccess] = useState(false)

  // Load GitHub token status when tab opens
  useEffect(() => {
    if (isOpen && activeTab === 'github') {
      fetch('/api/settings/github-token')
        .then(r => r.json())
        .then((d: { configured: boolean }) => setGithubTokenConfigured(d.configured))
        .catch(() => {})
      setGithubTokenInput('')
      setGithubSaveError('')
      setGithubSaveSuccess(false)
    }
  }, [isOpen, activeTab])

  const handleSaveGithubToken = async () => {
    if (!githubTokenInput.trim()) return
    setGithubSaving(true)
    setGithubSaveError('')
    setGithubSaveSuccess(false)
    try {
      const res = await fetch('/api/settings/github-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: githubTokenInput.trim() }),
      })
      if (res.ok) {
        setGithubTokenConfigured(true)
        setGithubTokenInput('')
        setGithubSaveSuccess(true)
        setTimeout(() => setGithubSaveSuccess(false), 3000)
      } else {
        const d = await res.json()
        setGithubSaveError(d.error || 'Failed to save token')
      }
    } catch {
      setGithubSaveError('Network error')
    } finally {
      setGithubSaving(false)
    }
  }

  const handleDeleteGithubToken = async () => {
    try {
      await fetch('/api/settings/github-token', { method: 'DELETE' })
      setGithubTokenConfigured(false)
      setGithubTokenInput('')
      setGithubSaveError('')
    } catch {
      // ignore
    }
  }

  // Tags state
  const [tags, setTags] = useState<Tag[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#3b82f6')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagColor, setEditTagColor] = useState('')

  const fetchTags = useCallback(() => {
    fetch('/api/tags')
      .then((r) => r.json())
      .then((data: Tag[]) => setTags(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isOpen && activeTab === 'tags') fetchTags()
  }, [isOpen, activeTab, fetchTags])

  // Templates state
  const [templates, setTemplates] = useState<Template[]>([])
  const [newTplName, setNewTplName] = useState('')
  const [newTplDescription, setNewTplDescription] = useState('')
  const [newTplAgentType, setNewTplAgentType] = useState<string>('claude')
  const [newTplCommand, setNewTplCommand] = useState('')
  const [newTplChecklist, setNewTplChecklist] = useState<string[]>([])
  const [newTplChecklistInput, setNewTplChecklistInput] = useState('')
  const [editingTplId, setEditingTplId] = useState<string | null>(null)
  const [editTpl, setEditTpl] = useState<Partial<Template>>({})
  const [editTplChecklistInput, setEditTplChecklistInput] = useState('')

  const fetchTemplates = useCallback(() => {
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data: unknown[]) => setTemplates(data.map(normalizeTpl)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isOpen && activeTab === 'templates') fetchTemplates()
  }, [isOpen, activeTab, fetchTemplates])

  const handleCreateTemplate = useCallback(() => {
    if (!newTplName.trim()) return
    fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTplName.trim(),
        description: newTplDescription.trim(),
        agent_type: newTplAgentType,
        command: newTplCommand.trim(),
        checklist_defaults: newTplChecklist,
      }),
    })
      .then((r) => r.json())
      .then((tpl) => {
        setTemplates((prev) => [...prev, normalizeTpl(tpl)])
        setNewTplName('')
        setNewTplDescription('')
        setNewTplAgentType('claude')
        setNewTplCommand('')
        setNewTplChecklist([])
        setNewTplChecklistInput('')
        onTemplatesChange?.()
      })
      .catch(() => {})
  }, [newTplName, newTplDescription, newTplAgentType, newTplCommand, newTplChecklist, onTemplatesChange])

  const handleUpdateTemplate = useCallback((id: string) => {
    fetch(`/api/templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editTpl.name?.trim(),
        description: editTpl.description?.trim(),
        agent_type: editTpl.agentType,
        command: editTpl.command?.trim(),
        checklist_defaults: editTpl.checklistDefaults ?? [],
      }),
    })
      .then((r) => r.json())
      .then((updated) => {
        setTemplates((prev) => prev.map((t) => (t.id === id ? normalizeTpl(updated) : t)))
        setEditingTplId(null)
        setEditTpl({})
        onTemplatesChange?.()
      })
      .catch(() => {})
  }, [editTpl, onTemplatesChange])

  const handleDeleteTemplate = useCallback((id: string) => {
    fetch(`/api/templates/${id}`, { method: 'DELETE' })
      .then(() => {
        setTemplates((prev) => prev.filter((t) => t.id !== id))
        onTemplatesChange?.()
      })
      .catch(() => {})
  }, [onTemplatesChange])

  const handleCreateTag = useCallback(() => {
    if (!newTagName.trim()) return
    fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
    })
      .then((r) => r.json())
      .then((tag: Tag) => {
        setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))
        setNewTagName('')
        setNewTagColor('#3b82f6')
      })
      .catch(() => {})
  }, [newTagName, newTagColor])

  const handleUpdateTag = useCallback((id: string) => {
    fetch(`/api/tags/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editTagName.trim(), color: editTagColor }),
    })
      .then((r) => r.json())
      .then((updated: Tag) => {
        setTags((prev) => prev.map((t) => (t.id === id ? updated : t)))
        setEditingTagId(null)
      })
      .catch(() => {})
  }, [editTagName, editTagColor])

  const handleDeleteTag = useCallback((id: string) => {
    fetch(`/api/tags/${id}`, { method: 'DELETE' })
      .then(() => setTags((prev) => prev.filter((t) => t.id !== id)))
      .catch(() => {})
  }, [])

  const currentModel = defaultModels[defaultAgent] || ''
  const isCustom = currentModel === '__custom__'

  useEffect(() => {
    if (isCustom) {
      setCustomModel(defaultModels[`${defaultAgent}:custom`] || '')
    }
  }, [defaultAgent, isCustom])

  useEffect(() => {
    localStorage.setItem('kanaban:defaultAgent', JSON.stringify(defaultAgent))
  }, [defaultAgent])

  useEffect(() => {
    localStorage.setItem('kanaban:defaultChatAgent', defaultChatAgent)
  }, [defaultChatAgent])

  useEffect(() => {
    localStorage.setItem('kanaban:defaultYolo', JSON.stringify(defaultYolo))
  }, [defaultYolo])

  useEffect(() => {
    localStorage.setItem('kanaban:defaultModels', JSON.stringify(defaultModels))
  }, [defaultModels])

  useEffect(() => {
    if (defaultAgent !== 'lmstudio') {
      setLmStudioModels([])
      return
    }
    let cancelled = false
    fetch('/api/lmstudio/models')
      .then((r) => r.json())
      .then((data: { available: boolean; models: LmStudioModel[] }) => {
        if (!cancelled && data.available) {
          setLmStudioModels(lmStudioToOptions(data.models))
        }
      })
      .catch(() => { /* LM Studio not available */ })
    return () => { cancelled = true }
  }, [defaultAgent])

  useEffect(() => {
    localStorage.setItem('kanaban:soundEnabled', String(soundEnabled))
  }, [soundEnabled])

  useEffect(() => {
    localStorage.setItem('kanaban:selectedSound', selectedSound)
  }, [selectedSound])

  useEffect(() => {
    localStorage.setItem('kanaban:verifyAgent', JSON.stringify(verifyAgent))
  }, [verifyAgent])

  useEffect(() => {
    localStorage.setItem('kanaban:verifyModels', JSON.stringify(verifyModels))
  }, [verifyModels])

  const currentVerifyModel = verifyModels[verifyAgent] || ''
  const isVerifyCustom = currentVerifyModel === '__custom__'
  useEffect(() => {
    if (isVerifyCustom) {
      setVerifyCustomModel(verifyModels[`${verifyAgent}:custom`] || '')
    }
  }, [verifyAgent, isVerifyCustom])

  useEffect(() => {
    if (verifyAgent !== 'lmstudio') {
      setVerifyLmStudioModels([])
      return
    }
    let cancelled = false
    fetch('/api/lmstudio/models')
      .then((r) => r.json())
      .then((data: { available: boolean; models: LmStudioModel[] }) => {
        if (!cancelled && data.available) {
          setVerifyLmStudioModels(lmStudioToOptions(data.models))
        }
      })
      .catch(() => { /* LM Studio not available */ })
    return () => { cancelled = true }
  }, [verifyAgent])

  const setModelForAgent = (value: string) => {
    setDefaultModels((prev) => ({ ...prev, [defaultAgent]: value }))
    if (value !== '__custom__') setCustomModel('')
  }

  const setVerifyModelForAgent = (value: string) => {
    setVerifyModels((prev) => ({ ...prev, [verifyAgent]: value }))
    if (value !== '__custom__') setVerifyCustomModel('')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-board-card border border-board-border rounded-xl shadow-2xl flex flex-col" style={{ height: '70vh', maxHeight: '700px', minHeight: '500px' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-board-border flex-shrink-0">
          <h2 className="text-base font-semibold text-text-primary tracking-tight">Settings</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-board-bg"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 px-6 pt-3 pb-0 flex-shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-board-bg text-text-primary'
                  : 'text-text-muted hover:text-text-primary hover:bg-board-bg/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1 bg-board-bg mx-6 mb-4 rounded-b-lg rounded-tr-lg border border-board-border">

          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Theme</p>
                  <p className="text-xs text-text-muted mt-0.5">Switch between dark and light mode</p>
                </div>
                <select
                  value={theme}
                  onChange={(e) => onThemeChange(e.target.value as 'light' | 'dark' | 'banana-dark' | 'banana-light' | 'experimental')}
                  className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                >
                  <option value="dark">Dark</option>
                  <option value="experimental">Experimental</option>
                  <option value="banana-dark">Banana Dark</option>
                  <option value="banana-light">Banana Light</option>
                  <option value="light">Light</option>
                </select>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-board-border">
                <div>
                  <p className="text-sm font-medium text-text-primary">Review & Done Card Style</p>
                  <p className="text-xs text-text-muted mt-0.5">Show or hide walkthrough content on cards</p>
                </div>
                <select
                  value={reviewDoneCardStyle}
                  onChange={(e) => onReviewDoneCardStyleChange(e.target.value as 'expanded' | 'collapsed')}
                  className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                >
                  <option value="expanded">Expanded</option>
                  <option value="collapsed">Collapsed</option>
                </select>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-board-border">
                <div>
                  <p className="text-sm font-medium text-text-primary">Terminal Position</p>
                  <p className="text-xs text-text-muted mt-0.5">Where to place the terminal panel relative to the board</p>
                </div>
                <select
                  value={terminalPosition}
                  onChange={(e) => onTerminalPositionChange(e.target.value as TerminalPosition)}
                  className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="bottom">Bottom</option>
                </select>
              </div>
            </div>
          )}

          {/* Models Tab */}
          {activeTab === 'models' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Default Agent</p>
                  <p className="text-xs text-text-muted mt-0.5">Agent pre-selected when creating a task</p>
                </div>
                <select
                  value={defaultAgent}
                  onChange={(e) => setDefaultAgent(e.target.value as AgentType)}
                  className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                >
                  {agentTypes.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Default Chat Agent</p>
                  <p className="text-xs text-text-muted mt-0.5">Agent pre-selected when opening a chat</p>
                </div>
                {/* Default Chat Agent */}
                <select
                  value={defaultChatAgent}
                  onChange={(e) => setDefaultChatAgent(e.target.value)}
                  className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                >
                  <option value="claude">Claude</option>
                  <option value="gemini">Gemini</option>
                  <option value="qwen">Qwen</option>
                  <option value="kilo">Kilo</option>
                  <option value="droid">Droid (Aider)</option>
                  <option value="generic">Generic</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <p className="text-sm font-medium text-text-primary">Default Model</p>
                  <p className="text-xs text-text-muted mt-0.5">Model pre-selected for {agentTypes.find((a) => a.value === defaultAgent)?.label || defaultAgent}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {defaultAgent === 'lmstudio' ? (
                    <select
                      value={currentModel}
                      onChange={(e) => setModelForAgent(e.target.value)}
                      className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary max-w-[220px]"
                    >
                      <option value="">Default</option>
                      {lmStudioModels.length === 0 && (
                        <option value="" disabled>No models found</option>
                      )}
                      {lmStudioModels.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select
                        value={currentModel}
                        onChange={(e) => setModelForAgent(e.target.value)}
                        className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary max-w-[220px]"
                      >
                        {(agentModels[defaultAgent] || [{ value: '', label: 'Default' }]).map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      {isCustom && (
                        <input
                          type="text"
                          value={customModel}
                          onChange={(e) => {
                            setCustomModel(e.target.value)
                            setDefaultModels((prev) => ({ ...prev, [`${defaultAgent}:custom`]: e.target.value }))
                          }}
                          placeholder="e.g. openai/my-model"
                          className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary font-mono focus:outline-none focus:border-text-secondary max-w-[220px] w-full"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-board-border">
                <div>
                  <p className="text-sm font-medium text-text-primary">YOLO Mode by Default</p>
                  <p className="text-xs text-text-muted mt-0.5">Auto-accept agent actions on new tasks</p>
                </div>
                <button
                  onClick={() => setDefaultYolo((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${defaultYolo ? 'bg-green-500' : 'bg-board-border'}`}
                  role="switch"
                  aria-checked={defaultYolo}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${defaultYolo ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Verification Tab */}
          {activeTab === 'verification' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Verify Agent</p>
                  <p className="text-xs text-text-muted mt-0.5">Agent used when Verify is clicked</p>
                </div>
                <select
                  value={verifyAgent}
                  onChange={(e) => setVerifyAgent(e.target.value as AgentType)}
                  className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                >
                  {agentTypes.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <p className="text-sm font-medium text-text-primary">Verify Model</p>
                  <p className="text-xs text-text-muted mt-0.5">Model used for {agentTypes.find((a) => a.value === verifyAgent)?.label || verifyAgent} verification</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {verifyAgent === 'lmstudio' ? (
                    <select
                      value={currentVerifyModel}
                      onChange={(e) => setVerifyModelForAgent(e.target.value)}
                      className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary max-w-[220px]"
                    >
                      <option value="">Default</option>
                      {verifyLmStudioModels.length === 0 && (
                        <option value="" disabled>No models found</option>
                      )}
                      {verifyLmStudioModels.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select
                        value={currentVerifyModel}
                        onChange={(e) => setVerifyModelForAgent(e.target.value)}
                        className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary max-w-[220px]"
                      >
                        {(agentModels[verifyAgent] || [{ value: '', label: 'Default' }]).map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      {isVerifyCustom && (
                        <input
                          type="text"
                          value={verifyCustomModel}
                          onChange={(e) => {
                            setVerifyCustomModel(e.target.value)
                            setVerifyModels((prev) => ({ ...prev, [`${verifyAgent}:custom`]: e.target.value }))
                          }}
                          placeholder="e.g. openai/my-model"
                          className="text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary font-mono focus:outline-none focus:border-text-secondary max-w-[220px] w-full"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sound Tab */}
          {activeTab === 'sound' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Sound Effects</p>
                  <p className="text-xs text-text-muted mt-0.5">Play sounds on agent activity events</p>
                </div>
                <button
                  onClick={() => setSoundEnabled((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${soundEnabled ? 'bg-green-500' : 'bg-board-border'}`}
                  role="switch"
                  aria-checked={soundEnabled}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${soundEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
              </div>

              <div className="space-y-2 pt-2">
                {soundPresets.map((preset) => (
                  <div
                    key={preset.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedSound === preset.id
                        ? 'border-green-500 bg-green-500/10'
                        : 'border-board-border hover:border-text-secondary'
                    }`}
                    onClick={() => setSelectedSound(preset.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                          selectedSound === preset.id
                            ? 'border-green-500 bg-green-500'
                            : 'border-text-muted'
                        }`}
                      />
                      <div>
                        <p className="text-sm font-medium text-text-primary">{preset.label}</p>
                        <p className="text-xs text-text-muted mt-0.5">{preset.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        previewSound(preset.id)
                      }}
                      className="text-xs text-text-secondary hover:text-text-primary px-3 py-1.5 border border-board-border rounded-lg hover:border-text-secondary transition-colors flex-shrink-0"
                      title="Preview sound"
                    >
                      ▶
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags Tab */}
          {activeTab === 'tags' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-text-primary">Manage Tags</p>
                <p className="text-xs text-text-muted mt-0.5">Create and edit tags to organize your tasks</p>
              </div>

              {/* Create new tag */}
              <div className="space-y-3">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1.5">New Tag</label>
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTag() }}
                      placeholder="Tag name"
                      className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                    />
                  </div>
                  <button
                    onClick={handleCreateTag}
                    disabled={!newTagName.trim()}
                    className="px-4 py-2 text-sm bg-board-card border border-board-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-secondary disabled:opacity-30 transition-colors flex-shrink-0"
                  >
                    Add
                  </button>
                </div>

                {/* Color palette */}
                <div className="flex items-center gap-2 flex-wrap">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewTagColor(c)}
                      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                      style={{
                        backgroundColor: c,
                        borderColor: newTagColor === c ? '#fff' : 'transparent',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Existing tags */}
              <div className="space-y-2 pt-4 border-t border-board-border">
                {tags.length === 0 && (
                  <p className="text-sm text-text-muted text-center py-6">No tags yet. Create one above.</p>
                )}
                {tags.map((tag) => (
                  <div key={tag.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-board-border hover:border-text-secondary transition-colors">
                    {editingTagId === tag.id ? (
                      <>
                        <input
                          type="text"
                          value={editTagName}
                          onChange={(e) => setEditTagName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateTag(tag.id); if (e.key === 'Escape') setEditingTagId(null) }}
                          className="flex-1 text-sm bg-board-card border border-board-border rounded-lg px-3 py-1.5 text-text-primary focus:outline-none focus:border-text-secondary"
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {TAG_COLORS.map((c) => (
                            <button
                              key={c}
                              onClick={() => setEditTagColor(c)}
                              className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                              style={{
                                backgroundColor: c,
                                borderColor: editTagColor === c ? '#fff' : 'transparent',
                              }}
                            />
                          ))}
                        </div>
                        <button
                          onClick={() => handleUpdateTag(tag.id)}
                          className="text-xs text-green-500 hover:text-green-400 px-2.5 py-1 border border-board-border rounded-lg transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingTagId(null)}
                          className="text-xs text-text-muted hover:text-text-primary px-2.5 py-1 border border-board-border rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 text-sm text-text-primary">{tag.name}</span>
                        <button
                          onClick={() => { setEditingTagId(tag.id); setEditTagName(tag.name); setEditTagColor(tag.color) }}
                          className="text-xs text-text-muted hover:text-text-primary px-2.5 py-1 border border-board-border rounded-lg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteTag(tag.id)}
                          className="text-xs text-text-muted hover:text-red-400 px-2.5 py-1 border border-board-border rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Templates Tab */}
          {activeTab === 'templates' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-text-primary">Manage Templates</p>
                <p className="text-xs text-text-muted mt-0.5">Create reusable task templates to speed up task creation</p>
              </div>

              {/* Create new template */}
              <div className="space-y-3 pb-4 border-b border-board-border">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Template Name</label>
                  <input
                    type="text"
                    value={newTplName}
                    onChange={(e) => setNewTplName(e.target.value)}
                    placeholder="e.g. Bug Fix, Feature Request"
                    className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Description / Prompt</label>
                  <textarea
                    value={newTplDescription}
                    onChange={(e) => setNewTplDescription(e.target.value)}
                    placeholder="Paste your template prompt here…"
                    rows={4}
                    className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary resize-none"
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1.5">Agent Type</label>
                    <select
                      value={newTplAgentType}
                      onChange={(e) => setNewTplAgentType(e.target.value)}
                      className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                    >
                      {agentTypes.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1.5">Command Override</label>
                    <input
                      type="text"
                      value={newTplCommand}
                      onChange={(e) => setNewTplCommand(e.target.value)}
                      placeholder="Optional CLI command"
                      className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary font-mono focus:outline-none focus:border-text-secondary"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Default Checklist Items</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTplChecklistInput}
                      onChange={(e) => setNewTplChecklistInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTplChecklistInput.trim()) {
                          setNewTplChecklist((prev) => [...prev, newTplChecklistInput.trim()])
                          setNewTplChecklistInput('')
                        }
                      }}
                      placeholder="Add checklist item, press Enter"
                      className="flex-1 text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                    />
                    <button
                      onClick={() => {
                        if (newTplChecklistInput.trim()) {
                          setNewTplChecklist((prev) => [...prev, newTplChecklistInput.trim()])
                          setNewTplChecklistInput('')
                        }
                      }}
                      className="px-3 py-2 text-sm bg-board-card border border-board-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors flex-shrink-0"
                    >
                      +
                    </button>
                  </div>
                  {newTplChecklist.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {newTplChecklist.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                          <span className="flex-1 truncate">• {item}</span>
                          <button
                            onClick={() => setNewTplChecklist((prev) => prev.filter((_, j) => j !== i))}
                            className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleCreateTemplate}
                  disabled={!newTplName.trim()}
                  className="w-full px-4 py-2 text-sm bg-board-card border border-board-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-secondary disabled:opacity-30 transition-colors"
                >
                  Save Template
                </button>
              </div>

              {/* Existing templates */}
              <div className="space-y-2">
                {templates.length === 0 && (
                  <p className="text-sm text-text-muted text-center py-6">No templates yet. Create one above.</p>
                )}
                {templates.map((tpl) => (
                  <div key={tpl.id} className="rounded-lg border border-board-border hover:border-text-secondary transition-colors">
                    {editingTplId === tpl.id ? (
                      <div className="p-3 space-y-3">
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Name</label>
                          <input
                            type="text"
                            value={editTpl.name ?? ''}
                            onChange={(e) => setEditTpl((p) => ({ ...p, name: e.target.value }))}
                            autoFocus
                            className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Description / Prompt</label>
                          <textarea
                            value={editTpl.description ?? ''}
                            onChange={(e) => setEditTpl((p) => ({ ...p, description: e.target.value }))}
                            rows={4}
                            className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary resize-none"
                          />
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1">
                            <label className="block text-xs text-text-muted mb-1">Agent Type</label>
                            <select
                              value={editTpl.agentType ?? 'claude'}
                              onChange={(e) => setEditTpl((p) => ({ ...p, agentType: e.target.value }))}
                              className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                            >
                              {agentTypes.map((a) => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs text-text-muted mb-1">Command Override</label>
                            <input
                              type="text"
                              value={editTpl.command ?? ''}
                              onChange={(e) => setEditTpl((p) => ({ ...p, command: e.target.value }))}
                              placeholder="Optional CLI command"
                              className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary font-mono focus:outline-none focus:border-text-secondary"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Checklist Items</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editTplChecklistInput}
                              onChange={(e) => setEditTplChecklistInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && editTplChecklistInput.trim()) {
                                  setEditTpl((p) => ({ ...p, checklistDefaults: [...(p.checklistDefaults ?? []), editTplChecklistInput.trim()] }))
                                  setEditTplChecklistInput('')
                                }
                              }}
                              placeholder="Add item, press Enter"
                              className="flex-1 text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary"
                            />
                            <button
                              onClick={() => {
                                if (editTplChecklistInput.trim()) {
                                  setEditTpl((p) => ({ ...p, checklistDefaults: [...(p.checklistDefaults ?? []), editTplChecklistInput.trim()] }))
                                  setEditTplChecklistInput('')
                                }
                              }}
                              className="px-3 py-2 text-sm bg-board-card border border-board-border rounded-lg text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors flex-shrink-0"
                            >
                              +
                            </button>
                          </div>
                          {(editTpl.checklistDefaults ?? []).length > 0 && (
                            <div className="mt-2 space-y-1">
                              {(editTpl.checklistDefaults ?? []).map((item, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                                  <span className="flex-1 truncate">• {item}</span>
                                  <button
                                    onClick={() => setEditTpl((p) => ({ ...p, checklistDefaults: (p.checklistDefaults ?? []).filter((_, j) => j !== i) }))}
                                    className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleUpdateTemplate(tpl.id)}
                            className="text-xs text-green-500 hover:text-green-400 px-3 py-1.5 border border-board-border rounded-lg transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingTplId(null); setEditTpl({}); setEditTplChecklistInput('') }}
                            className="text-xs text-text-muted hover:text-text-primary px-3 py-1.5 border border-board-border rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">{tpl.name}</p>
                          {tpl.description && (
                            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{tpl.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-text-secondary bg-board-bg px-2 py-0.5 rounded">{tpl.agentType}</span>
                            {tpl.checklistDefaults.length > 0 && (
                              <span className="text-xs text-text-muted">{tpl.checklistDefaults.length} checklist item{tpl.checklistDefaults.length !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => {
                              setEditingTplId(tpl.id)
                              setEditTpl({ ...tpl })
                              setEditTplChecklistInput('')
                            }}
                            className="text-xs text-text-muted hover:text-text-primary px-2.5 py-1 border border-board-border rounded-lg transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteTemplate(tpl.id)}
                            className="text-xs text-text-muted hover:text-red-400 px-2.5 py-1 border border-board-border rounded-lg transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GitHub Tab */}
          {activeTab === 'github' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-text-primary">GitHub Integration</p>
                <p className="text-xs text-text-muted mt-0.5">Connect to GitHub to view issues, PRs, and import issues as tasks</p>
              </div>

              <div className="p-3 rounded-lg border border-board-border bg-board-card">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${githubTokenConfigured ? 'bg-green-400' : 'bg-gray-500'}`} />
                  <span className="text-sm text-text-primary">
                    {githubTokenConfigured ? 'Token configured' : 'No token configured'}
                  </span>
                </div>
                {githubTokenConfigured && (
                  <p className="text-xs text-text-muted">Token is stored securely on the server</p>
                )}
              </div>

              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  value={githubTokenInput}
                  placeholder={githubTokenConfigured ? 'Enter new token to replace' : 'ghp_...'}
                  className="w-full text-sm bg-board-card border border-board-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-text-secondary font-mono"
                  onChange={e => setGithubTokenInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveGithubToken() }}
                />
                <p className="text-xs text-text-muted mt-1">
                  Requires <code className="font-mono bg-board-hover px-1 rounded">repo</code> scope.
                  Generate at GitHub → Settings → Developer settings → Personal access tokens.
                </p>
              </div>

              {githubSaveError && (
                <p className="text-xs text-red-400">{githubSaveError}</p>
              )}
              {githubSaveSuccess && (
                <p className="text-xs text-green-400">Token saved and verified successfully.</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleSaveGithubToken}
                  disabled={!githubTokenInput.trim() || githubSaving}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {githubSaving ? 'Verifying...' : 'Save Token'}
                </button>
                {githubTokenConfigured && (
                  <button
                    onClick={handleDeleteGithubToken}
                    className="px-3 py-1.5 text-xs text-red-400 border border-red-800 rounded hover:border-red-600 hover:text-red-300"
                  >
                    Remove Token
                  </button>
                )}
              </div>

              <div className="pt-2 border-t border-board-border">
                <p className="text-xs text-text-muted font-medium mb-1">How to use</p>
                <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside">
                  <li>Save a GitHub PAT with <code className="font-mono bg-board-hover px-1 rounded">repo</code> scope above</li>
                  <li>Create or edit a workspace and enter the GitHub repo in <code className="font-mono bg-board-hover px-1 rounded">owner/repo</code> format</li>
                  <li>The GitHub panel will appear in the sidebar when a linked workspace is active</li>
                </ol>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-board-border flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-text-secondary hover:text-text-primary px-4 py-2 border border-board-border rounded-lg hover:border-text-secondary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
