import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  github_repo: string | null;
  created_at: string;
}

interface SettingRow {
  key: string;
  value: string;
}

function getGithubToken(): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as SettingRow | undefined;
  return row?.value || null;
}

function getWorkspaceRepo(workspaceId: string): { workspace: WorkspaceRow; repo: string } | null {
  const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined;
  if (!workspace) return null;
  if (!workspace.github_repo) return null;
  return { workspace, repo: workspace.github_repo };
}

async function githubFetch(path: string, token: string | null): Promise<{ ok: boolean; status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`https://api.github.com${path}`, { headers });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * GET /api/settings/github-token — Check if GitHub PAT is configured
 */
router.get('/api/settings/github-token', (_req: Request, res: Response) => {
  const token = getGithubToken();
  res.json({ configured: !!token });
});

/**
 * PUT /api/settings/github-token — Save GitHub PAT
 */
router.put('/api/settings/github-token', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    const trimmed = token.trim();

    // Validate token by calling GitHub API
    const result = await githubFetch('/user', trimmed);
    if (!result.ok) {
      res.status(400).json({ error: 'Invalid GitHub token — authentication failed', status: result.status });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('github_token', trimmed, now);

    res.json({ configured: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save GitHub token', detail: String(err) });
  }
});

/**
 * DELETE /api/settings/github-token — Remove GitHub PAT
 */
router.delete('/api/settings/github-token', (_req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM settings WHERE key = ?').run('github_token');
    res.json({ configured: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete GitHub token', detail: String(err) });
  }
});

/**
 * GET /api/workspaces/:id/github — Fetch repo info
 */
router.get('/api/workspaces/:id/github', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = getWorkspaceRepo(String(id));
    if (!result) {
      res.status(404).json({ error: 'Workspace not found or no GitHub repo linked' });
      return;
    }

    const token = getGithubToken();
    const { ok, status, data } = await githubFetch(`/repos/${result.repo}`, token);

    if (!ok) {
      res.status(status).json({ error: 'GitHub API error', detail: data });
      return;
    }

    const d = data as Record<string, unknown>;
    res.json({
      name: d.name,
      fullName: d.full_name,
      description: d.description,
      stars: d.stargazers_count,
      defaultBranch: d.default_branch,
      openIssuesCount: d.open_issues_count,
      htmlUrl: d.html_url,
      private: d.private,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch repo info', detail: String(err) });
  }
});

/**
 * GET /api/workspaces/:id/github/issues — List open issues
 */
router.get('/api/workspaces/:id/github/issues', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = getWorkspaceRepo(String(id));
    if (!result) {
      res.status(404).json({ error: 'Workspace not found or no GitHub repo linked' });
      return;
    }

    const token = getGithubToken();
    const { ok, status, data } = await githubFetch(
      `/repos/${result.repo}/issues?state=open&per_page=50&pulls=false`,
      token
    );

    if (!ok) {
      res.status(status).json({ error: 'GitHub API error', detail: data });
      return;
    }

    // Filter out pull requests (GitHub issues API returns PRs too)
    const issues = (data as Record<string, unknown>[]).filter((i) => !i.pull_request);

    res.json(issues.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      htmlUrl: i.html_url,
      state: i.state,
      createdAt: i.created_at,
      author: (i.user as Record<string, unknown>)?.login,
      labels: ((i.labels as Record<string, unknown>[]) || []).map((l) => ({
        name: l.name,
        color: l.color,
      })),
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch issues', detail: String(err) });
  }
});

/**
 * GET /api/workspaces/:id/github/pulls — List open PRs
 */
router.get('/api/workspaces/:id/github/pulls', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = getWorkspaceRepo(String(id));
    if (!result) {
      res.status(404).json({ error: 'Workspace not found or no GitHub repo linked' });
      return;
    }

    const token = getGithubToken();
    const { ok, status, data } = await githubFetch(
      `/repos/${result.repo}/pulls?state=open&per_page=50`,
      token
    );

    if (!ok) {
      res.status(status).json({ error: 'GitHub API error', detail: data });
      return;
    }

    res.json((data as Record<string, unknown>[]).map((pr) => ({
      number: pr.number,
      title: pr.title,
      htmlUrl: pr.html_url,
      state: pr.state,
      createdAt: pr.created_at,
      author: (pr.user as Record<string, unknown>)?.login,
      branch: (pr.head as Record<string, unknown>)?.ref,
      draft: pr.draft,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pull requests', detail: String(err) });
  }
});

/**
 * POST /api/workspaces/:id/github/import-issue — Import a GitHub issue as a Kanaban task
 */
router.post('/api/workspaces/:id/github/import-issue', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const workspaceResult = getWorkspaceRepo(String(id));
    if (!workspaceResult) {
      res.status(404).json({ error: 'Workspace not found or no GitHub repo linked' });
      return;
    }

    const { issueNumber } = req.body;
    if (!issueNumber) {
      res.status(400).json({ error: 'issueNumber is required' });
      return;
    }

    const token = getGithubToken();
    const { ok, status, data } = await githubFetch(
      `/repos/${workspaceResult.repo}/issues/${issueNumber}`,
      token
    );

    if (!ok) {
      res.status(status).json({ error: 'GitHub API error', detail: data });
      return;
    }

    const issue = data as Record<string, unknown>;
    const title = String(issue.title || '');
    const body = String(issue.body || '');

    // Extract task list items from markdown body (- [ ] ... or - [x] ...)
    const checklistItems: Array<{ text: string; done: boolean }> = [];
    const taskListRegex = /^[\s]*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
    let match;
    while ((match = taskListRegex.exec(body)) !== null) {
      checklistItems.push({
        text: match[2].trim(),
        done: match[1].toLowerCase() === 'x',
      });
    }

    // Build description with GitHub issue reference
    const issueUrl = String(issue.html_url || '');
    const description = `Imported from GitHub issue [#${issueNumber}](${issueUrl})\n\n${body}`.trim();

    const now = new Date().toISOString();
    const taskId = uuidv4();

    // Get max position in backlog
    const maxPos = db.prepare(`SELECT MAX(position) as mp FROM tasks WHERE "column" = 'backlog' AND workspace_id = ?`)
      .get(workspaceResult.workspace.id) as { mp: number | null };
    const position = (maxPos.mp ?? -1) + 1;

    db.prepare(`
      INSERT INTO tasks (id, title, description, "column", position, agent_type, status, workspace_id, working_dir, created_at, updated_at)
      VALUES (?, ?, ?, 'backlog', ?, 'generic', 'idle', ?, ?, ?, ?)
    `).run(taskId, title, description, position, workspaceResult.workspace.id, workspaceResult.workspace.path, now, now);

    // Insert checklist items
    if (checklistItems.length > 0) {
      const insertItem = db.prepare(`
        INSERT INTO checklist_items (id, task_id, text, done, source, position, created_at)
        VALUES (?, ?, ?, ?, 'manual', ?, ?)
      `);
      const insertMany = db.transaction(() => {
        checklistItems.forEach((item, idx) => {
          insertItem.run(uuidv4(), taskId, item.text, item.done ? 1 : 0, idx, now);
        });
      });
      insertMany();
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: 'Failed to import issue', detail: String(err) });
  }
});

export default router;
