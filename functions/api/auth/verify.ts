/**
 * Auth Verify — Token doğrulama + session cookie set + redirect
 *
 * GET /api/auth/verify?token=UNIQUE_TOKEN
 *   → member KV'de token kontrolü
 *   → Cookie set → /profile redirect
 */

interface Env {
  REGISTRATIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token || !env.REGISTRATIONS) {
    return new Response(redirectHTML('/login', 'Geçersiz bağlantı.'), {
      status: 302,
      headers: { 'Content-Type': 'text/html', 'Location': '/login' },
    });
  }

  try {
    // Search for member with this token
    const memberList = await env.REGISTRATIONS.list({ prefix: 'member:' });
    let foundMember: any = null;
    let foundKey = '';

    for (const k of memberList.keys) {
      const data = await env.REGISTRATIONS.get(k.name);
      if (data) {
        const member = JSON.parse(data);
        if (member.token === token) {
          foundMember = member;
          foundKey = k.name;
          break;
        }
      }
    }

    if (!foundMember) {
      return new Response(redirectHTML('/login', 'Geçersiz veya süresi dolmuş bağlantı.'), {
        status: 302,
        headers: { 'Content-Type': 'text/html', 'Location': '/login' },
      });
    }

    // Set cookie: email:token
    const cookieValue = `${encodeURIComponent(foundMember.email)}:${token}`;
    const maxAge = 30 * 24 * 60 * 60; // 30 days

    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/profile',
        'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });
  } catch (error) {
    return new Response(redirectHTML('/login', 'Bir hata oluştu.'), {
      status: 302,
      headers: { 'Content-Type': 'text/html', 'Location': '/login' },
    });
  }
};

function redirectHTML(url: string, message: string): string {
  return `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${url}"></head><body><p>${message}</p></body></html>`;
}
