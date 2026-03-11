/**
 * Auth Signup — Self-service member registration
 *
 * POST /api/auth/signup
 *   → Creates member:{email} in KV (password hashed)
 *   → Generates password + session token
 *   → Sends welcome email with credentials
 *   → JSON { success: true }
 */

import {
  corsHeaders,
  optionsResponse,
  escapeHtml,
  hashPassword,
  generateToken,
  generatePassword,
  sendEmail,
} from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  RESEND_API_KEY?: string;
}

interface SignupData {
  name: string;
  personalEmail: string;
  schoolEmail?: string;
  university: string;
  department: string;
  linkedin?: string;
  interests?: string[];
  ideas?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  try {
    const data: SignupData = await request.json();

    if (!data.name?.trim() || !data.personalEmail?.trim() || !data.university?.trim() || !data.department?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const email = data.personalEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers });
    }

    const schoolEmail = data.schoolEmail?.trim().toLowerCase() || '';
    if (schoolEmail && !emailRegex.test(schoolEmail)) {
      return new Response(JSON.stringify({ error: 'Invalid school email format' }), { status: 400, headers });
    }

    // Check if member already exists (primary email or alias)
    const existingMember = await env.REGISTRATIONS.get(`member:${email}`);
    if (existingMember) {
      return new Response(JSON.stringify({ error: 'Member already exists' }), { status: 409, headers });
    }

    const existingAlias = await env.REGISTRATIONS.get(`member-alias:${email}`);
    if (existingAlias) {
      return new Response(JSON.stringify({ error: 'Member already exists' }), { status: 409, headers });
    }

    if (schoolEmail) {
      const existingSchool = await env.REGISTRATIONS.get(`member:${schoolEmail}`);
      if (existingSchool) {
        return new Response(JSON.stringify({ error: 'Member already exists' }), { status: 409, headers });
      }
      const existingSchoolAlias = await env.REGISTRATIONS.get(`member-alias:${schoolEmail}`);
      if (existingSchoolAlias) {
        return new Response(JSON.stringify({ error: 'Member already exists' }), { status: 409, headers });
      }
    }

    // Sanitize linkedin URL — block javascript: and data: schemes
    let linkedin = (data.linkedin || '').trim().slice(0, 300);
    if (linkedin) {
      if (/^(javascript|data|vbscript):/i.test(linkedin)) {
        linkedin = '';
      } else if (!linkedin.startsWith('http')) {
        linkedin = 'https://' + linkedin;
      }
    }

    // Create member with hashed password
    const plainPassword = generatePassword();
    const token = generateToken();
    const now = new Date().toISOString().split('T')[0];

    const member = {
      email,
      schoolEmail: schoolEmail || undefined,
      name: data.name.trim().slice(0, 200),
      password: await hashPassword(plainPassword),
      token,
      university: data.university.trim().slice(0, 200),
      department: data.department.trim().slice(0, 200),
      linkedin: linkedin || undefined,
      interests: Array.isArray(data.interests) ? data.interests.slice(0, 10).map(i => String(i).slice(0, 100)) : [],
      ideas: (data.ideas || '').trim().slice(0, 2000),
      joinDate: now,
      showFullName: true,
      showEmail: false,
      certificates: [],
      adminBadges: [],
      regIds: [],
      signupSource: 'self',
      signupIp: request.headers.get('CF-Connecting-IP') || 'unknown',
      signupCountry: request.headers.get('CF-IPCountry') || 'unknown',
    };

    await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    // Alias for school email
    if (schoolEmail && schoolEmail !== email) {
      await env.REGISTRATIONS.put(`member-alias:${schoolEmail}`, email, {
        expirationTtl: 60 * 60 * 24 * 365,
      });
    }

    // Update signup count
    const countKey = 'count:members';
    const currentCount = parseInt((await env.REGISTRATIONS.get(countKey)) || '0');
    await env.REGISTRATIONS.put(countKey, String(currentCount + 1));

    // Build interest labels for email (escaped)
    const interestLabels: Record<string, string> = {
      projects: 'Mevcut projelerde yer almak',
      workshops: 'Atölye içeriği üretmek',
      seminars: 'Seminer / kolokyum önermek',
      content: 'İçerik üretmek',
      mentorship: 'Mentorluk yapmak',
      other: 'Diğer',
    };

    const interestList = (member.interests || []).map(i => escapeHtml(interestLabels[i] || i)).join(', ');

    // Escaped values for email templates
    const safeName = escapeHtml(member.name);
    const safeEmail = escapeHtml(email);
    const safeIdeas = escapeHtml((member.ideas || '').slice(0, 500));
    const safeUniversity = escapeHtml(member.university);
    const safeDepartment = escapeHtml(member.department);
    const safeSchoolEmail = escapeHtml(schoolEmail);
    const safeLinkedin = escapeHtml(linkedin);

    // Send welcome email
    const emailSent = await sendEmail(
      env.RESEND_API_KEY,
      email,
      `Legere Open Edu — Hos Geldiniz!`,
      `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1>
        </div>
        <h2 style="color:#4ADE80;">Hos geldiniz, ${safeName}!</h2>
        <p style="color:#A0A0B0;line-height:1.6;">
          Legere Open Edu topluluguna kaydiniz basariyla tamamlanmistir. Artik atolyelere basvurabilir, projelerde yer alabilir ve icerik uretebilirsiniz.
        </p>

        <div style="background:rgba(212,168,67,0.05);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:16px;margin:16px 0;text-align:center;">
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 8px 0;">Giris Bilgileriniz:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 4px 0;">E-posta: <strong style="color:#F0EDE6;">${safeEmail}</strong></p>
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 12px 0;">Sifre: <strong style="color:#D4A843;font-family:monospace;font-size:16px;letter-spacing:2px;">${escapeHtml(plainPassword)}</strong></p>
          <a href="https://legereopenedu.com/login" style="display:inline-block;background:rgba(212,168,67,0.15);color:#D4A843;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Giris Yap</a>
        </div>

        ${interestList ? `
        <div style="background:rgba(212,168,67,0.05);border-left:3px solid #D4A843;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <p style="color:#D4A843;font-size:13px;margin:0 0 4px 0;font-weight:600;">Katki Alanlariniz:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0;">${interestList}</p>
        </div>` : ''}

        ${safeIdeas ? `
        <div style="background:rgba(212,168,67,0.05);border-left:3px solid #D4A843;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <p style="color:#D4A843;font-size:13px;margin:0 0 4px 0;font-weight:600;">Fikirleriniz:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0;">${safeIdeas}</p>
        </div>` : ''}

        <div style="background:rgba(74,222,128,0.05);border:1px solid rgba(74,222,128,0.2);border-radius:8px;padding:16px;margin:16px 0;">
          <p style="color:#4ADE80;font-size:13px;margin:0 0 8px 0;font-weight:600;">Bir sonraki adim:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0;line-height:1.6;">
            Katilmak istediginiz programlar ve fikirleriniz hakkinda bize
            <a href="mailto:info@legereopenedu.com" style="color:#D4A843;text-decoration:none;">info@legereopenedu.com</a>
            adresinden de yazabilirsiniz.
          </p>
        </div>

        <div style="text-align:center;margin:24px 0;">
          <a href="https://teams.live.com/l/community/FEApfJqwPQhu1UpbAI" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Teams Topluluguna Katil</a>
        </div>

        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
        <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
      </div>`,
    );

    // Send notification to admin
    if (env.RESEND_API_KEY) {
      await sendEmail(
        env.RESEND_API_KEY,
        'info@legereopenedu.com',
        `Yeni Uye Kaydi: ${safeName}`,
        `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;padding:24px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
          <h2 style="color:#D4A843;">Yeni Uye Kaydi</h2>
          <p style="color:#A0A0B0;"><strong>Ad:</strong> ${safeName}</p>
          <p style="color:#A0A0B0;"><strong>E-posta:</strong> ${safeEmail}</p>
          ${safeSchoolEmail ? `<p style="color:#A0A0B0;"><strong>Okul E-posta:</strong> ${safeSchoolEmail}</p>` : ''}
          <p style="color:#A0A0B0;"><strong>Universite:</strong> ${safeUniversity}</p>
          <p style="color:#A0A0B0;"><strong>Bolum:</strong> ${safeDepartment}</p>
          ${safeLinkedin ? `<p style="color:#A0A0B0;"><strong>LinkedIn:</strong> ${safeLinkedin}</p>` : ''}
          ${interestList ? `<p style="color:#A0A0B0;"><strong>Ilgi Alanlari:</strong> ${interestList}</p>` : ''}
          ${safeIdeas ? `<p style="color:#A0A0B0;"><strong>Fikirleri:</strong> ${safeIdeas}</p>` : ''}
          <p style="color:#A0A0B0;"><strong>Ulke:</strong> ${escapeHtml(member.signupCountry)}</p>
          <p style="color:#A0A0B0;"><strong>Tarih:</strong> ${new Date().toISOString()}</p>
        </div>`,
      );
    }

    // Set session cookie
    const cookieValue = `${encodeURIComponent(email)}:${token}`;
    const maxAge = 30 * 24 * 60 * 60;

    return new Response(JSON.stringify({ success: true, emailSent }), {
      status: 200,
      headers: {
        ...headers,
        'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[signup] Error:', message, err instanceof Error ? err.stack : '');
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
