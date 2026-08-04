import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { description, criteria, channel = 'email' } = req.body || {};
  if (!description || !criteria) return res.status(400).json({ error: 'description y criteria requeridos' });
  const { rows } = await pool.query(
    `INSERT INTO alerts (user_id, description, criteria, channel) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, description, criteria, channel]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM alerts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.status(204).end();
});

export default router;
