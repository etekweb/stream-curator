import { Router } from 'express';
import { resolveRumbleLive } from '../services/rumble.js';

export const rumbleRouter = Router();

/**
 * GET /api/rumble/resolve-live?username=…
 * Optional: refresh=1 to bypass short cache
 */
rumbleRouter.get('/resolve-live', async (req, res) => {
  try {
    const username =
      typeof req.query.username === 'string' ? req.query.username : undefined;
    const bypassCache =
      req.query.refresh === '1' ||
      req.query.refresh === 'true' ||
      req.query.nocache === '1';

    if (!username?.trim()) {
      res.status(400).json({ error: 'Provide username query parameter' });
      return;
    }

    const data = await resolveRumbleLive({ username, bypassCache });
    res.json({ data });
  } catch (err) {
    console.error('[rumble] resolve-live error', err);
    res.status(500).json({ error: 'Failed to resolve Rumble live stream' });
  }
});
