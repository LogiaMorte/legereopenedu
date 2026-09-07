/**
 * Rate limiting middleware for auth endpoints.
 * KV-based: 20 requests per minute per IP.
 * Fail-open on KV errors — never block legitimate users due to infra issues.
 */

interface Env {
  REGISTRATIONS: KVNamespace;
}

const RATE_LIMIT = 20;
const WINDOW_SECONDS = 60;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;

  if (request.method === 'OPTIONS') return next();

  if (env.REGISTRATIONS) {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const key = `ratelimit:${ip}`;
      const now = Math.floor(Date.now() / 1000);

      const data = await env.REGISTRATIONS.get(key);
      let record: { count: number; windowStart: number } | null = null;

      if (data) {
        record = JSON.parse(data);
      }

      if (!record || now - record.windowStart >= WINDOW_SECONDS) {
        record = { count: 1, windowStart: now };
      } else {
        record.count++;
      }

      if (record.count > RATE_LIMIT) {
        return new Response(
          JSON.stringify({ error: 'Too many requests. Please try again later.' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(WINDOW_SECONDS - (now - record.windowStart)),
            },
          },
        );
      }

      await env.REGISTRATIONS.put(key, JSON.stringify(record), {
        expirationTtl: WINDOW_SECONDS * 2,
      });
    } catch {
      // Fail open — don't block on KV errors
    }
  }

  return next();
};
