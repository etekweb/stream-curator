import { Router } from 'express';
import { resolveYouTubeLive } from '../services/youtube.js';

export const youtubeRouter = Router();

/**
 * GET /api/youtube/resolve-live?username=…&channelId=…&embedDomain=…
 * Optional: refresh=1 to bypass short cache
 */
youtubeRouter.get('/resolve-live', async (req, res) => {
  try {
    const username =
      typeof req.query.username === 'string' ? req.query.username : undefined;
    const channelId =
      typeof req.query.channelId === 'string' ? req.query.channelId : undefined;
    const embedDomain =
      (typeof req.query.embedDomain === 'string' && req.query.embedDomain) ||
      (typeof req.query.parent === 'string' && req.query.parent) ||
      req.get('x-forwarded-host')?.split(':')[0] ||
      'localhost';
    const bypassCache =
      req.query.refresh === '1' ||
      req.query.refresh === 'true' ||
      req.query.nocache === '1';

    if (!username && !channelId) {
      res.status(400).json({
        error: 'Provide username and/or channelId query parameters',
      });
      return;
    }

    const data = await resolveYouTubeLive({
      username,
      channelId,
      embedDomain,
      bypassCache,
    });

    res.json({ data });
  } catch (err) {
    console.error('[youtube] resolve-live error', err);
    res.status(500).json({ error: 'Failed to resolve YouTube live stream' });
  }
});
