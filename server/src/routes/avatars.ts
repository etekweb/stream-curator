import { Router } from 'express';
import { z } from 'zod';
import { PLATFORMS } from '../types.js';
import { resolveAvatar } from '../services/avatars.js';

export const avatarsRouter = Router();

const resolveSchema = z.object({
  platform: z.enum(PLATFORMS),
  username: z.string().trim().min(1).max(255),
  external_id: z.string().trim().max(255).nullable().optional(),
});

/**
 * POST /api/avatars/resolve
 * body: { platform, username, external_id? }
 */
avatarsRouter.post('/resolve', async (req, res) => {
  try {
    const body = resolveSchema.parse(req.body);
    const data = await resolveAvatar({
      platform: body.platform,
      username: body.username,
      externalId: body.external_id,
    });
    res.json({ data });
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      // zod
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status)
        : 500;
    const message =
      err instanceof Error ? err.message : 'Failed to resolve avatar';
    if (status >= 500) console.error('[avatars]', err);
    res.status(status || 500).json({ error: message });
  }
});
