/**
 * Auth Me — Session kontrolü + profil verisi getir
 *
 * GET /api/auth/me
 *   → Cookie'den email:token çöz
 *   → member:{email} KV'den profil getir
 *   → member.regIds ile kayıtları doğrudan oku (O(1) per reg)
 *   → Otomatik badge hesapla
 *   → JSON response
 */

interface Env {
  REGISTRATIONS: KVNamespace;
}

// Auto badge criteria (mirrored from src/data/badges.json — keep in sync)
const AUTO_BADGES = [
  { id: 'first-workshop', criteria: { completedWorkshops: 1 } },
  { id: 'three-workshops', criteria: { completedWorkshops: 3 } },
  { id: 'five-workshops', criteria: { completedWorkshops: 5 } },
  { id: 'multi-discipline', criteria: { uniqueDisciplines: 3 } },
];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://legereopenedu.com',
  };

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  // Parse cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const tokenCookie = cookieHeader.split(';').find(c => c.trim().startsWith('legere_token='));
  if (!tokenCookie) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
  }

  const cookieValue = tokenCookie.split('=').slice(1).join('=').trim();
  const separatorIndex = cookieValue.lastIndexOf(':');
  if (separatorIndex === -1) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers });
  }

  const email = decodeURIComponent(cookieValue.substring(0, separatorIndex));
  const token = cookieValue.substring(separatorIndex + 1);

  try {
    // Get member data (1 KV read)
    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);
    if (member.token !== token) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });
    }

    // Get user's registrations via regIds (O(1) per reg, NOT O(n) scan)
    const registrations: any[] = [];
    const regIds = member.regIds || [];

    for (const regId of regIds) {
      const regData = await env.REGISTRATIONS.get(regId);
      if (regData) {
        const reg = JSON.parse(regData);
        registrations.push({
          id: reg.id,
          workshop: reg.workshop,
          status: reg.status || 'pending',
          timestamp: reg.timestamp,
        });
      }
    }

    // Calculate automatic badges based on completed workshops + unique disciplines
    const completedWorkshops = registrations.filter(r => r.status === 'completed').length;
    const uniqueDisciplines = new Set(registrations.filter(r => r.status === 'completed').map(r => r.workshop)).size;
    const autoBadges: any[] = [];

    for (const badge of AUTO_BADGES) {
      if (badge.criteria.completedWorkshops && completedWorkshops >= badge.criteria.completedWorkshops) {
        autoBadges.push({ badgeId: badge.id, awardedAt: null, awardedBy: 'system' });
      }
      if (badge.criteria.uniqueDisciplines && uniqueDisciplines >= badge.criteria.uniqueDisciplines) {
        autoBadges.push({ badgeId: badge.id, awardedAt: null, awardedBy: 'system' });
      }
    }

    // Combine auto + admin badges
    const allBadges = [
      ...autoBadges,
      ...(member.adminBadges || []),
    ];

    return new Response(JSON.stringify({
      user: {
        email: member.email,
        schoolEmail: member.schoolEmail || '',
        name: member.name,
        university: member.university,
        department: member.department,
        linkedin: member.linkedin || '',
        interests: member.interests || [],
        ideas: member.ideas || '',
        joinDate: member.joinDate,
        showFullName: member.showFullName ?? true,
        showEmail: member.showEmail ?? false,
      },
      registrations,
      certificates: member.certificates || [],
      badges: allBadges,
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

// Update profile settings (showFullName, showEmail)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://legereopenedu.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Parse cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const tokenCookie = cookieHeader.split(';').find(c => c.trim().startsWith('legere_token='));
  if (!tokenCookie) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
  }

  const cookieValue = tokenCookie.split('=').slice(1).join('=').trim();
  const separatorIndex = cookieValue.lastIndexOf(':');
  const email = decodeURIComponent(cookieValue.substring(0, separatorIndex));
  const token = cookieValue.substring(separatorIndex + 1);

  try {
    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);
    if (member.token !== token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    const body = await request.json() as { showFullName?: boolean; showEmail?: boolean };
    if (typeof body.showFullName === 'boolean') member.showFullName = body.showFullName;
    if (typeof body.showEmail === 'boolean') member.showEmail = body.showEmail;

    await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
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
