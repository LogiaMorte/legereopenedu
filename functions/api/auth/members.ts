/**
 * Admin Members API — Üye yönetimi
 * Auth: Cloudflare Access JWT (CF_Authorization cookie)
 *
 * POST /api/auth/members
 *   action: 'list' — Tüm üyeleri listele
 *   action: 'detail' — Tek üye detayı
 */

import { corsHeaders, optionsResponse, parseJsonBody, verifyCfAccessJwt } from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  try {
    // Verify Cloudflare Access JWT
    const jwtPayload = await verifyCfAccessJwt(request, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
    if (!jwtPayload) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    const body = await parseJsonBody<{
      action?: string;
      email?: string;
    }>(request);

    if (!body) {
      return new Response(JSON.stringify({ error: 'Invalid or oversized request body' }), { status: 400, headers });
    }

    if (!env.REGISTRATIONS) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
    }

    if (body.action === 'list') {
      // List all members by scanning KV with prefix "member:"
      const listResult = await env.REGISTRATIONS.list({ prefix: 'member:' });
      const memberKeys = listResult.keys.filter((key) => !key.name.startsWith('member-alias:'));
      const kvResults = await Promise.all(memberKeys.map((key) => env.REGISTRATIONS.get(key.name)));
      const members: any[] = kvResults
        .filter((data): data is string => data !== null)
        .map((data) => {
          const member = JSON.parse(data);
          return {
            email: member.email,
            name: member.name || '',
            university: member.university || '',
            department: member.department || '',
            joinDate: member.joinDate || '',
            signupSource: member.signupSource || 'unknown',
            registrationCount: (member.regIds || []).length,
            certificateCount: (member.certificates || []).length,
            badgeCount: (member.adminBadges || []).length,
          };
        });

      // Sort by join date descending (newest first)
      members.sort((a, b) => {
        if (!a.joinDate) return 1;
        if (!b.joinDate) return -1;
        return new Date(b.joinDate).getTime() - new Date(a.joinDate).getTime();
      });

      return new Response(JSON.stringify({ members, total: members.length }), { status: 200, headers });
    }

    if (body.action === 'detail' && body.email) {
      const memberData = await env.REGISTRATIONS.get(`member:${body.email}`);
      if (!memberData) {
        return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers });
      }

      const member = JSON.parse(memberData);

      // Get registrations
      const registrations: any[] = [];
      for (const regId of (member.regIds || [])) {
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

      return new Response(JSON.stringify({
        member: {
          email: member.email,
          schoolEmail: member.schoolEmail || '',
          name: member.name || '',
          university: member.university || '',
          department: member.department || '',
          linkedin: member.linkedin || '',
          interests: member.interests || [],
          ideas: member.ideas || '',
          joinDate: member.joinDate || '',
          signupSource: member.signupSource || 'unknown',
          showFullName: member.showFullName ?? true,
          showEmail: member.showEmail ?? false,
        },
        registrations,
        certificates: member.certificates || [],
        badges: member.adminBadges || [],
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers });
  } catch (err) {
    console.error('[members] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
