import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

// ---------- Types ----------

interface SkillRow {
  id: string;
  name: string;
  description: string;
  command: string;
  agent_types: string;
  is_custom: number;
  created_at: string;
}

// ---------- Prepared statements ----------

const getAllSkills = db.prepare('SELECT * FROM skills ORDER BY created_at ASC');
const getSkillById = db.prepare('SELECT * FROM skills WHERE id = ?');

// ---------- Helper ----------

function parseSkillRow(row: SkillRow) {
  return {
    ...row,
    agent_types: JSON.parse(row.agent_types || '["*"]'),
    is_custom: Boolean(row.is_custom),
  };
}

// ---------- Routes ----------

/**
 * GET /api/skills — Get all skills, optionally filtered by agent_type
 */
router.get('/api/skills', (req: Request, res: Response) => {
  try {
    const { agent_type } = req.query;
    let skills = getAllSkills.all() as SkillRow[];

    if (agent_type && typeof agent_type === 'string') {
      skills = skills.filter((skill) => {
        const types: string[] = JSON.parse(skill.agent_types || '["*"]');
        return types.includes('*') || types.includes(agent_type);
      });
    }

    res.json(skills.map(parseSkillRow));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch skills', detail: String(err) });
  }
});

/**
 * POST /api/skills — Create a custom skill
 */
router.post('/api/skills', (req: Request, res: Response) => {
  try {
    const { name, description, command, agent_types = ['*'] } = req.body;

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO skills (id, name, description, command, agent_types, is_custom, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(id, name, description, command, JSON.stringify(agent_types), now);

    const created = getSkillById.get(id) as SkillRow;
    res.status(201).json(parseSkillRow(created));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create skill', detail: String(err) });
  }
});

/**
 * PUT /api/skills/:id — Update a skill
 */
router.put('/api/skills/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = getSkillById.get(id) as SkillRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    const allowedFields = ['name', 'description', 'command', 'agent_types'];
    const updates: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        if (field === 'agent_types') {
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
    db.prepare(`UPDATE skills SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = getSkillById.get(id) as SkillRow;
    res.json(parseSkillRow(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update skill', detail: String(err) });
  }
});

/**
 * DELETE /api/skills/:id — Delete a skill (only custom ones)
 */
router.delete('/api/skills/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = getSkillById.get(id) as SkillRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }

    if (!existing.is_custom) {
      res.status(403).json({ error: 'Cannot delete built-in skills' });
      return;
    }

    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete skill', detail: String(err) });
  }
});

export default router;
