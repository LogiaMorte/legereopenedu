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
  listSessionTokenCandidates,
  parseJsonBody,
  generateToken,
  buildLogoutCookies,
  jsonResponseWithCookies,
  isAdminEmail,
} from '../../_shared';
import { readEvents } from '../events';
import badgesData from '../../../src/data/badges.json';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_EMAILS?: string;
}

/*
 * Otomatik rozet ölçütleri src/data/badges.json'dan gelir.
 * Eskiden burada elle tutulan bir kopya vardı ve "keep in sync" yorumuyla
 * işaretlenmişti — iki listenin ayrışması an meselesiydi. Pages Functions
 * src/ altından import edebiliyor, o yüzden kopyaya gerek yok.
 */
const AUTO_BADGES = (badgesData as Array<{ id: string; type: string; criteria?: Record<string, number> }>)
  .filter((b) => b.type === 'auto' && b.criteria)
  .map((b) => ({ id: b.id, criteria: b.criteria as Record<string, number> }));

function getMethods() {
  return 'GET, POST, DELETE, OPTIONS';
}

/** Birden fazla legere_token adayından KV'de eşleşen oturumu bul. */
async function resolveSessionMember(
  request: Request,
  kv: KVNamespace,
): Promise<{ email: string; token: string; member: Record<string, unknown> } | null> {
  const candidates = listSessionTokenCandidates(request);
  for (const session of candidates) {
    const memberData = await kv.get(`member:${session.email}`);
    if (!memberData) continue;
    try {
      const member = JSON.parse(memberData) as Record<string, unknown>;
      if (member.token === session.token) {
        return { email: session.email, token: session.token, member };
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, getMethods());

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  const session = await resolveSessionMember(request, env.REGISTRATIONS);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
  }

  try {
    const member = session.member as any;
    if (member.deactivated === true) {
      if (isAdminEmail(session.email, env.ADMIN_EMAILS)) {
        member.deactivated = false;
        delete member.deactivatedAt;
        delete member.deactivatedBy;
        await env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member));
      } else {
        return new Response(JSON.stringify({ error: 'Account deactivated', code: 'deactivated' }), {
          status: 403,
          headers,
        });
      }
    }

    // Kayıtlar + etkinlik başlıkları aynı turda. Başlıklar KV'deki
    // etkinlik kaydından — profilde slug (`ws-2026-...`) yerine okunabilir
    // ad görünsün. Etkinlik silinmişse id'ye düşülür.
    const regIds = member.regIds || [];
    const [regResults, events] = await Promise.all([
      Promise.all(regIds.map((regId: string) => env.REGISTRATIONS.get(regId))),
      readEvents(env.REGISTRATIONS),
    ]);
    const titles = new Map(events.map((e) => [e.id, e.title] as const));

    const registrations = regResults
      .filter((data): data is string => data !== null)
      .map((data) => {
        const reg = JSON.parse(data);
        return {
          id: reg.id,
          workshop: reg.workshop,
          workshopTitle: titles.get(reg.workshop) || undefined,
          status: reg.status || 'pending',
          timestamp: reg.timestamp,
        };
      });

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

    const isAdmin = isAdminEmail(session.email, env.ADMIN_EMAILS);

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
          showPublicProfile: member.showPublicProfile ?? false,
          publicProfileId: member.publicProfileId || '',
          picture: member.picture || '',
          linkedinHeadline: member.linkedinHeadline || '',
          signupSource: member.signupSource || 'email',
          linkedinVerified: member.linkedinVerified || false,
          linkedinVerifications: member.linkedinVerifications || [],
          googleSub: member.googleSub ? true : false,
          linkedinSub: member.linkedinSub ? true : false,
        },
        registrations,
        certificates: ((member.certificates || []) as Array<Record<string, unknown>>).map((c) => {
          const workshopId = typeof c.workshopId === 'string' ? c.workshopId : '';
          return {
            ...c,
            workshopTitle: c.workshopTitle || (workshopId ? titles.get(workshopId) : undefined) || undefined,
          };
        }),
        badges: allBadges,
        _nav: isAdmin ? { admin: true } : undefined,
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

  const session = await resolveSessionMember(request, env.REGISTRATIONS);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers });
  }

  try {
    const member = session.member as any;
    if (member.deactivated === true) {
      return new Response(JSON.stringify({ error: 'Account deactivated', code: 'deactivated' }), {
        status: 403,
        headers,
      });
    }

    const body = await parseJsonBody<{
      showFullName?: boolean;
      showEmail?: boolean;
      showPublicProfile?: boolean;
      university?: string;
      department?: string;
      schoolEmail?: string;
      linkedin?: string;
      interests?: string[];
      ideas?: string;
    }>(request);

    if (!body) {
      return new Response(JSON.stringify({ error: 'Invalid or oversized request body' }), { status: 400, headers });
    }

    // Privacy toggles
    if (typeof body.showFullName === 'boolean') member.showFullName = body.showFullName;
    if (typeof body.showEmail === 'boolean') member.showEmail = body.showEmail;
    if (typeof body.showPublicProfile === 'boolean') {
      member.showPublicProfile = body.showPublicProfile;
      // Manage public-profile index in KV
      const emailBytes = new TextEncoder().encode(member.email.toLowerCase());
      const hashBuffer = await crypto.subtle.digest('SHA-256', emailBytes);
      const hashHex = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
      const profileId = hashHex.slice(0, 12);
      if (body.showPublicProfile) {
        await env.REGISTRATIONS.put(`public-profile:${profileId}`, member.email.toLowerCase());
        member.publicProfileId = profileId;
      } else {
        await env.REGISTRATIONS.delete(`public-profile:${profileId}`);
        delete member.publicProfileId;
      }
    }

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
      const VALID_INTERESTS = ['projects', 'workshops', 'seminars', 'content', 'mentorship', 'other'];
      member.interests = body.interests
        .filter((i): i is string => typeof i === 'string' && VALID_INTERESTS.includes(i))
        .slice(0, 10);
    }

    // School email update (with alias management)
    if (typeof body.schoolEmail === 'string') {
      const newSchoolEmail = body.schoolEmail.trim().toLowerCase();
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
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
          await env.REGISTRATIONS.put(`member-alias:${newSchoolEmail}`, member.email);
        }
        member.schoolEmail = newSchoolEmail || undefined;
      }
    }

    await env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member));

    // Client in-place güncelleme için gerekli alanları döndür (reload yok)
    return new Response(
      JSON.stringify({
        success: true,
        publicProfileId: member.publicProfileId || null,
        showPublicProfile: member.showPublicProfile ?? false,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error('[me:post] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

// Server-side logout: invalidate token + clear cookie
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, getMethods());

  const logoutCookies = buildLogoutCookies(request.url);

  const session = await resolveSessionMember(request, env.REGISTRATIONS);
  if (!session) {
    return jsonResponseWithCookies({ success: true }, 200, headers, logoutCookies);
  }

  try {
    const member = session.member as { token?: string };
    member.token = generateToken();
    await env.REGISTRATIONS.put(`member:${session.email}`, JSON.stringify(member));
  } catch (err) {
    console.error('[me:delete] Error:', err instanceof Error ? err.message : err);
  }

  return jsonResponseWithCookies({ success: true }, 200, headers, logoutCookies);
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, getMethods());
};
