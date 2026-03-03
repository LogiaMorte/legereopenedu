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

// GET — List registrations
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const key = url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  try {
    const workshopFilter = url.searchParams.get('workshop');
    const list = await env.REGISTRATIONS.list({ prefix: 'reg_' });
    const registrations = [];

    for (const k of list.keys) {
      const data = await env.REGISTRATIONS.get(k.name);
      if (data) {
        const reg = JSON.parse(data);
        if (!workshopFilter || reg.workshop === workshopFilter) {
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
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

// POST — Update registration status (accept/reject) + send email
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json() as {
      key: string;
      regId: string;
      action: 'accept' | 'reject';
      message?: string;
    };

    if (!env.ADMIN_KEY || body.key !== env.ADMIN_KEY) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    if (!body.regId || !body.action) {
      return new Response(JSON.stringify({ error: 'Missing regId or action' }), { status: 400, headers });
    }

    // Get registration
    const regData = await env.REGISTRATIONS.get(body.regId);
    if (!regData) {
      return new Response(JSON.stringify({ error: 'Registration not found' }), { status: 404, headers });
    }

    const reg = JSON.parse(regData);
    reg.status = body.action === 'accept' ? 'accepted' : 'rejected';
    reg.reviewedAt = new Date().toISOString();
    reg.adminMessage = body.message || '';

    // Save updated status
    await env.REGISTRATIONS.put(body.regId, JSON.stringify(reg), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    // Send email via Resend if configured
    let emailSent = false;
    if (env.RESEND_API_KEY && reg.email) {
      try {
        const isAccepted = reg.status === 'accepted';

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

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'Legere Open Edu <info@legereopenedu.com>',
            to: [reg.email],
            subject: subject,
            html: htmlBody,
          }),
        });

        emailSent = emailRes.ok;
      } catch (emailErr) {
        // Email failed but status still updated
        console.error('Email send failed:', emailErr);
      }
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
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
