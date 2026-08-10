/**
 * Sosyal giriş (Google / LinkedIn) için ortak üye KV işlemleri.
 *
 * Üye kayıtlarında expirationTtl KULLANILMAZ — 365 gün TTL idle hesapları
 * silip OAuth'u kırıyordu. Etkinlik başvuruları ayrı TTL kullanmaya devam eder.
 */

import { generateToken, constantTimeCompare } from './_shared';

export type AuthMode = 'login' | 'signup';

export interface SocialIdentity {
  email: string;
  name: string;
  picture?: string;
  signupSource: 'google' | 'linkedin';
  googleSub?: string;
  linkedinSub?: string;
  linkedinVerified?: boolean;
  linkedinVerifications?: string[];
  linkedinHeadline?: string;
  linkedin?: string;
  department?: string;
  consentAt?: string;
  signupIp?: string;
  signupCountry?: string;
}

export interface MemberRecord {
  email: string;
  name: string;
  token: string;
  university: string;
  department: string;
  picture: string;
  joinDate: string;
  showFullName: boolean;
  showEmail: boolean;
  certificates: unknown[];
  adminBadges: unknown[];
  regIds: string[];
  interests: string[];
  ideas: string;
  signupSource: string;
  deactivated?: boolean;
  deactivatedAt?: string;
  password?: string;
  googleSub?: string;
  linkedinSub?: string;
  linkedinVerified?: boolean;
  linkedinVerifications?: string[];
  linkedinHeadline?: string;
  linkedin?: string;
  consentAt?: string;
  signupIp?: string;
  signupCountry?: string;
  [key: string]: unknown;
}

export async function putMember(
  kv: KVNamespace,
  keyEmail: string,
  member: MemberRecord,
): Promise<void> {
  await kv.put(`member:${keyEmail}`, JSON.stringify(member));
}

export async function loadMemberByEmail(
  kv: KVNamespace,
  email: string,
): Promise<{ member: MemberRecord; keyEmail: string } | null> {
  const direct = await kv.get(`member:${email}`);
  if (direct) {
    return { member: JSON.parse(direct) as MemberRecord, keyEmail: email };
  }

  const alias = await kv.get(`member-alias:${email}`);
  if (!alias) return null;

  const aliased = await kv.get(`member:${alias}`);
  if (!aliased) return null;

  return { member: JSON.parse(aliased) as MemberRecord, keyEmail: alias };
}

export function isDeactivated(member: MemberRecord): boolean {
  return member.deactivated === true;
}

export function createSocialMember(identity: SocialIdentity): MemberRecord {
  return {
    email: identity.email,
    name: identity.name || '',
    token: generateToken(),
    university: '',
    department: identity.department || '',
    picture: identity.picture || '',
    joinDate: new Date().toISOString().split('T')[0],
    showFullName: true,
    showEmail: false,
    certificates: [],
    adminBadges: [],
    regIds: [],
    interests: [],
    ideas: '',
    signupSource: identity.signupSource,
    ...(identity.googleSub ? { googleSub: identity.googleSub } : {}),
    ...(identity.linkedinSub ? { linkedinSub: identity.linkedinSub } : {}),
    linkedinVerified: identity.linkedinVerified ?? false,
    linkedinVerifications: identity.linkedinVerifications || [],
    ...(identity.linkedinHeadline ? { linkedinHeadline: identity.linkedinHeadline } : {}),
    ...(identity.linkedin ? { linkedin: identity.linkedin } : {}),
    ...(identity.consentAt ? { consentAt: identity.consentAt } : {}),
    signupIp: identity.signupIp || 'unknown',
    signupCountry: identity.signupCountry || 'unknown',
  };
}

export async function bumpMemberCount(kv: KVNamespace): Promise<number> {
  const countKey = 'count:members';
  const currentCount = parseInt((await kv.get(countKey)) || '0', 10);
  const next = currentCount + 1;
  await kv.put(countKey, String(next));
  return next;
}

