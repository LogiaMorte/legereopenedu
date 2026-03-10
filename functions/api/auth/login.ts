/**
 * Auth Login — E-posta + şifre ile giriş
 *
 * POST /api/auth/login  { email, password }
 *   → member:{email} KV'den kontrol
 *   → Şifre doğru ise legere_token cookie set
 *   → Eski plain-text şifreyi otomatik hash'e migrate et
 *   → JSON { success: true }
 */

import {
  corsHeaders,
  optionsResponse,
  verifyPassword,
  isPasswordHashed,
  hashPassword,
} from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers });
    }

    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
    }

    const member = JSON.parse(memberData);
    const valid = await verifyPassword(password, member.password);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
    }

    // Auto-migrate plain-text password to hash
    if (!isPasswordHashed(member.password)) {
      member.password = await hashPassword(password);
      await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
        expirationTtl: 60 * 60 * 24 * 365,
      });
    }

    const cookieValue = `${encodeURIComponent(email)}:${member.token}`;
    const maxAge = 30 * 24 * 60 * 60;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...headers,
        'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
