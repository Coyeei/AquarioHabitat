import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import authRoutes from './routes/auth.js';
import propertiesRoutes from './routes/properties.js';
import usersRoutes from './routes/users.js';
import alertsRoutes from './routes/alerts.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/alerts', alertsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API en puerto ${port}`));
