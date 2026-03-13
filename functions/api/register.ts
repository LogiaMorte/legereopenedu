/**
 * Cloudflare Pages Function — Workshop Registration API (Login Required)
 *
 * KV Binding: REGISTRATIONS (Cloudflare Dashboard'dan bağlanır)
 * Session cookie ile kimlik doğrulaması yapılır.
 * Üye bilgileri otomatik olarak member kaydından alınır.
 */

import { corsHeaders, optionsResponse, parseSessionCookie } from '../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_KEY?: string;
  RESEND_API_KEY?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  try {
    // Require authentication
    const session = parseSessionCookie(request);
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
    }

    if (!env.REGISTRATIONS) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
    }

    // Get member data
    const memberData = await env.REGISTRATIONS.get(`member:${session.email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);
    if (member.token !== session.token) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
    }

    const body = await request.json() as { workshop?: string; motivation?: string };

    if (!body.workshop?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const workshop = body.workshop.trim().slice(0, 200);

    // Check for duplicate registration (same member + same workshop)
    const indexKey = `index:${workshop}`;
    const existingIndex = await env.REGISTRATIONS.get(indexKey);
    if (existingIndex) {
      const ids: string[] = JSON.parse(existingIndex);
      for (const rid of ids) {
        const rd = await env.REGISTRATIONS.get(rid);
        if (rd) {
          const r = JSON.parse(rd);
          if (r.memberEmail?.toLowerCase() === session.email.toLowerCase() ||
              r.email?.toLowerCase() === session.email.toLowerCase()) {
            return new Response(
              JSON.stringify({ error: 'Bu etkinliğe zaten kayıt yaptınız.' }),
              { status: 409, headers },
            );
          }
        }
      }
      if (ids.length >= 50) {
        return new Response(
          JSON.stringify({ error: 'Bu etkinliğin kontenjanı dolmuştur.' }),
          { status: 409, headers },
        );
      }
    }

    // Create registration using member data
    const idBytes = new Uint8Array(4);
    crypto.getRandomValues(idBytes);
    const idSuffix = Array.from(idBytes, b => b.toString(36)).join('').slice(0, 8);
    const registration = {
      id: `reg_${Date.now()}_${idSuffix}`,
      name: member.name || '',
      email: member.email,
      memberEmail: member.email,
      university: member.university || '',
      department: member.department || '',
      workshop: workshop,
      motivation: (body.motivation || '').trim().slice(0, 1000),
      status: 'pending',
      timestamp: new Date().toISOString(),
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      country: request.headers.get('CF-IPCountry') || 'unknown',
    };

    // Store registration
    await env.REGISTRATIONS.put(registration.id, JSON.stringify(registration), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    // Update workshop index
    const ids: string[] = existingIndex ? JSON.parse(existingIndex) : [];
    ids.push(registration.id);
    await env.REGISTRATIONS.put(indexKey, JSON.stringify(ids));

    // Update total count
    const countKey = 'count:total';
    const currentCount = parseInt((await env.REGISTRATIONS.get(countKey)) || '0');
    await env.REGISTRATIONS.put(countKey, String(currentCount + 1));

    // Link registration to member record
    const regIds = member.regIds || [];
    regIds.push(registration.id);
    member.regIds = regIds;
    await env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    return new Response(JSON.stringify({ success: true, id: registration.id }), { status: 200, headers });
  } catch (err) {
    console.error('[register] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
