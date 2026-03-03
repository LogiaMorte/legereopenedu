/**
 * Auth Recover — Token kurtarma (e-posta ile yeni giriş linki gönder)
 *
 * POST /api/auth/recover  { email: "x@y.edu.tr" }
 *   → member:{email} KV'de var mı kontrol
 *   → Varsa: mevcut token ile giriş linki e-posta gönder
 *   → Resend e-posta: 1 (nadir kullanım)
 */

interface Env {
  REGISTRATIONS: KVNamespace;
  RESEND_API_KEY?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  try {
    const body = await request.json() as { email: string };
    const email = body.email?.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers });
    }

    // Check if member exists
    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      // Don't reveal if email exists or not (security)
      return new Response(JSON.stringify({ success: true, message: 'If this email is registered, a login link will be sent.' }), { status: 200, headers });
    }

    const member = JSON.parse(memberData);

    // Send recovery email via Resend
    if (env.RESEND_API_KEY) {
      const loginUrl = `https://legereopenedu.com/api/auth/verify?token=${member.token}`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'Legere Open Edu <info@legereopenedu.com>',
          to: [email],
          subject: '🔑 Legere Profil Giriş Linkiniz',
          html: `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0A0A0F; color: #F0EDE6; border-radius: 12px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #D4A843; font-size: 24px; margin: 0;">Legere Open Edu</h1>
              </div>
              <h2 style="color: #F0EDE6;">Merhaba ${member.name},</h2>
              <p style="color: #A0A0B0; line-height: 1.6;">
                Profil sayfanıza erişmek için aşağıdaki butona tıklayın. Bu link size özeldir, başkasıyla paylaşmayın.
              </p>
              <div style="text-align: center; margin: 24px 0;">
                <a href="${loginUrl}" style="display: inline-block; background: linear-gradient(135deg, #B8922E, #D4A843); color: #0A0A0F; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Profilime Git</a>
              </div>
              <p style="color: #666; font-size: 12px; text-align: center;">Bu e-postayı siz talep etmediyseniz, lütfen dikkate almayın.</p>
              <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 24px 0;">
              <p style="color: #666; font-size: 12px; text-align: center;">Legere Open Edu — legereopenedu.com</p>
            </div>
          `,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'If this email is registered, a login link will be sent.' }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
