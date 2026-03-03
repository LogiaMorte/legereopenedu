/**
 * Cloudflare Pages Function — Admin: View & Manage Registrations
 *
 * GET  /api/registrations?key=ADMIN_KEY           → list all
 * GET  /api/registrations?key=ADMIN_KEY&workshop=X → filter by workshop
 * POST /api/registrations                         → update status (accept/reject)
 */

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_KEY: string;
  RESEND_API_KEY?: string;
}

// GET removed — admin key must not be in URL query params (security)
// Use POST with { key, listAction: 'list', workshop?: string } instead

// POST — Update registration status (accept/reject) + send email
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://legereopenedu.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json() as {
      key: string;
      action: 'list' | 'accept' | 'reject' | 'issue-certificate' | 'award-badge';
      regId?: string;
      workshop?: string;
      message?: string;
      certType?: 'participation' | 'achievement' | 'contribution';
      badgeId?: string;
    };

    if (!env.ADMIN_KEY || body.key !== env.ADMIN_KEY) {
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
      const registrations = [];
      for (const k of list.keys) {
        const data = await env.REGISTRATIONS.get(k.name);
        if (data) {
          const reg = JSON.parse(data);
          if (!body.workshop || reg.workshop === body.workshop) {
            registrations.push(reg);
          }
        }
      }
      registrations.sort((a: any, b: any) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const total = await env.REGISTRATIONS.get('count:total');
      return new Response(
        JSON.stringify({ total: parseInt(total || '0'), count: registrations.length, registrations }),
        { status: 200, headers }
      );
    }

    if (!body.regId) {
      return new Response(JSON.stringify({ error: 'Missing regId' }), { status: 400, headers });
    }

    // Get registration
    const regData = await env.REGISTRATIONS.get(body.regId);
    if (!regData) {
      return new Response(JSON.stringify({ error: 'Registration not found' }), { status: 404, headers });
    }

    const reg = JSON.parse(regData);

    // Helper: generate random session token (cookie value) — crypto-safe
    function generateToken(): string {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }

    // Helper: generate short memorable password (sent in email) — crypto-safe
    function generatePassword(): string {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      let code = '';
      for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
      return 'LGR-' + code; // e.g. LGR-A3X9BK
    }

    // Helper: send email via Resend
    async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
      if (!env.RESEND_API_KEY) return false;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.RESEND_API_KEY}` },
          body: JSON.stringify({ from: 'Legere Open Edu <info@legereopenedu.com>', to: [to], subject, html }),
        });
        return res.ok;
      } catch { return false; }
    }

    // ── ISSUE CERTIFICATE ──
    if (body.action === 'issue-certificate') {
      if (!body.certType) {
        return new Response(JSON.stringify({ error: 'Missing certType' }), { status: 400, headers });
      }

      reg.status = 'completed';
      reg.reviewedAt = new Date().toISOString();
      await env.REGISTRATIONS.put(body.regId, JSON.stringify(reg), { expirationTtl: 60 * 60 * 24 * 365 });

      // Generate unique cert ID
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

      // Save cert for public verification
      await env.REGISTRATIONS.put(`cert:${certId}`, JSON.stringify(cert), { expirationTtl: 60 * 60 * 24 * 365 * 5 });

      // Add cert to member profile
      const memberKey = `member:${reg.email.toLowerCase()}`;
      const memberData = await env.REGISTRATIONS.get(memberKey);
      if (memberData) {
        const member = JSON.parse(memberData);
        if (!member.certificates) member.certificates = [];
        member.certificates.push({ id: certId, type: body.certType, workshopId: reg.workshop, issueDate: cert.issueDate });
        await env.REGISTRATIONS.put(memberKey, JSON.stringify(member), { expirationTtl: 60 * 60 * 24 * 365 });
      }

      const typeNames: Record<string, string> = { participation: 'Katılım', achievement: 'Başarı', contribution: 'Katkı' };
      const emailSent = await sendEmail(reg.email, `📜 ${typeNames[body.certType]} Sertifikanız Hazır — ${reg.workshop}`,
        `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1></div>
          <h2 style="color:#D4A843;">Tebrikler, ${reg.name}!</h2>
          <p style="color:#A0A0B0;line-height:1.6;"><strong style="color:#D4A843;">${reg.workshop}</strong> atölyesi için <strong style="color:#4ADE80;">${typeNames[body.certType]} Sertifikanız</strong> düzenlenmiştir.</p>
          <p style="color:#A0A0B0;line-height:1.6;">Sertifika No: <strong style="color:#D4A843;font-family:monospace;">${certId}</strong></p>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://legereopenedu.com/profile" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Profilimde Görüntüle</a>
          </div>
          <p style="color:#666;font-size:12px;text-align:center;">Doğrulama: legereopenedu.com/verify?cert=${certId}</p>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
          <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
        </div>`
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
        return new Response(JSON.stringify({ error: 'Member not found. Accept the registration first.' }), { status: 404, headers });
      }

      const member = JSON.parse(memberData);
      if (!member.adminBadges) member.adminBadges = [];

      // Avoid duplicates
      if (!member.adminBadges.some((b: any) => b.badgeId === body.badgeId)) {
        member.adminBadges.push({ badgeId: body.badgeId, awardedAt: new Date().toISOString(), awardedBy: 'admin' });
        await env.REGISTRATIONS.put(memberKey, JSON.stringify(member), { expirationTtl: 60 * 60 * 24 * 365 });
      }

      return new Response(JSON.stringify({ success: true, badgeId: body.badgeId }), { status: 200, headers });
    }

    // ── ACCEPT / REJECT ──
    reg.status = body.action === 'accept' ? 'accepted' : 'rejected';
    reg.reviewedAt = new Date().toISOString();
    reg.adminMessage = body.message || '';

    // Save updated status
    await env.REGISTRATIONS.put(body.regId, JSON.stringify(reg), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    // Create member profile on accept (with password + session token)
    let memberPassword = '';
    let isNewMember = false;
    if (body.action === 'accept') {
      const memberKey = `member:${reg.email.toLowerCase()}`;
      const existingMember = await env.REGISTRATIONS.get(memberKey);

      if (!existingMember) {
        // New member
        isNewMember = true;
        memberPassword = generatePassword();
        await env.REGISTRATIONS.put(memberKey, JSON.stringify({
          email: reg.email.toLowerCase(),
          name: reg.name,
          password: memberPassword,
          token: generateToken(),
          university: reg.university,
          department: reg.department,
          joinDate: new Date().toISOString().split('T')[0],
          showFullName: true,
          showEmail: false,
          certificates: [],
          adminBadges: [],
          regIds: [body.regId],
        }), { expirationTtl: 60 * 60 * 24 * 365 });
      } else {
        // Existing member — add regId, keep existing password
        const member = JSON.parse(existingMember);
        memberPassword = member.password;
        if (!member.regIds) member.regIds = [];
        if (!member.regIds.includes(body.regId)) member.regIds.push(body.regId);
        await env.REGISTRATIONS.put(memberKey, JSON.stringify(member), { expirationTtl: 60 * 60 * 24 * 365 });
      }
    }

    // Send email
    let emailSent = false;
    if (env.RESEND_API_KEY && reg.email) {
      const isAccepted = body.action === 'accept';

      const subject = isAccepted
        ? `✅ Atölye Başvurunuz Kabul Edildi — ${reg.workshop}`
        : `Atölye Başvuru Sonucu — ${reg.workshop}`;

      const htmlBody = isAccepted
        ? `
          <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0A0A0F; color: #F0EDE6; border-radius: 12px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #D4A843; font-size: 24px; margin: 0;">Legere Open Edu</h1>
            </div>
            <h2 style="color: #4ADE80;">Tebrikler, ${reg.name}!</h2>
            <p style="color: #A0A0B0; line-height: 1.6;">
              <strong style="color: #D4A843;">${reg.workshop}</strong> atölyesine başvurunuz <strong style="color: #4ADE80;">kabul edilmiştir</strong>.
            </p>
            ${body.message ? `<div style="background: rgba(212,168,67,0.1); border-left: 3px solid #D4A843; padding: 12px 16px; margin: 16px 0; border-radius: 4px;"><p style="color: #A0A0B0; margin: 0;">${body.message}</p></div>` : ''}
            <p style="color: #A0A0B0; line-height: 1.6;">
              Google Classroom sınıf kodu ve katılım daveti ayrıca gönderilecektir. Lütfen Microsoft Teams topluluğumuza da katılmayı unutmayın.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="https://teams.live.com/l/community/FEApfJqwPQhu1UpbAI" style="display: inline-block; background: linear-gradient(135deg, #B8922E, #D4A843); color: #0A0A0F; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Teams Topluluğuna Katıl</a>
            </div>
            ${memberPassword ? `
            <div style="background: rgba(212,168,67,0.05); border: 1px solid rgba(212,168,67,0.2); border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
              <p style="color: #A0A0B0; font-size: 13px; margin: 0 0 8px 0;">🔑 Giriş Bilgileriniz:</p>
              <p style="color: #A0A0B0; font-size: 13px; margin: 0 0 4px 0;">E-posta: <strong style="color: #F0EDE6;">${reg.email}</strong></p>
              <p style="color: #A0A0B0; font-size: 13px; margin: 0 0 12px 0;">Şifre: <strong style="color: #D4A843; font-family: monospace; font-size: 16px; letter-spacing: 2px;">${memberPassword}</strong></p>
              <a href="https://legereopenedu.com/login" style="display: inline-block; background: rgba(212,168,67,0.15); color: #D4A843; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Giriş Yap</a>
            </div>` : ''}
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 24px 0;">
            <p style="color: #666; font-size: 12px; text-align: center;">Legere Open Edu — legereopenedu.com</p>
          </div>
        `
        : `
          <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #0A0A0F; color: #F0EDE6; border-radius: 12px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #D4A843; font-size: 24px; margin: 0;">Legere Open Edu</h1>
            </div>
            <h2 style="color: #F0EDE6;">Sayın ${reg.name},</h2>
            <p style="color: #A0A0B0; line-height: 1.6;">
              <strong style="color: #D4A843;">${reg.workshop}</strong> atölyesine başvurunuz değerlendirilmiştir. Maalesef bu dönem kontenjan ve konu uyumu nedeniyle başvurunuz kabul edilememiştir.
            </p>
            ${body.message ? `<div style="background: rgba(212,168,67,0.1); border-left: 3px solid #D4A843; padding: 12px 16px; margin: 16px 0; border-radius: 4px;"><p style="color: #A0A0B0; margin: 0;">${body.message}</p></div>` : ''}
            <p style="color: #A0A0B0; line-height: 1.6;">
              Gelecek atölyelerimizi takip etmenizi öneririz. Microsoft Teams topluluğumuz üzerinden akademik sohbetlere ve kitap kulüplerine katılabilirsiniz.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="https://legereopenedu.com" style="display: inline-block; background: linear-gradient(135deg, #B8922E, #D4A843); color: #0A0A0F; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Atölyeleri İncele</a>
            </div>
            <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 24px 0;">
            <p style="color: #666; font-size: 12px; text-align: center;">Legere Open Edu — legereopenedu.com</p>
          </div>
        `;

      emailSent = await sendEmail(reg.email, subject, htmlBody);
    }

    return new Response(
      JSON.stringify({ success: true, status: reg.status, emailSent }),
      { status: 200, headers }
    );

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://legereopenedu.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
