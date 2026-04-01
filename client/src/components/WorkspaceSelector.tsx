import { useState, useRef, useEffect, useCallback } from 'react'
import type { Workspace } from '../types'

interface DirEntry {
  name: string
  path: string
}

interface BrowseResult {
  current: string
  parent: string
  dirs: DirEntry[]
}

interface WorkspaceSelectorProps {
  workspaces: Workspace[]
  activeWorkspaceId: string
  onSelect: (id: string) => void
  onCreated: (workspace: Workspace) => void
  onDeleted: (id: string) => void
  onUpdated?: (workspace: Workspace) => void
}

export default function WorkspaceSelector({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onCreated,
  onDeleted,
  onUpdated,
}: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newGithubRepo, setNewGithubRepo] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const [browseDirs, setBrowseDirs] = useState<DirEntry[]>([])
  const [browseCurrentDir, setBrowseCurrentDir] = useState('')
  const [browseParentDir, setBrowseParentDir] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editGithubRepo, setEditGithubRepo] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setShowBrowser(false)
        setEditingId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-focus name input when creating
  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => nameInputRef.current?.focus())
    }
  }, [creating])

  const browseDir = useCallback(async (dir?: string) => {
    try {
      const params = dir ? `?dir=${encodeURIComponent(dir)}` : ''
      const res = await fetch(`/api/browse-dirs${params}`)
      const data: BrowseResult = await res.json()
      setBrowseDirs(data.dirs)
      setBrowseCurrentDir(data.current)
      setBrowseParentDir(data.parent)
      setShowBrowser(true)
    } catch {
      // ignore
    }
  }, [])

  const handleSelectDir = (dirPath: string) => {
    setNewPath(dirPath)
    setShowBrowser(false)
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newPath.trim()) return
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          path: newPath.trim(),
          githubRepo: newGithubRepo.trim() || undefined,
        }),
      })
      if (res.ok) {
        const workspace: Workspace = await res.json()
        onCreated(workspace)
        setNewName('')
        setNewPath('')
        setNewGithubRepo('')
        setCreating(false)
      }
    } catch {
      // ignore
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted(id)
      }
    } catch {
      // ignore
    }
  }

  const handleStartEdit = (ws: Workspace, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(ws.id)
    setEditGithubRepo(ws.githubRepo || '')
  }

  const handleSaveEdit = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ githubRepo: editGithubRepo.trim() || '' }),
      })
      if (res.ok) {
        const updated: Workspace = await res.json()
        onUpdated?.(updated)
        setEditingId(null)
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => {
          setOpen((v) => !v)
          if (creating) setCreating(false)
        }}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-board-border rounded hover:border-text-secondary transition-colors max-w-[200px]"
      >
        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <span className="text-text-primary truncate">
          {activeWorkspace ? activeWorkspace.name : 'All Workspaces'}
        </span>
        {activeWorkspace?.githubRepo && (
          <span className="text-[10px] text-gray-400" title={activeWorkspace.githubRepo}>⎇</span>
        )}
        <span className="text-text-muted ml-0.5">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-board-card border border-board-border rounded-lg shadow-xl z-50 overflow-hidden">
          {/* "All" option */}
          <button
            onClick={() => {
              onSelect('')
              setOpen(false)
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-board-hover flex items-center gap-2 ${
              !activeWorkspaceId ? 'text-blue-400' : 'text-text-secondary'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-gray-500 shrink-0" />
            All Workspaces
          </button>

          {/* Divider */}
          {workspaces.length > 0 && <div className="border-t border-board-border" />}

          {/* Workspace list */}
          {workspaces.map((ws) => (
            <div key={ws.id}>
              <div
                onClick={() => {
                  if (editingId === ws.id) return
                  onSelect(ws.id)
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-board-hover flex items-center gap-2 cursor-pointer group ${
                  ws.id === activeWorkspaceId ? 'text-blue-400' : 'text-text-secondary'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-text-primary">{ws.name}</span>
                    {ws.githubRepo && (
                      <span className="text-[9px] text-green-400 shrink-0" title={`GitHub: ${ws.githubRepo}`}>
                        ⎇ {ws.githubRepo}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-mono truncate">{ws.path}</div>
                </div>
                <button
                  onClick={(e) => handleStartEdit(ws, e)}
                  className="text-text-muted hover:text-blue-400 text-xs opacity-0 group-hover:opacity-100 shrink-0"
                  title="Edit GitHub repo"
                >
                  ✎
                </button>
                <button
                  onClick={(e) => handleDelete(ws.id, e)}
                  className="text-text-muted hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 shrink-0"
                  title="Delete workspace"
                >
                  x
                </button>
              </div>
              {/* Inline edit for GitHub repo */}
              {editingId === ws.id && (
                <div className="px-3 pb-2 space-y-1.5 bg-board-hover border-t border-board-border">
                  <div className="text-[10px] text-text-muted pt-1.5">GitHub repo (owner/repo)</div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      className="flex-1 bg-board-bg border border-board-border rounded px-2 py-1 text-xs text-text-primary font-mono focus:outline-none focus:border-text-secondary"
                      placeholder="owner/repo"
                      value={editGithubRepo}
                      onChange={(e) => setEditGithubRepo(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(ws.id, e as unknown as React.MouseEvent)
                        if (e.key === 'Escape') setEditingId(null)
                        e.stopPropagation()
                      }}
                      autoFocus
                    />
                    <button
                      onClick={(e) => handleSaveEdit(ws.id, e)}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500"
                    >
                      Save
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(null) }}
                      className="px-2 py-1 text-xs text-text-muted hover:text-text-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Divider */}
          <div className="border-t border-board-border" />

          {/* Create new workspace */}
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2 text-sm text-text-muted hover:text-text-secondary hover:bg-board-hover"
            >
              + Add Workspace
            </button>
          ) : (
            <div className="px-3 py-3 space-y-2">
              <input
                ref={nameInputRef}
                type="text"
                className="w-full bg-board-bg border border-board-border rounded px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-text-secondary"
                placeholder="Workspace name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') setCreating(false)
                }}
              />
              <div className="flex gap-1.5">
                <input
                  type="text"
                  className="flex-1 bg-board-bg border border-board-border rounded px-2.5 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-text-secondary"
                  placeholder="C:\projects\my-app"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') setCreating(false)
                  }}
                />
                <button
                  type="button"
                  onClick={() => browseDir(newPath || undefined)}
                  className="px-2 py-1.5 text-xs bg-board-bg border border-board-border rounded text-text-secondary hover:text-text-primary hover:border-text-secondary"
                >
                  ...
                </button>
              </div>
              <input
                type="text"
                className="w-full bg-board-bg border border-board-border rounded px-2.5 py-1.5 text-sm text-text-primary font-mono focus:outline-none focus:border-text-secondary"
                placeholder="GitHub repo: owner/repo (optional)"
                value={newGithubRepo}
                onChange={(e) => setNewGithubRepo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') setCreating(false)
                }}
              />
              {/* Directory browser */}
              {showBrowser && (
                <div className="bg-board-bg border border-board-border rounded max-h-36 overflow-y-auto">
                  <div className="flex items-center gap-2 px-2.5 py-1 border-b border-board-border text-[10px] text-text-muted font-mono truncate">
                    <span className="truncate">{browseCurrentDir}</span>
                  </div>
                  {browseParentDir !== browseCurrentDir && (
                    <button
                      onClick={() => browseDir(browseParentDir)}
                      className="w-full text-left px-2.5 py-1 text-xs text-text-muted hover:bg-board-hover hover:text-text-primary font-mono"
                    >
                      ..
                    </button>
                  )}
                  {browseDirs.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[10px] text-text-muted">No subdirectories</div>
                  ) : (
                    browseDirs.map((d) => (
                      <div key={d.path} className="flex items-center">
                        <button
                          onClick={() => browseDir(d.path)}
                          className="flex-1 text-left px-2.5 py-1 text-xs text-text-secondary hover:bg-board-hover hover:text-text-primary font-mono truncate"
                        >
                          {d.name}
                        </button>
                        <button
                          onClick={() => handleSelectDir(d.path)}
                          className="px-1.5 py-0.5 mr-1 text-[10px] text-text-muted hover:text-green-400"
                        >
                          Select
                        </button>
                      </div>
                    ))
                  )}
                  <div className="flex justify-between border-t border-board-border px-2 py-1">
                    <button
                      onClick={() => handleSelectDir(browseCurrentDir)}
                      className="text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      Use current
                    </button>
                    <button
                      onClick={() => setShowBrowser(false)}
                      className="text-[10px] text-text-muted hover:text-text-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                    setNewPath('')
                    setNewGithubRepo('')
                    setShowBrowser(false)
                  }}
                  className="px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || !newPath.trim()}
                  className="px-2.5 py-1 text-xs bg-board-hover text-text-primary rounded hover:bg-board-card disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
