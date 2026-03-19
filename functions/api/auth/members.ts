/**
 * Admin Members API — Üye yönetimi
 * Auth: Session cookie + ADMIN_EMAILS whitelist
 *
 * POST /api/auth/members
 *   action: 'list' — Tüm üyeleri listele
 *   action: 'detail' — Tek üye detayı
 *   action: 'deactivate' — Üye deaktif et (token invalidate)
 *   action: 'audit-log' — Audit log getir
 */

import { corsHeaders, optionsResponse, parseJsonBody, verifyAdmin, generateToken } from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_EMAILS?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  try {
    // Verify admin: session cookie + ADMIN_EMAILS whitelist
    const adminEmail = await verifyAdmin(request, env.REGISTRATIONS, env.ADMIN_EMAILS);
    if (!adminEmail) {
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

      // Get registrations (parallel)
      const regIds = member.regIds || [];
      const regResults = await Promise.all(regIds.map((rid: string) => env.REGISTRATIONS.get(rid)));
      const registrations = regResults
        .filter((data): data is string => data !== null)
        .map((data) => {
          const reg = JSON.parse(data);
          return { id: reg.id, workshop: reg.workshop, status: reg.status || 'pending', timestamp: reg.timestamp };
        });

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

    // ── DEACTIVATE MEMBER ──
    if (body.action === 'deactivate' && body.email) {
      const memberData = await env.REGISTRATIONS.get(`member:${body.email}`);
      if (!memberData) {
        return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers });
      }
      const member = JSON.parse(memberData);
      // Invalidate token — forces logout, prevents new logins
      member.token = generateToken();
      member.deactivated = true;
      member.deactivatedAt = new Date().toISOString();
      member.deactivatedBy = adminEmail;
      await env.REGISTRATIONS.put(`member:${body.email}`, JSON.stringify(member), {
        expirationTtl: 60 * 60 * 24 * 365,
      });

      // Audit log
      const logKey = `audit:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await env.REGISTRATIONS.put(logKey, JSON.stringify({
        ts: new Date().toISOString(), admin: adminEmail, action: 'deactivate', target: body.email, detail: '',
      }), { expirationTtl: 60 * 60 * 24 * 365 });

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // ── AUDIT LOG ──
    if (body.action === 'audit-log') {
      const logList = await env.REGISTRATIONS.list({ prefix: 'audit:' });
      const logResults = await Promise.all(logList.keys.map((k) => env.REGISTRATIONS.get(k.name)));
      const logs = logResults
        .filter((data): data is string => data !== null)
        .map((data) => JSON.parse(data))
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        .slice(0, 200);
      return new Response(JSON.stringify({ logs }), { status: 200, headers });
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
