/**
 * Cloudflare Pages Function — Admin: View & Manage Registrations
 *
 * POST /api/registrations  { key, action: 'list' }               → list all
 * POST /api/registrations  { key, action: 'list', workshop: 'X' } → filter by workshop
 * POST /api/registrations  { key, action: 'accept'|'reject', regId, message? }
 * POST /api/registrations  { key, action: 'issue-certificate', regId, certType }
 * POST /api/registrations  { key, action: 'award-badge', regId, badgeId }
 */

import {
  corsHeaders,
  optionsResponse,
  escapeHtml,
  hashPassword,
  generateToken,
  generatePassword,
  sendEmail,
  constantTimeCompare,
  parseJsonBody,
} from '../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_KEY: string;
  RESEND_API_KEY?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, 'POST, OPTIONS');

  try {
    const body = await parseJsonBody<{
      key: string;
      action: 'list' | 'accept' | 'reject' | 'issue-certificate' | 'award-badge';
      regId?: string;
      workshop?: string;
      message?: string;
      certType?: 'participation' | 'achievement' | 'contribution';
      badgeId?: string;
    }>(request);

    if (!body) {
      return new Response(JSON.stringify({ error: 'Invalid or oversized request body' }), { status: 400, headers });
    }

    if (!env.ADMIN_KEY || !body.key || !constantTimeCompare(body.key, env.ADMIN_KEY)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    if (!body.action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400, headers });
    }

    // ── LIST REGISTRATIONS ──
    if (body.action === 'list') {
      if (!env.REGISTRATIONS) {
        return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
      }
      const list = await env.REGISTRATIONS.list({ prefix: 'reg_' });
      const kvResults = await Promise.all(list.keys.map((k) => env.REGISTRATIONS.get(k.name)));
      const registrations = kvResults
        .filter((data): data is string => data !== null)
        .map((data) => JSON.parse(data))
        .filter((reg) => !body.workshop || reg.workshop === body.workshop);
      registrations.sort(
        (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      const total = await env.REGISTRATIONS.get('count:total');
      return new Response(
        JSON.stringify({ total: parseInt(total || '0'), count: registrations.length, registrations }),
        { status: 200, headers },
      );
    }

    if (!body.regId || !/^reg_\d+_[a-z0-9]+$/.test(body.regId)) {
      return new Response(JSON.stringify({ error: 'Invalid regId' }), { status: 400, headers });
    }

    const regData = await env.REGISTRATIONS.get(body.regId);
    if (!regData) {
      return new Response(JSON.stringify({ error: 'Registration not found' }), { status: 404, headers });
    }

    const reg = JSON.parse(regData);

    // ── ISSUE CERTIFICATE ──
    if (body.action === 'issue-certificate') {
      if (!body.certType) {
        return new Response(JSON.stringify({ error: 'Missing certType' }), { status: 400, headers });
      }

      reg.status = 'completed';
      reg.reviewedAt = new Date().toISOString();
      await env.REGISTRATIONS.put(body.regId, JSON.stringify(reg), {
        expirationTtl: 60 * 60 * 24 * 365,
      });

      const counterData = await env.REGISTRATIONS.get('cert:counter');
      const counter = parseInt(counterData || '0') + 1;
      await env.REGISTRATIONS.put('cert:counter', String(counter));
      const certId = `LEGERE-${new Date().getFullYear()}-${String(counter).padStart(3, '0')}`;

      const cert = {
        id: certId,
        type: body.certType,
        participantName: reg.name,
        participantEmail: reg.email,
        workshopId: reg.workshop,
        workshopTitle: { tr: reg.workshop, en: reg.workshop },
        issueDate: new Date().toISOString().split('T')[0],
        issuedBy: 'admin',
      };

      await env.REGISTRATIONS.put(`cert:${certId}`, JSON.stringify(cert), {
        expirationTtl: 60 * 60 * 24 * 365 * 5,
      });

      const memberKey = `member:${reg.email.toLowerCase()}`;
      const memberData = await env.REGISTRATIONS.get(memberKey);
      if (memberData) {
        const member = JSON.parse(memberData);
        if (!member.certificates) member.certificates = [];
        member.certificates.push({
          id: certId,
          type: body.certType,
          workshopId: reg.workshop,
          issueDate: cert.issueDate,
        });
        await env.REGISTRATIONS.put(memberKey, JSON.stringify(member), {
          expirationTtl: 60 * 60 * 24 * 365,
        });
      }

      const typeNames: Record<string, string> = {
        participation: 'Katilim',
        achievement: 'Basari',
        contribution: 'Katki',
      };
      const safeName = escapeHtml(reg.name);
      const safeWorkshop = escapeHtml(reg.workshop);

      const emailSent = await sendEmail(
        env.RESEND_API_KEY,
        reg.email,
        `${typeNames[body.certType]} Sertifikaniz Hazir — ${reg.workshop}`,
        `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1></div>
          <h2 style="color:#D4A843;">Tebrikler, ${safeName}!</h2>
          <p style="color:#A0A0B0;line-height:1.6;"><strong style="color:#D4A843;">${safeWorkshop}</strong> atolyesi icin <strong style="color:#4ADE80;">${typeNames[body.certType]} Sertifikaniz</strong> duzenlenmistir.</p>
          <p style="color:#A0A0B0;line-height:1.6;">Sertifika No: <strong style="color:#D4A843;font-family:monospace;">${certId}</strong></p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://legereopenedu.com/profile" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Profilimde Goruntule</a>
          </div>
          <p style="color:#666;font-size:12px;text-align:center;">Dogrulama: legereopenedu.com/verify?cert=${certId}</p>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
          <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
        </div>`,
      );

      return new Response(JSON.stringify({ success: true, certId, emailSent }), { status: 200, headers });
    }

    // ── AWARD BADGE ──
    if (body.action === 'award-badge') {
      if (!body.badgeId) {
        return new Response(JSON.stringify({ error: 'Missing badgeId' }), { status: 400, headers });
      }

      const memberKey = `member:${reg.email.toLowerCase()}`;
      const memberData = await env.REGISTRATIONS.get(memberKey);
      if (!memberData) {
        return new Response(
          JSON.stringify({ error: 'Member not found. Accept the registration first.' }),
          { status: 404, headers },
        );
      }

      const member = JSON.parse(memberData);
      if (!member.adminBadges) member.adminBadges = [];

      if (!member.adminBadges.some((b: any) => b.badgeId === body.badgeId)) {
        member.adminBadges.push({
          badgeId: body.badgeId,
          awardedAt: new Date().toISOString(),
          awardedBy: 'admin',
        });
        await env.REGISTRATIONS.put(memberKey, JSON.stringify(member), {
          expirationTtl: 60 * 60 * 24 * 365,
        });
      }

      return new Response(JSON.stringify({ success: true, badgeId: body.badgeId }), {
        status: 200,
        headers,
      });
    }

    // ── ACCEPT / REJECT ──
    reg.status = body.action === 'accept' ? 'accepted' : 'rejected';
    reg.reviewedAt = new Date().toISOString();
    reg.adminMessage = body.message || '';

    await env.REGISTRATIONS.put(body.regId, JSON.stringify(reg), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    let memberPassword = '';
    if (body.action === 'accept') {
      const memberKey = `member:${reg.email.toLowerCase()}`;
      const existingMember = await env.REGISTRATIONS.get(memberKey);

      if (!existingMember) {
        memberPassword = generatePassword();
        await env.REGISTRATIONS.put(
          memberKey,
          JSON.stringify({
            email: reg.email.toLowerCase(),
            name: reg.name,
            password: await hashPassword(memberPassword),
            token: generateToken(),
            university: reg.university,
            department: reg.department,
            joinDate: new Date().toISOString().split('T')[0],
            showFullName: true,
            showEmail: false,
            certificates: [],
            adminBadges: [],
            regIds: [body.regId],
          }),
          { expirationTtl: 60 * 60 * 24 * 365 },
        );
      } else {
        const member = JSON.parse(existingMember);
        if (!member.regIds) member.regIds = [];
        if (!member.regIds.includes(body.regId)) member.regIds.push(body.regId);
        await env.REGISTRATIONS.put(memberKey, JSON.stringify(member), {
          expirationTtl: 60 * 60 * 24 * 365,
        });
      }
    }

    let emailSent = false;
    if (env.RESEND_API_KEY && reg.email) {
      const isAccepted = body.action === 'accept';
      const safeName = escapeHtml(reg.name);
      const safeWorkshop = escapeHtml(reg.workshop);
      const safeMessage = body.message ? escapeHtml(body.message) : '';
      const safeEmail = escapeHtml(reg.email);

      const subject = isAccepted
        ? `Atolye Basvurunuz Kabul Edildi — ${reg.workshop}`
        : `Atolye Basvuru Sonucu — ${reg.workshop}`;

      const htmlBody = isAccepted
        ? `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1></div>
            <h2 style="color:#4ADE80;">Tebrikler, ${safeName}!</h2>
            <p style="color:#A0A0B0;line-height:1.6;"><strong style="color:#D4A843;">${safeWorkshop}</strong> atolyesine basvurunuz <strong style="color:#4ADE80;">kabul edilmistir</strong>.</p>
            ${safeMessage ? `<div style="background:rgba(212,168,67,0.1);border-left:3px solid #D4A843;padding:12px 16px;margin:16px 0;border-radius:4px;"><p style="color:#A0A0B0;margin:0;">${safeMessage}</p></div>` : ''}
            <p style="color:#A0A0B0;line-height:1.6;">Google Classroom sinif kodu ve katilim daveti ayrica gonderilecektir.</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="https://teams.live.com/l/community/FEApfJqwPQhu1UpbAI" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Teams Topluluguna Katil</a>
            </div>
            ${memberPassword ? `
            <div style="background:rgba(212,168,67,0.05);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:16px;margin:16px 0;text-align:center;">
              <p style="color:#A0A0B0;font-size:13px;margin:0 0 8px 0;">Giris Bilgileriniz:</p>
              <p style="color:#A0A0B0;font-size:13px;margin:0 0 4px 0;">E-posta: <strong style="color:#F0EDE6;">${safeEmail}</strong></p>
              <p style="color:#A0A0B0;font-size:13px;margin:0 0 12px 0;">Sifre: <strong style="color:#D4A843;font-family:monospace;font-size:16px;letter-spacing:2px;">${escapeHtml(memberPassword)}</strong></p>
              <a href="https://legereopenedu.com/login" style="display:inline-block;background:rgba(212,168,67,0.15);color:#D4A843;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Giris Yap</a>
            </div>` : ''}
            <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
            <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
          </div>`
        : `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1></div>
            <h2 style="color:#F0EDE6;">Sayin ${safeName},</h2>
            <p style="color:#A0A0B0;line-height:1.6;"><strong style="color:#D4A843;">${safeWorkshop}</strong> atolyesine basvurunuz degerlendirilmistir. Maalesef bu donem kontenjan ve konu uyumu nedeniyle basvurunuz kabul edilememistir.</p>
            ${safeMessage ? `<div style="background:rgba(212,168,67,0.1);border-left:3px solid #D4A843;padding:12px 16px;margin:16px 0;border-radius:4px;"><p style="color:#A0A0B0;margin:0;">${safeMessage}</p></div>` : ''}
            <p style="color:#A0A0B0;line-height:1.6;">Gelecek atolyelerimizi takip etmenizi oneririz.</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="https://legereopenedu.com" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Atolyeleri Incele</a>
            </div>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
            <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
          </div>`;

      emailSent = await sendEmail(env.RESEND_API_KEY, reg.email, subject, htmlBody);
    }

    return new Response(JSON.stringify({ success: true, status: reg.status, emailSent }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('[registrations] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, 'POST, OPTIONS');
};
