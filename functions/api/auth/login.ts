/**
 * Auth Login — E-posta + şifre ile giriş
 *
 * POST /api/auth/login  { email, password }
 *   → member:{email} KV'den kontrol
 *   → Şifre doğru ise legere_token cookie set
 *   → JSON { success: true }
 */

interface Env {
  REGISTRATIONS: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = origin.endsWith('legereopenedu.com') ? origin : 'https://legereopenedu.com';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
  };

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers });
    }

    // Direct lookup — O(1), no scanning
    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
    }

    const member = JSON.parse(memberData);
    if (member.password !== password) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
    }

    // Set session cookie
    const cookieValue = `${encodeURIComponent(email)}:${member.token}`;
    const maxAge = 30 * 24 * 60 * 60; // 30 days

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...headers,
        'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  const origin = context.request.headers.get('Origin') || '';
  const allowedOrigin = origin.endsWith('legereopenedu.com') ? origin : 'https://legereopenedu.com';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