/** LinkedIn OAuth CSRF: HMAC-imzalı state (+ yedek nonce cookie) */
export const LI_OAUTH_COOKIE = 'legere_li_oauth';
const LI_OAUTH_TTL_MS = 10 * 60 * 1000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

export async function buildLinkedInOAuthState(
  mode: AuthMode,
  lang: string,
  secret: string,
): Promise<{ state: string; cookie: string }> {
  const nonce = generateToken().slice(0, 32);
  const body = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        mode,
        lang,
        n: nonce,
        exp: Date.now() + LI_OAUTH_TTL_MS,
      }),
    ),
  );
  const sig = await hmacSign(secret, body);
  const state = `${body}.${sig}`;
  const cookie = `${LI_OAUTH_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Domain=.legereopenedu.com`;
  return { state, cookie };
}

export function clearLinkedInOAuthCookie(): string {
  return `${LI_OAUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Domain=.legereopenedu.com`;
}

export async function parseAndVerifyLinkedInState(
  stateParam: string | null,
  request: Request,
  secret: string,
): Promise<{ mode: AuthMode; lang: string; ok: true } | { ok: false; reason: string }> {
  const ALLOWED_MODES: AuthMode[] = ['login', 'signup'];
  const ALLOWED_LANGS = ['tr', 'en'];

  if (!stateParam) return { ok: false, reason: 'missing_state' };

  const dot = stateParam.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'invalid_state' };

  const body = stateParam.slice(0, dot);
  const sig = stateParam.slice(dot + 1);
  const expected = await hmacSign(secret, body);
  if (!constantTimeCompare(sig, expected)) {
    // Eski (imzasız) state formatına düşme — cookie ile doğrula (kısa geçiş)
    return parseLegacyLinkedInState(stateParam, request);
  }

  let stateData: { mode?: string; lang?: string; n?: string; exp?: number };
  try {
    stateData = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return { ok: false, reason: 'invalid_state' };
  }

  if (typeof stateData.exp !== 'number' || Date.now() > stateData.exp) {
    return { ok: false, reason: 'state_expired' };
  }

  const mode = ALLOWED_MODES.includes(stateData.mode as AuthMode)
    ? (stateData.mode as AuthMode)
    : 'login';
  const lang = ALLOWED_LANGS.includes(stateData.lang || '') ? (stateData.lang as string) : 'tr';

  return { ok: true, mode, lang };
}

/** Önceki deploy'dan kalan btoa(JSON) state — cookie eşleşirse kabul */
function parseLegacyLinkedInState(
  stateParam: string,
  request: Request,
): { mode: AuthMode; lang: string; ok: true } | { ok: false; reason: string } {
  const ALLOWED_MODES: AuthMode[] = ['login', 'signup'];
  const ALLOWED_LANGS = ['tr', 'en'];

  let stateData: { mode?: string; lang?: string; n?: string; exp?: number };
  try {
    stateData = JSON.parse(atob(stateParam));
  } catch {
    return { ok: false, reason: 'state_mismatch' };
  }

  if (typeof stateData.exp !== 'number' || Date.now() > stateData.exp) {
    return { ok: false, reason: 'state_expired' };
  }
  if (!stateData.n) return { ok: false, reason: 'state_mismatch' };

  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LI_OAUTH_COOKIE}=`));
  const cookieNonce = match ? match.slice(LI_OAUTH_COOKIE.length + 1) : '';
  if (!cookieNonce || cookieNonce !== stateData.n) {
    return { ok: false, reason: 'state_mismatch' };
  }

  const mode = ALLOWED_MODES.includes(stateData.mode as AuthMode)
    ? (stateData.mode as AuthMode)
    : 'login';
  const lang = ALLOWED_LANGS.includes(stateData.lang || '') ? (stateData.lang as string) : 'tr';
  return { ok: true, mode, lang };
}
