/**
 * Auth Google — Google Sign-In ile giriş/kayıt
 *
 * POST /api/auth/google  { credential: "google-id-token" }
 *   → JWT doğrula (Google JWKS ile signature verify)
 *   → member:{email} varsa giriş yap
 *   → Yoksa yeni üye oluştur
 *   → JSON { success: true, isNewMember: boolean }
 */

import {
  corsHeaders,
  optionsResponse,
  generateToken,
  generatePassword,
  hashPassword,
  buildLoginCookies,
  jsonResponseWithCookies,
} from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
}

interface GooglePayload {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  exp: number;
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function verifyGoogleToken(idToken: string, clientId: string): Promise<GooglePayload | null> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));

    // Check expiration
    if (payload.exp < Date.now() / 1000) return null;

    // Check issuer and audience
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return null;
    if (payload.aud !== clientId) return null;

    // Verify email is verified
    if (!payload.email_verified) return null;

    // Fetch Google's public keys and verify signature
    const jwksRes = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    const jwks = (await jwksRes.json()) as { keys: JsonWebKey[] };
    const key = (jwks.keys as any[]).find(k => k.kid === header.kid);
    if (!key) return null;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const signatureBytes = base64UrlDecode(parts[2]);
    const dataBytes = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signatureBytes, dataBytes);
    if (!valid) return null;

    return payload as GooglePayload;
  } catch {
    return null;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  if (!env.GOOGLE_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Google sign-in not configured' }), { status: 500, headers });
  }

  try {
    const body = (await request.json()) as { credential?: string };
    if (!body.credential) {
      return new Response(JSON.stringify({ error: 'Missing credential' }), { status: 400, headers });
    }

    const payload = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID);
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Invalid Google token' }), { status: 401, headers });
    }

    const email = payload.email.toLowerCase();
    let isNewMember = false;

    // Check if member exists
    let memberData = await env.REGISTRATIONS.get(`member:${email}`);
    let member: any;

    if (memberData) {
      // Existing member — update token for new session
      member = JSON.parse(memberData);
      member.token = generateToken();
      // Link Google if not already linked
      if (!member.googleSub) {
        member.googleSub = payload.sub;
      }
      // Update picture if available
      if (payload.picture) {
        member.picture = payload.picture;
      }
      await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
        expirationTtl: 60 * 60 * 24 * 365,
      });
    } else {
      // Check if email exists as alias
      const alias = await env.REGISTRATIONS.get(`member-alias:${email}`);
      if (alias) {
        memberData = await env.REGISTRATIONS.get(`member:${alias}`);
        if (memberData) {
          member = JSON.parse(memberData);
          member.token = generateToken();
          if (!member.googleSub) member.googleSub = payload.sub;
          if (payload.picture) member.picture = payload.picture;
          await env.REGISTRATIONS.put(`member:${alias}`, JSON.stringify(member), {
            expirationTtl: 60 * 60 * 24 * 365,
          });
          // Use alias email for cookie
          const cookies = buildLoginCookies(alias, member.token);
          return jsonResponseWithCookies({ success: true, isNewMember: false }, 200, headers, cookies);
        }
      }

      // New member — create account
      isNewMember = true;
      const plainPassword = generatePassword();
      const token = generateToken();

      member = {
        email,
        name: payload.name || '',
        password: await hashPassword(plainPassword),
        token,
        university: '',
        department: '',
        picture: payload.picture || '',
        joinDate: new Date().toISOString().split('T')[0],
        showFullName: true,
        showEmail: false,
        certificates: [],
        adminBadges: [],
        regIds: [],
        interests: [],
        ideas: '',
        signupSource: 'google',
        googleSub: payload.sub,
        signupIp: request.headers.get('CF-Connecting-IP') || 'unknown',
        signupCountry: request.headers.get('CF-IPCountry') || 'unknown',
      };

      await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
        expirationTtl: 60 * 60 * 24 * 365,
      });

      // Update member count
      const countKey = 'count:members';
      const currentCount = parseInt((await env.REGISTRATIONS.get(countKey)) || '0');
      await env.REGISTRATIONS.put(countKey, String(currentCount + 1));
    }

    // Set session cookies
    const cookies = buildLoginCookies(email, member.token);
    return jsonResponseWithCookies({ success: true, isNewMember }, 200, headers, cookies);
  } catch (err) {
    console.error('[google-auth] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
