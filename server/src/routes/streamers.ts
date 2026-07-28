import { Router } from 'express';
import { ZodError } from 'zod';
import {
  createStreamer,
  deleteStreamer,
  getStreamer,
  listStreamers,
  reorderStreamers,
  updateStreamer,
} from '../services/streamers.js';
import { buildEmbedUrls } from '../platforms.js';
import {
  streamerCreateSchema,
  streamerUpdateSchema,
} from '../validation.js';
import { z } from 'zod';

export const streamersRouter = Router();

function clientError(err: unknown): { status: number; message: string } {
  if (err instanceof ZodError) {
    return {
      status: 400,
      message: err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    };
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY') {
      return { status: 409, message: 'A streamer with that name or platform already exists' };
    }
  }
  console.error(err);
  return { status: 500, message: 'Internal server error' };
}

streamersRouter.get('/', async (_req, res) => {
  try {
    const streamers = await listStreamers();
    res.json({ data: streamers });
  } catch (err) {
    const { status, message } = clientError(err);
    res.status(status).json({ error: message });
  }
});

const reorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

/** PUT /api/streamers/reorder  body: { ids: number[] } */
streamersRouter.put('/reorder', async (req, res) => {
  try {
    const { ids } = reorderSchema.parse(req.body);
    // Dedupe while preserving order
    const seen = new Set<number>();
    const unique = ids.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    await reorderStreamers(unique);
    const streamers = await listStreamers();
    res.json({ data: streamers });
  } catch (err) {
    const { status, message } = clientError(err);
    res.status(status).json({ error: message });
  }
});

streamersRouter.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const streamer = await getStreamer(id);
    if (!streamer) {
      res.status(404).json({ error: 'Streamer not found' });
      return;
    }

    const parentHost =
      (req.query.parent as string) ||
      req.get('x-forwarded-host')?.split(':')[0] ||
      'localhost';

    const embeds = streamer.platforms.map((p) =>
      buildEmbedUrls(p.platform, p.username, {
        parentHost,
        externalId: p.external_id,
      })
    );

    res.json({ data: { ...streamer, embeds } });
  } catch (err) {
    const { status, message } = clientError(err);
    res.status(status).json({ error: message });
  }
});

streamersRouter.post('/', async (req, res) => {
  try {
    const body = streamerCreateSchema.parse(req.body);
    // Ensure unique platforms in payload
    const platforms = body.platforms;
    const seen = new Set(platforms.map((p) => p.platform));
    if (seen.size !== platforms.length) {
      res.status(400).json({ error: 'Duplicate platforms in request' });
      return;
    }
    const streamer = await createStreamer(body);
    res.status(201).json({ data: streamer });
  } catch (err) {
    const { status, message } = clientError(err);
    res.status(status).json({ error: message });
  }
});

streamersRouter.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const body = streamerUpdateSchema.parse(req.body);
    if (body.platforms) {
      const seen = new Set(body.platforms.map((p) => p.platform));
      if (seen.size !== body.platforms.length) {
        res.status(400).json({ error: 'Duplicate platforms in request' });
        return;
      }
    }
    const streamer = await updateStreamer(id, body);
    if (!streamer) {
      res.status(404).json({ error: 'Streamer not found' });
      return;
    }
    res.json({ data: streamer });
  } catch (err) {
    const { status, message } = clientError(err);
    res.status(status).json({ error: message });
  }
});

streamersRouter.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const ok = await deleteStreamer(id);
    if (!ok) {
      res.status(404).json({ error: 'Streamer not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    const { status, message } = clientError(err);
    res.status(status).json({ error: message });
  }
});
