import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// Alta de usuario (crea con password) — protégela o quítala una vez cargados los usuarios iniciales.
router.post('/register', async (req, res) => {
  const { name, email, password, profile, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
  const password_hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, profile, role) VALUES ($1,$2,$3,$4,COALESCE($5,'agent'))
       RETURNING id, name, email, role`,
      [name, email, password_hash, profile, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ya registrado' });
    throw err;
  }
});

export default router;
