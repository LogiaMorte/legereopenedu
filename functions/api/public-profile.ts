/**
 * Public Profile API — Açık profil verisi
 * GET /api/public-profile?id=<sha256-hash-prefix>
 *
 * Returns public member data only if showPublicProfile === true.
 * The ID is a 12-char prefix of SHA-256(email) — not reversible.
 */

import { corsHeaders, optionsResponse } from '../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
}

async function emailToProfileId(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 12);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, 'GET, OPTIONS');

  const url = new URL(request.url);
  const profileId = url.searchParams.get('id');

  if (!profileId || !/^[a-f0-9]{12}$/.test(profileId)) {
    return new Response(JSON.stringify({ error: 'Invalid profile ID' }), { status: 400, headers });
  }

  try {
    // Look up by profile ID index
    const email = await env.REGISTRATIONS.get(`public-profile:${profileId}`);
    if (!email) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers });
    }

    const memberData = await env.REGISTRATIONS.get(`member:${email}`);
    if (!memberData) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers });
    }

    const member = JSON.parse(memberData);

    // Double-check: only serve if public profile is enabled
    if (!member.showPublicProfile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers });
    }

    // Build public-safe response
    const regIds = member.regIds || [];
    const regResults = await Promise.all(regIds.map((rid: string) => env.REGISTRATIONS.get(rid)));
    const completedRegs = regResults
      .filter((data): data is string => data !== null)
      .map((data) => JSON.parse(data))
      .filter((reg) => reg.status === 'completed')
      .map((reg) => ({ workshop: reg.workshop, timestamp: reg.timestamp }));

    return new Response(JSON.stringify({
      profile: {
        name: member.showFullName ? member.name : (member.name?.split(' ')[0] || 'Üye'),
        university: member.university || '',
        department: member.department || '',
        joinDate: member.joinDate || '',
        picture: member.picture || '',
        linkedin: member.linkedin || '',
        linkedinVerified: member.linkedinVerified || false,
        linkedinVerifications: member.linkedinVerifications || [],
      },
      workshops: completedRegs,
      certificates: (member.certificates || []).map((c: any) => ({
        id: c.id,
        type: c.type,
        workshopId: c.workshopId,
        issueDate: c.issueDate,
      })),
      badges: (member.adminBadges || []).map((b: any) => ({
        badgeId: b.badgeId,
      })),
    }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, 'GET, OPTIONS');
};
