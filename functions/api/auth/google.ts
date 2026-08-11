/**
 * Auth Google — Google Sign-In ile giriş/kayıt
 *
 * POST /api/auth/google  { credential, mode?: 'login'|'signup', consent?: boolean }
 *   → JWT doğrula (Google JWKS + cache)
 *   → deactivated üyeyi reddet
 *   → üye yoksa oluştur (login'de de — eski hesap TTL ile silindiyse giriş açılsın)
 *   → mode=signup yeni üye için consent zorunlu
 */

import {
  corsHeaders,
  optionsResponse,
  parseJsonBody,
  buildLoginCookies,
  jsonResponseWithCookies,
  notifyAdmin,
  ensureSessionToken,
} from '../../_shared';
import {
  type AuthMode,
  loadMemberByEmail,
  isDeactivated,
  createSocialMember,
  putMember,
  bumpMemberCount,
} from '../../_auth-member';

interface Env {
  REGISTRATIONS: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAILS?: string;
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

type JwksCache = { keys: JsonWebKey[]; fetchedAt: number };
let jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function fetchGoogleJwks(): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const jwksRes = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!jwksRes.ok) {
    throw new Error(`JWKS fetch failed: ${jwksRes.status}`);
  }
  const jwks = (await jwksRes.json()) as { keys: JsonWebKey[] };
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error('JWKS empty');
  }
  jwksCache = { keys: jwks.keys, fetchedAt: Date.now() };
  return jwks.keys;
}

async function verifyGoogleToken(idToken: string, clientId: string): Promise<GooglePayload | null> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));

    if (payload.exp < Date.now() / 1000) return null;
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return null;
    if (payload.aud !== clientId) return null;
    if (!payload.email_verified) return null;

    const keys = await fetchGoogleJwks();
    const key = (keys as Array<JsonWebKey & { kid?: string }>).find((k) => k.kid === header.kid);
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
  } catch (err) {
    console.error('[google-auth] verify failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function errJson(
  headers: Record<string, string>,
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error: message, code }), { status, headers });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (!env.REGISTRATIONS) {
    console.error('[google-auth] REGISTRATIONS KV binding is missing');
    return errJson(headers, 500, 'config', 'KV storage not bound. Please check Cloudflare Pages KV bindings.');
  }

  if (!env.GOOGLE_CLIENT_ID) {
    return errJson(headers, 500, 'config', 'Google sign-in not configured');
  }

  try {
    const body = await parseJsonBody<{
      credential?: string;
      mode?: string;
      consent?: boolean;
    }>(request);
    if (!body) {
      return errJson(headers, 400, 'bad_request', 'Invalid or oversized request body');
    }
    if (!body.credential) {
      return errJson(headers, 400, 'missing_credential', 'Missing credential');
    }

    const mode: AuthMode = body.mode === 'signup' ? 'signup' : 'login';

    const payload = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID);
    if (!payload) {
      return errJson(headers, 401, 'invalid_token', 'Invalid Google token');
    }

    const email = payload.email.toLowerCase();
    const existing = await loadMemberByEmail(env.REGISTRATIONS, email);

    if (existing) {
      if (isDeactivated(existing.member)) {
        return errJson(headers, 403, 'deactivated', 'This account has been deactivated');
      }

      const member = existing.member;
      // Mevcut token korunur — bkz. ensureSessionToken (giriş döngüsü)
      member.token = ensureSessionToken(member);
      if (!member.googleSub) member.googleSub = payload.sub;
      if (payload.picture) member.picture = payload.picture;
      await putMember(env.REGISTRATIONS, existing.keyEmail, member);

      const cookies = buildLoginCookies(existing.keyEmail, member.token, undefined, request.url);
      return jsonResponseWithCookies({ success: true, isNewMember: false }, 200, headers, cookies);
    }

    // Yeni üye: signup'ta consent zorunlu; login'de (KV'den düşmüş hesaplar vb.) aç
    if (mode === 'signup' && !body.consent) {
      return errJson(headers, 400, 'consent_required', 'Consent is required to create an account');
    }

    const member = createSocialMember({
      email,
      name: payload.name || '',
      picture: payload.picture || '',
      signupSource: 'google',
      googleSub: payload.sub,
      consentAt: body.consent ? new Date().toISOString() : undefined,
      signupIp: request.headers.get('CF-Connecting-IP') || 'unknown',
      signupCountry: request.headers.get('CF-IPCountry') || 'unknown',
    });

    await putMember(env.REGISTRATIONS, email, member);
    const total = await bumpMemberCount(env.REGISTRATIONS);

    context.waitUntil(
      notifyAdmin(env, 'Yeni üye (Google)', {
        Ad: member.name || '',
        'E-posta': email,
        'Toplam üye': String(total),
      }),
    );

    const cookies = buildLoginCookies(email, member.token, undefined, request.url);
    return jsonResponseWithCookies({ success: true, isNewMember: true }, 200, headers, cookies);
  } catch (err) {
    console.error('[google-auth] Error:', err instanceof Error ? err.message : err);
    return errJson(headers, 500, 'internal', 'Internal server error');
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
