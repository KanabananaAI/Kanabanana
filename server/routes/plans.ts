import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

// ---------- Types ----------

interface PlanRow {
  id: string;
  title: string;
  description: string;
  original_prompt: string;
  agent_type: string;
  model: string;
  workspace_id: string;
  status: string;
  error: string;
  suggested_tags: string;
  suggested_deps: string;
  created_at: string;
  used_at: string | null;
}

interface PlanChecklistRow {
  id: string;
  plan_id: string;
  text: string;
  position: number;
}

// ---------- Helpers ----------

export function formatPlan(plan: PlanRow) {
  const checklist = db
    .prepare('SELECT * FROM plan_checklist_items WHERE plan_id = ? ORDER BY position')
    .all(plan.id) as PlanChecklistRow[];

  return {
    id: plan.id,
    title: plan.title,
    description: plan.description,
    originalPrompt: plan.original_prompt,
    agentType: plan.agent_type,
    model: plan.model,
    workspaceId: plan.workspace_id,
    status: plan.status,
    error: plan.error,
    suggestedTags: JSON.parse(plan.suggested_tags || '[]'),
    suggestedDeps: JSON.parse(plan.suggested_deps || '[]'),
    checklistItems: checklist.map((c) => ({
      id: c.id,
      planId: c.plan_id,
      text: c.text,
      position: c.position,
    })),
    createdAt: plan.created_at,
    usedAt: plan.used_at,
  };
}

// ---------- Prepared statements ----------

const getAllPlans = db.prepare(
  'SELECT * FROM plans WHERE workspace_id = ? ORDER BY created_at DESC'
);
const getPlanById = db.prepare('SELECT * FROM plans WHERE id = ?');

// ---------- Routes ----------

// GET /api/plans?workspaceId=X
router.get('/api/plans', (req: Request, res: Response) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || '';
    const plans = getAllPlans.all(workspaceId) as PlanRow[];
    res.json(plans.map(formatPlan));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans', detail: String(err) });
  }
});

// GET /api/plans/:id
router.get('/api/plans/:id', (req: Request, res: Response) => {
  try {
    const plan = getPlanById.get(req.params.id) as PlanRow | undefined;
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }
    res.json(formatPlan(plan));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plan', detail: String(err) });
  }
});

// POST /api/plans — creates plan row with status 'interviewing', returns immediately.
// Actual generation is triggered by server/index.ts via spawnPlannerAgent().
router.post('/api/plans', (req: Request, res: Response) => {
  try {
    const { prompt, agentType, model, workspaceId } = req.body;

    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO plans (id, original_prompt, agent_type, model, workspace_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'interviewing', ?)
    `).run(id, prompt.trim(), agentType || 'claude', model || '', workspaceId || '', now);

    const plan = getPlanById.get(id) as PlanRow;
    res.status(201).json(formatPlan(plan));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create plan', detail: String(err) });
  }
});

// PATCH /api/plans/:id
router.patch('/api/plans/:id', (req: Request, res: Response) => {
  try {
    const plan = getPlanById.get(req.params.id) as PlanRow | undefined;
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    const allowedFields: Record<string, string> = {
      status: 'status',
      usedAt: 'used_at',
      title: 'title',
      description: 'description',
      suggestedTags: 'suggested_tags',
      suggestedDeps: 'suggested_deps',
    };

    const updates: string[] = [];
    const values: unknown[] = [];

    for (const [camel, snake] of Object.entries(allowedFields)) {
      if (req.body[camel] !== undefined) {
        updates.push(`${snake} = ?`);
        const val = req.body[camel];
        values.push(Array.isArray(val) ? JSON.stringify(val) : val);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    values.push(req.params.id);
    db.prepare(`UPDATE plans SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = getPlanById.get(req.params.id) as PlanRow;
    res.json(formatPlan(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan', detail: String(err) });
  }
});

// DELETE /api/plans/:id
router.delete('/api/plans/:id', (req: Request, res: Response) => {
  try {
    const plan = getPlanById.get(req.params.id) as PlanRow | undefined;
    if (!plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    db.prepare('DELETE FROM plan_checklist_items WHERE plan_id = ?').run(req.params.id);
    db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete plan', detail: String(err) });
  }
});

export default router;
