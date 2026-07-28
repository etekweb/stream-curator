import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamersRouter } from './routes/streamers.js';
import { metaRouter } from './routes/meta.js';
import { youtubeRouter } from './routes/youtube.js';
import { rumbleRouter } from './routes/rumble.js';
import { avatarsRouter } from './routes/avatars.js';
import { pool } from './db.js';
import { ensureSchema } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = Number(process.env.PORT || 3002);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://localhost:5175';

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow local Vite, nip.io / sslip.io LAN hosts, and same-origin (no Origin header)
      if (!origin) return cb(null, true);
      const allowed = [
        CLIENT_ORIGIN,
        'https://localhost',
        'https://localhost:443',
        'http://localhost:5175',
        'https://localhost:5175',
        'http://127.0.0.1:5175',
        'https://127.0.0.1:5175',
        'http://localhost:5173',
        'https://localhost:5173',
      ];
      if (allowed.includes(origin)) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (
          host === 'localhost' ||
          host.endsWith('.nip.io') ||
          host.endsWith('.sslip.io')
        ) {
          return cb(null, true);
        }
      } catch {
        /* ignore */
      }
      cb(null, false);
    },
  })
);
app.use(express.json({ limit: '1mb' }));

app.use('/api', metaRouter);
app.use('/api/streamers', streamersRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/rumble', rumbleRouter);
app.use('/api/avatars', avatarsRouter);

// Production: serve Vue build
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
);

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('MySQL connection OK');
    await ensureSchema(pool);
  } catch (err) {
    console.error('MySQL connection failed:', err);
    console.error('Run `npm run db:setup` after configuring .env');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use. An old server process is still bound.\n` +
          `  Fix: fuser -k ${PORT}/tcp   (or kill the old node/tsx process), then restart.\n` +
          `  Under Supervisor use "npm run start:supervised" (no tsx watch) to avoid orphans.`
      );
      process.exit(1);
    }
    throw err;
  });

  // Supervisor / systemd send SIGTERM on restart — close cleanly so the port frees
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down…`);
    server.close((closeErr) => {
      if (closeErr) console.error(closeErr);
      pool
        .end()
        .catch(() => undefined)
        .finally(() => process.exit(closeErr ? 1 : 0));
    });
    // Force exit if hang (open sockets / stuck MySQL)
    setTimeout(() => {
      console.error('Forced exit after shutdown timeout');
      process.exit(1);
    }, 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
