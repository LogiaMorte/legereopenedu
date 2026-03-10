/**
 * Auth Signup — Self-service member registration
 *
 * POST /api/auth/signup
 *   → Creates member:{email} in KV
 *   → Generates password + session token
 *   → Sends welcome email with credentials
 *   → JSON { success: true }
 */

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

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
  return 'LGR-' + code;
}

async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<boolean> {
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
    const data: SignupData = await request.json();

    // Validate required fields
    if (!data.name?.trim() || !data.personalEmail?.trim() || !data.university?.trim() || !data.department?.trim()) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
    }

    const email = data.personalEmail.trim().toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers });
    }

    // Validate school email if provided
    const schoolEmail = data.schoolEmail?.trim().toLowerCase() || '';
    if (schoolEmail && !emailRegex.test(schoolEmail)) {
      return new Response(JSON.stringify({ error: 'Invalid school email format' }), { status: 400, headers });
    }

    // Check if member already exists
    const existingMember = await env.REGISTRATIONS.get(`member:${email}`);
    if (existingMember) {
      return new Response(JSON.stringify({ error: 'Member already exists' }), { status: 409, headers });
    }

    // Also check school email if provided
    if (schoolEmail) {
      const existingSchool = await env.REGISTRATIONS.get(`member:${schoolEmail}`);
      if (existingSchool) {
        return new Response(JSON.stringify({ error: 'Member already exists' }), { status: 409, headers });
      }
    }

    // Sanitize linkedin URL
    let linkedin = (data.linkedin || '').trim().slice(0, 300);
    if (linkedin && !linkedin.startsWith('http')) {
      linkedin = 'https://' + linkedin;
    }

    // Create member
    const password = generatePassword();
    const token = generateToken();
    const now = new Date().toISOString().split('T')[0];

    const member = {
      email,
      schoolEmail: schoolEmail || undefined,
      name: data.name.trim().slice(0, 200),
      password,
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

    // If school email provided, create an alias entry pointing to primary
    if (schoolEmail && schoolEmail !== email) {
      await env.REGISTRATIONS.put(`member-alias:${schoolEmail}`, email, {
        expirationTtl: 60 * 60 * 24 * 365,
      });
    }

    // Update signup count
    const countKey = 'count:members';
    const currentCount = parseInt(await env.REGISTRATIONS.get(countKey) || '0');
    await env.REGISTRATIONS.put(countKey, String(currentCount + 1));

    // Build interest labels for email
    const interestLabels: Record<string, string> = {
      'projects': 'Mevcut projelerde yer almak',
      'workshops': 'Atölye içeriği üretmek',
      'seminars': 'Seminer / kolokyum önermek',
      'content': 'İçerik üretmek',
      'mentorship': 'Mentorluk yapmak',
      'other': 'Diğer',
    };

    const interestList = (member.interests || [])
      .map(i => interestLabels[i] || i)
      .join(', ');

    // Send welcome email
    const emailSent = await sendEmail(env, email,
      '🎓 Legere Open Edu — Hoş Geldiniz!',
      `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#D4A843;font-size:24px;margin:0;">Legere Open Edu</h1>
        </div>
        <h2 style="color:#4ADE80;">Hoş geldiniz, ${member.name}!</h2>
        <p style="color:#A0A0B0;line-height:1.6;">
          Legere Open Edu topluluğuna kaydınız başarıyla tamamlanmıştır. Artık atölyelere başvurabilir, projelerde yer alabilir ve içerik üretebilirsiniz.
        </p>

        <div style="background:rgba(212,168,67,0.05);border:1px solid rgba(212,168,67,0.2);border-radius:8px;padding:16px;margin:16px 0;text-align:center;">
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 8px 0;">🔑 Giriş Bilgileriniz:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 4px 0;">E-posta: <strong style="color:#F0EDE6;">${email}</strong></p>
          <p style="color:#A0A0B0;font-size:13px;margin:0 0 12px 0;">Şifre: <strong style="color:#D4A843;font-family:monospace;font-size:16px;letter-spacing:2px;">${password}</strong></p>
          <a href="https://legereopenedu.com/login" style="display:inline-block;background:rgba(212,168,67,0.15);color:#D4A843;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Giriş Yap</a>
        </div>

        ${interestList ? `
        <div style="background:rgba(212,168,67,0.05);border-left:3px solid #D4A843;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <p style="color:#D4A843;font-size:13px;margin:0 0 4px 0;font-weight:600;">Katkı Alanlarınız:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0;">${interestList}</p>
        </div>` : ''}

        ${member.ideas ? `
        <div style="background:rgba(212,168,67,0.05);border-left:3px solid #D4A843;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <p style="color:#D4A843;font-size:13px;margin:0 0 4px 0;font-weight:600;">Fikirleriniz:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0;">${member.ideas.slice(0, 500)}</p>
        </div>` : ''}

        <div style="background:rgba(74,222,128,0.05);border:1px solid rgba(74,222,128,0.2);border-radius:8px;padding:16px;margin:16px 0;">
          <p style="color:#4ADE80;font-size:13px;margin:0 0 8px 0;font-weight:600;">📬 Bir sonraki adım:</p>
          <p style="color:#A0A0B0;font-size:13px;margin:0;line-height:1.6;">
            Katılmak istediğiniz programlar ve fikirleriniz hakkında bize
            <a href="mailto:info@legereopenedu.com" style="color:#D4A843;text-decoration:none;">info@legereopenedu.com</a>
            adresinden de yazabilirsiniz. LinkedIn üzerinden de bize ulaşabilirsiniz. Detaylı bilgi paylaşmanız, size uygun projeleri belirlememize yardımcı olacaktır.
          </p>
        </div>

        <div style="text-align:center;margin:24px 0;">
          <a href="https://teams.live.com/l/community/FEApfJqwPQhu1UpbAI" style="display:inline-block;background:linear-gradient(135deg,#B8922E,#D4A843);color:#0A0A0F;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Teams Topluluğuna Katıl</a>
        </div>

        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
        <p style="color:#666;font-size:12px;text-align:center;">Legere Open Edu — legereopenedu.com</p>
      </div>`
    );

    // Send notification to admin (info email)
    if (env.RESEND_API_KEY) {
      await sendEmail(env, 'info@legereopenedu.com',
        `🆕 Yeni Üye Kaydı: ${member.name}`,
        `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;padding:24px;background:#0A0A0F;color:#F0EDE6;border-radius:12px;">
          <h2 style="color:#D4A843;">Yeni Üye Kaydı</h2>
          <p style="color:#A0A0B0;"><strong>Ad:</strong> ${member.name}</p>
          <p style="color:#A0A0B0;"><strong>E-posta:</strong> ${email}</p>
          ${schoolEmail ? `<p style="color:#A0A0B0;"><strong>Okul E-posta:</strong> ${schoolEmail}</p>` : ''}
          <p style="color:#A0A0B0;"><strong>Üniversite:</strong> ${member.university}</p>
          <p style="color:#A0A0B0;"><strong>Bölüm:</strong> ${member.department}</p>
          ${linkedin ? `<p style="color:#A0A0B0;"><strong>LinkedIn:</strong> <a href="${linkedin}" style="color:#D4A843;">${linkedin}</a></p>` : ''}
          ${interestList ? `<p style="color:#A0A0B0;"><strong>İlgi Alanları:</strong> ${interestList}</p>` : ''}
          ${member.ideas ? `<p style="color:#A0A0B0;"><strong>Fikirleri:</strong> ${member.ideas.slice(0, 1000)}</p>` : ''}
          <p style="color:#A0A0B0;"><strong>Ülke:</strong> ${member.signupCountry}</p>
          <p style="color:#A0A0B0;"><strong>Tarih:</strong> ${new Date().toISOString()}</p>
        </div>`
      );
    }

    // Set session cookie so user is logged in immediately
    const cookieValue = `${encodeURIComponent(email)}:${token}`;
    const maxAge = 30 * 24 * 60 * 60;

    return new Response(JSON.stringify({ success: true, emailSent }), {
      status: 200,
      headers: {
        ...headers,
        'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
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
