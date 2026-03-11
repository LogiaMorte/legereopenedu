/**
 * Auth Recover — Şifre sıfırlama (yeni şifre oluştur, e-posta ile gönder)
 *
 * POST /api/auth/recover  { email: "x@y.edu.tr" }
 *   → member:{email} KV'de var mı kontrol
 *   → Varsa: yeni şifre oluştur, hash'le, kaydet, e-posta gönder
 */

import {
  corsHeaders,
  optionsResponse,
  escapeHtml,
  hashPassword,
  generatePassword,
  sendEmail,
} from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  RESEND_API_KEY?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  try {
    const body = (await request.json()) as { email: string };
    const email = body.email?.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers });
    }

    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      // Don't reveal if email exists or not (security)
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    const member = JSON.parse(memberData);
    const newPassword = generatePassword();
    member.password = await hashPassword(newPassword);

    await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    const safeName = escapeHtml(member.name || '');
    const safeEmail = escapeHtml(email);

    await sendEmail(
      env.RESEND_API_KEY,
      email,
      'Yeni Sifreniz — Legere Open Edu',
      `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1>
        </div>
        <h2 style="color:#F0EDE6;">Merhaba ${safeName},</h2>
        <p style="color:#A0A0B0;line-height:1.6;">
          Sifre sifirlama talebiniz alindi. Yeni giris bilgileriniz asagidadir:
        </p>
        <div style="background:rgba(212,168,67,0.05);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:16px;margin:16px 0;text-align:center;">
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 4px 0;">E-posta: <strong style="color:#F0EDE6;">${safeEmail}</strong></p>
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 12px 0;">Yeni Sifre: <strong style="color:#D4A843;font-family:monospace;font-size:16px;letter-spacing:2px;">${escapeHtml(newPassword)}</strong></p>
          <a href="https://legereopenedu.com/login" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Giris Yap</a>
        </div>
        <p style="color:#666;font-size:12px;text-align:center;">Bu e-postayi siz talep etmediyseniz, lutfen dikkate almayin.</p>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
        <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
      </div>`,
    );

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error('[recover] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
