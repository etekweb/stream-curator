import { Router } from 'express';
import { PLATFORMS } from '../types.js';
import { PLATFORM_META } from '../platforms.js';

export const metaRouter = Router();

metaRouter.get('/platforms', (_req, res) => {
  res.json({
    data: PLATFORMS.map((id) => ({
      id,
      ...PLATFORM_META[id],
    })),
  });
});

metaRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});
