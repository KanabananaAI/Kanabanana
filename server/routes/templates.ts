import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

// ---------- Types ----------

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  command: string;
  checklist_defaults: string;
  created_at: string;
}

// ---------- Prepared statements ----------

const getAllTemplates = db.prepare('SELECT * FROM templates ORDER BY created_at DESC');
const getTemplateById = db.prepare('SELECT * FROM templates WHERE id = ?');

// ---------- Routes ----------

/**
 * GET /api/templates — Get all templates
 */
router.get('/api/templates', (_req: Request, res: Response) => {
  try {
    const templates = getAllTemplates.all() as TemplateRow[];

    const parsed = templates.map((t) => ({
      ...t,
      checklist_defaults: JSON.parse(t.checklist_defaults || '[]'),
    }));

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch templates', detail: String(err) });
  }
});

/**
 * POST /api/templates — Create a new template
 */
router.post('/api/templates', (req: Request, res: Response) => {
  try {
    const { name, description, agent_type, command, checklist_defaults = [] } = req.body;

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO templates (id, name, description, agent_type, command, checklist_defaults, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, agent_type, command, JSON.stringify(checklist_defaults), now);

    const created = getTemplateById.get(id) as TemplateRow;
    res.status(201).json({
      ...created,
      checklist_defaults: JSON.parse(created.checklist_defaults || '[]'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create template', detail: String(err) });
  }
});

/**
 * PUT /api/templates/:id — Update a template
 */
router.put('/api/templates/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = getTemplateById.get(id) as TemplateRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    const allowedFields = ['name', 'description', 'agent_type', 'command', 'checklist_defaults'];
    const updates: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        if (field === 'checklist_defaults') {
          values.push(JSON.stringify(req.body[field]));
        } else {
          values.push(req.body[field]);
        }
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    values.push(id);
    db.prepare(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = getTemplateById.get(id) as TemplateRow;
    res.json({
      ...updated,
      checklist_defaults: JSON.parse(updated.checklist_defaults || '[]'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update template', detail: String(err) });
  }
});

/**
 * DELETE /api/templates/:id — Delete a template
 */
router.delete('/api/templates/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = getTemplateById.get(id) as TemplateRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete template', detail: String(err) });
  }
});

export default router;
