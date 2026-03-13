/**
 * Auth Me — Session kontrolü + profil verisi getir + güncelle + logout
 *
 * GET  /api/auth/me       → Profil getir
 * POST /api/auth/me       → Profil güncelle (showFullName, showEmail)
 * DELETE /api/auth/me     → Logout (token invalidate + cookie sil)
 */

import {
  corsHeaders,
  optionsResponse,
  parseSessionCookie,
  generateToken,
} from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
}

const AUTO_BADGES = [
  { id: 'first-workshop', criteria: { completedWorkshops: 1 } },
  { id: 'three-workshops', criteria: { completedWorkshops: 3 } },
  { id: 'five-workshops', criteria: { completedWorkshops: 5 } },
  { id: 'multi-discipline', criteria: { uniqueDisciplines: 3 } },
];

function getMethods() {
  return 'GET, POST, DELETE, OPTIONS';
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, getMethods());

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  const session = parseSessionCookie(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
  }

  try {
    const memberData = await env.REGISTRATIONS.get(`member:${session.email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);
    if (member.token !== session.token) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers });
    }

    // Get registrations via regIds
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

    // Calculate auto badges
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

    const allBadges = [...autoBadges, ...(member.adminBadges || [])];

    return new Response(
      JSON.stringify({
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
          picture: member.picture || '',
          signupSource: member.signupSource || 'email',
          linkedinVerified: member.linkedinVerified || false,
          linkedinVerifications: member.linkedinVerifications || [],
          googleSub: member.googleSub ? true : false,
          linkedinSub: member.linkedinSub ? true : false,
        },
        registrations,
        certificates: member.certificates || [],
        badges: allBadges,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error('[me:get] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, getMethods());

  const session = parseSessionCookie(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
  }

  try {
    const memberData = await env.REGISTRATIONS.get(`member:${session.email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);
    if (member.token !== session.token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    const body = (await request.json()) as {
      showFullName?: boolean;
      showEmail?: boolean;
      university?: string;
      department?: string;
      schoolEmail?: string;
      linkedin?: string;
      interests?: string[];
      ideas?: string;
    };

    // Privacy toggles
    if (typeof body.showFullName === 'boolean') member.showFullName = body.showFullName;
    if (typeof body.showEmail === 'boolean') member.showEmail = body.showEmail;

    // Profile fields
    if (typeof body.university === 'string') member.university = body.university.trim().slice(0, 200);
    if (typeof body.department === 'string') member.department = body.department.trim().slice(0, 200);
    if (typeof body.ideas === 'string') member.ideas = body.ideas.trim().slice(0, 2000);

    if (typeof body.linkedin === 'string') {
      let linkedin = body.linkedin.trim().slice(0, 300);
      if (linkedin && /^(javascript|data|vbscript):/i.test(linkedin)) linkedin = '';
      else if (linkedin && !linkedin.startsWith('http')) linkedin = 'https://' + linkedin;
      member.linkedin = linkedin || undefined;
    }

    if (Array.isArray(body.interests)) {
      member.interests = body.interests.slice(0, 10).map(i => String(i).slice(0, 100));
    }

    // School email update (with alias management)
    if (typeof body.schoolEmail === 'string') {
      const newSchoolEmail = body.schoolEmail.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (newSchoolEmail && !emailRegex.test(newSchoolEmail)) {
        return new Response(JSON.stringify({ error: 'Invalid school email format' }), { status: 400, headers });
      }

      const oldSchoolEmail = member.schoolEmail || '';
      if (newSchoolEmail !== oldSchoolEmail) {
        // Remove old alias
        if (oldSchoolEmail && oldSchoolEmail !== member.email) {
          await env.REGISTRATIONS.delete(`member-alias:${oldSchoolEmail}`);
        }
        // Set new alias
        if (newSchoolEmail && newSchoolEmail !== member.email) {
          const existing = await env.REGISTRATIONS.get(`member:${newSchoolEmail}`);
          const existingAlias = await env.REGISTRATIONS.get(`member-alias:${newSchoolEmail}`);
          if (existing || existingAlias) {
            return new Response(JSON.stringify({ error: 'School email already in use' }), { status: 409, headers });
          }
          await env.REGISTRATIONS.put(`member-alias:${newSchoolEmail}`, member.email, {
            expirationTtl: 60 * 60 * 24 * 365,
          });
        }
        member.schoolEmail = newSchoolEmail || undefined;
      }
    }

    await env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (err) {
    console.error('[me:post] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

// Server-side logout: invalidate token + clear cookie
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, getMethods());

  const session = parseSessionCookie(request);
  if (!session) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...headers,
        'Set-Cookie': 'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  try {
    const memberData = await env.REGISTRATIONS.get(`member:${session.email}`);
    if (memberData) {
      const member = JSON.parse(memberData);
      if (member.token === session.token) {
        member.token = generateToken();
        await env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member), {
          expirationTtl: 60 * 60 * 24 * 365,
        });
      }
    }
  } catch (err) {
    console.error('[me:delete] Error:', err instanceof Error ? err.message : err);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      ...headers,
      'Set-Cookie': 'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, getMethods());
};
