import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import db from '../db.js';

const MCP_SERVER_SCRIPT = path.resolve(__dirname, '..', '..', 'mcp-server', 'index.ts');

function injectMcpConfig(workspacePath: string, workspaceId: string): void {
  try {
    const mcpPath = path.join(workspacePath, '.mcp.json');

    let config: any = {};
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      // File doesn't exist or isn't valid JSON
    }

    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.kanaban = {
      type: 'stdio',
      command: 'npx',
      args: ['tsx', MCP_SERVER_SCRIPT],
      env: {
        KANABAN_API: `http://localhost:${process.env.NODE_ENV !== 'production' ? 3001 : 3000}`,
        KANABAN_WORKSPACE_ID: workspaceId,
      },
    };

    writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`[kanaban:mcp] Wrote MCP config to ${mcpPath}`);
  } catch (err) {
    console.error(`[kanaban:mcp] Failed to write MCP config for workspace ${workspaceId}:`, err);
  }
}

const router = Router();

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  github_repo: string | null;
  created_at: string;
}

function formatWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    githubRepo: row.github_repo || undefined,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/workspaces — List all workspaces
 */
router.get('/api/workspaces', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as WorkspaceRow[];
    res.json(rows.map(formatWorkspace));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workspaces', detail: String(err) });
  }
});

/**
 * POST /api/workspaces — Create a workspace
 */
router.post('/api/workspaces', (req: Request, res: Response) => {
  try {
    const { name, path: wsPath, githubRepo } = req.body;
    if (!name || !wsPath) {
      res.status(400).json({ error: 'name and path are required' });
      return;
    }

    if (!existsSync(wsPath)) {
      res.status(400).json({ error: 'Directory does not exist' });
      return;
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const repoValue = githubRepo?.trim() || null;

    db.prepare('INSERT INTO workspaces (id, name, path, github_repo, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, wsPath, repoValue, now);

    const created = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow;
    res.status(201).json(formatWorkspace(created));
    injectMcpConfig(wsPath, id);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create workspace', detail: String(err) });
  }
});

/**
 * PUT /api/workspaces/:id — Update a workspace (name, githubRepo)
 */
router.put('/api/workspaces/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const { name, githubRepo } = req.body;
    const newName = name?.trim() || existing.name;
    const newRepo = githubRepo !== undefined ? (githubRepo?.trim() || null) : existing.github_repo;

    db.prepare('UPDATE workspaces SET name = ?, github_repo = ? WHERE id = ?').run(newName, newRepo, id);

    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow;
    res.json(formatWorkspace(updated));
    injectMcpConfig(existing.path, id as string);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update workspace', detail: String(err) });
  }
});

/**
 * DELETE /api/workspaces/:id — Delete a workspace
 */
router.delete('/api/workspaces/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete workspace', detail: String(err) });
  }
});

// Backfill MCP config for existing workspaces on startup
try {
  const allWorkspaces = db.prepare('SELECT id, path FROM workspaces').all() as { id: string; path: string }[];
  for (const ws of allWorkspaces) {
    const mcpPath = path.join(ws.path, '.mcp.json');
    try {
      const existing = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      if (existing?.mcpServers?.kanaban) continue;
    } catch {
      // doesn't exist — needs backfill
    }
    injectMcpConfig(ws.path, ws.id);
  }
} catch (err) {
  console.error('[kanaban:mcp] Backfill error:', err);
}

export default router;
