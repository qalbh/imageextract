import type { APIRoute } from 'astro';
import { z } from 'zod';
import { errorResponse, json } from '../../lib/api-errors';
import { scanPage } from '../../lib/scan';

export const prerender = false;

const querySchema = z.object({ url: z.string().min(1).max(4096) });

export const GET: APIRoute = async ({ url }) => {
  const parsed = querySchema.safeParse({ url: url.searchParams.get('url') ?? '' });
  if (!parsed.success) {
    return json(400, { error: 'invalid-request', message: 'Provide a url query parameter.' });
  }
  try {
    return json(200, await scanPage(parsed.data.url));
  } catch (err) {
    return errorResponse(err);
  }
};
