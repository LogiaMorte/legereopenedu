/**
 * Shared utilities for Cloudflare Pages Functions
 * - CORS origin validation (exact match, no subdomain spoofing)
 * - HTML escaping for email templates (XSS prevention)
 * - SHA-256 password hashing (Workers-compatible)
 * - Constant-time comparison (timing attack prevention)
 * - Password generation
 * - Token generation
 */

// ── CORS ──

const ALLOWED_ORIGINS = [
  'https://legereopenedu.com',
  'https://www.legereopenedu.com',
];

export function getAllowedOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  return '';
}

export function corsHeaders(request: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const origin = getAllowedOrigin(request);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function optionsResponse(request: Request, methods = 'POST, OPTIONS'): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, methods),
  });
}

// ── HTML Escaping (XSS prevention for email templates) ──

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Password Hashing (PBKDF2, Workers-compatible) ──

const PBKDF2_PREFIX = 'pbkdf2:';
const LEGACY_SHA256_PREFIX = 'sha256:';
const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  const saltHex = Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derived), b => b.toString(16).padStart(2, '0')).join('');
  return `${PBKDF2_PREFIX}${saltHex}:${hashHex}`;
}

async function legacySha256(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return LEGACY_SHA256_PREFIX + Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(input: string, stored: string): Promise<boolean> {
  if (stored.startsWith(PBKDF2_PREFIX)) {
    const rest = stored.slice(PBKDF2_PREFIX.length);
    const [saltHex, hashHex] = rest.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(input), 'PBKDF2', false, ['deriveBits'],
    );
    const derived = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial, 256,
    );
    const inputHex = Array.from(new Uint8Array(derived), b => b.toString(16).padStart(2, '0')).join('');
    return constantTimeCompare(inputHex, hashHex);
  }
  if (stored.startsWith(LEGACY_SHA256_PREFIX)) {
    const inputHash = await legacySha256(input);
    return constantTimeCompare(inputHash, stored);
  }
  // Legacy plain text — hash both to prevent timing side-channel
  const inputHash = await legacySha256(input);
  const storedHash = await legacySha256(stored);
  return constantTimeCompare(inputHash, storedHash);
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith(PBKDF2_PREFIX);
}

// ── Constant-time comparison (timing attack prevention) ──

export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Request body size guard ──

const MAX_BODY_SIZE = 100 * 1024; // 100 KB

export async function parseJsonBody<T = unknown>(request: Request): Promise<T | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) return null;
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function isPasswordHashed(stored: string): boolean {
  return stored.startsWith(PBKDF2_PREFIX) || stored.startsWith(LEGACY_SHA256_PREFIX);
}

// ── Token & Password Generation ──

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = '';
  code += upper[bytes[0] % upper.length];
  code += lower[bytes[1] % lower.length];
  code += digits[bytes[2] % digits.length];
  for (let i = 3; i < 10; i++) code += all[bytes[i] % all.length];
  return 'LGR-' + code;
}

// ── Cookie Parsing ──

export function parseSessionCookie(request: Request): { email: string; token: string } | null {
  try {
    const cookieHeader = request.headers.get('Cookie') || '';
    const tokenCookie = cookieHeader.split(';').find(c => c.trim().startsWith('legere_token='));
    if (!tokenCookie) return null;

    const cookieValue = tokenCookie.split('=').slice(1).join('=').trim();
    const separatorIndex = cookieValue.lastIndexOf(':');
    if (separatorIndex === -1) return null;

    const email = decodeURIComponent(cookieValue.substring(0, separatorIndex));
    const token = cookieValue.substring(separatorIndex + 1);

    if (!email || !token || !/^[0-9a-f]{64}$/.test(token)) return null;

    return { email, token };
  } catch {
    return null;
  }
}

// ── Cookie Helpers ──

/**
 * Build Set-Cookie headers for login.
 * - legere_token: HttpOnly, Secure — actual auth token (not readable by JS)
 * - legere_logged_in: non-HttpOnly — presence flag for Header UI detection
 */
export function buildLoginCookies(email: string, token: string, maxAge = 30 * 24 * 60 * 60): string[] {
  const cookieValue = `${encodeURIComponent(email)}:${token}`;
  return [
    `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
    `legere_logged_in=1; Path=/; SameSite=Lax; Max-Age=${maxAge}`,
  ];
}

/**
 * Build Set-Cookie headers for logout (clear both cookies).
 */
export function buildLogoutCookies(): string[] {
  return [
    'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'legere_logged_in=; Path=/; SameSite=Lax; Max-Age=0',
  ];
}

// ── Response Helper ──

/**
 * Build a Response with proper multi-cookie support.
 * Set-Cookie headers MUST be separate — cannot be comma-joined.
 */
export function jsonResponseWithCookies(
  body: unknown,
  status: number,
  baseHeaders: Record<string, string>,
  cookies: string[],
): Response {
  const headers = new Headers(baseHeaders);
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Build a redirect Response with proper multi-cookie support.
 */
export function redirectWithCookies(
  location: string,
  cookies: string[],
): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(null, { status: 302, headers });
}

// ── Admin Verification ──

/**
 * Verify that the request comes from an admin member.
 * Uses the existing session cookie (legere_token) and checks:
 *   1. Valid session (cookie + token match)
 *   2. Email is in ADMIN_EMAILS env var (comma-separated list)
 *
 * Returns the admin's email on success, null on failure.
 */
export async function verifyAdmin(
  request: Request,
  kv: KVNamespace,
  adminEmails: string | undefined,
): Promise<string | null> {
  if (!adminEmails) return null;

  const session = parseSessionCookie(request);
  if (!session) return null;

  // Check if email is in admin list
  const allowed = adminEmails.split(',').map(e => e.trim().toLowerCase());
  if (!allowed.includes(session.email.toLowerCase())) return null;

  // Verify session token against KV
  try {
    const memberData = await kv.get(`member:${session.email}`);
    if (!memberData) return null;
    const member = JSON.parse(memberData);
    if (member.token !== session.token) return null;
    return session.email;
  } catch {
    return null;
  }
}

// ── Email ──

export async function sendEmail(
  apiKey: string | undefined,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: 'Legere Open Edu <info@legereopenedu.com>',
        to: [to],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
