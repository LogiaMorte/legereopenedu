/**
 * Cloudflare Pages Function — Workshop Registration API
 *
 * KV Binding: REGISTRATIONS (Cloudflare Dashboard'dan bağlanır)
 * Env vars: ADMIN_KEY, RESEND_API_KEY (opsiyonel)
 */

import { corsHeaders, optionsResponse } from '../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_KEY?: string;
  RESEND_API_KEY?: string;
}

interface RegistrationData {
  name: string;
  email: string;
  university: string;
  department: string;
  workshop: string;
  motivation?: string;
  timestamp: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  try {
    const data: RegistrationData = await request.json();

    if (!data.name || !data.email || !data.university || !data.department || !data.workshop) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers });
    }

    // Check for duplicate registration (same email + same workshop)
    if (env.REGISTRATIONS) {
      const indexKey = `index:${data.workshop.trim()}`;
      const existingIndex = await env.REGISTRATIONS.get(indexKey);
      if (existingIndex) {
        const ids: string[] = JSON.parse(existingIndex);
        for (const rid of ids) {
          const rd = await env.REGISTRATIONS.get(rid);
          if (rd) {
            const r = JSON.parse(rd);
            if (r.email?.toLowerCase() === data.email.trim().toLowerCase()) {
              return new Response(
                JSON.stringify({ error: 'Bu atölyeye zaten kayıt yaptınız.' }),
                { status: 409, headers },
              );
            }
          }
        }
        if (ids.length >= 50) {
          return new Response(
            JSON.stringify({ error: 'Bu atölyenin kontenjanı dolmuştur.' }),
            { status: 409, headers },
          );
        }
      }
    }

    // Sanitize & create registration
    const idBytes = new Uint8Array(4);
    crypto.getRandomValues(idBytes);
    const idSuffix = Array.from(idBytes, b => b.toString(36)).join('').slice(0, 8);
    const registration = {
      id: `reg_${Date.now()}_${idSuffix}`,
      name: data.name.trim().slice(0, 200),
      email: data.email.trim().toLowerCase().slice(0, 200),
      university: data.university.trim().slice(0, 200),
      department: data.department.trim().slice(0, 200),
      workshop: data.workshop.trim().slice(0, 200),
      motivation: (data.motivation || '').trim().slice(0, 1000),
      status: 'pending',
      timestamp: data.timestamp || new Date().toISOString(),
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      country: request.headers.get('CF-IPCountry') || 'unknown',
    };

    if (env.REGISTRATIONS) {
      await env.REGISTRATIONS.put(registration.id, JSON.stringify(registration), {
        expirationTtl: 60 * 60 * 24 * 365,
      });

      const indexKey = `index:${registration.workshop}`;
      const existingIndex = await env.REGISTRATIONS.get(indexKey);
      const ids: string[] = existingIndex ? JSON.parse(existingIndex) : [];
      ids.push(registration.id);
      await env.REGISTRATIONS.put(indexKey, JSON.stringify(ids));

      const countKey = 'count:total';
      const currentCount = parseInt((await env.REGISTRATIONS.get(countKey)) || '0');
      await env.REGISTRATIONS.put(countKey, String(currentCount + 1));
    }

    return new Response(JSON.stringify({ success: true, id: registration.id }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
