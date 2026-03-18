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

// ── Password Hashing (SHA-256, Workers-compatible) ──

const HASH_PREFIX = 'sha256:';

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
  return HASH_PREFIX + hashHex;
}

export async function verifyPassword(input: string, stored: string): Promise<boolean> {
  if (stored.startsWith(HASH_PREFIX)) {
    const inputHash = await hashPassword(input);
    return constantTimeCompare(inputHash, stored);
  }
  // Legacy: plain text — always hash to prevent timing side-channel
  const inputHash = await hashPassword(input);
  const storedHash = await hashPassword(stored);
  return constantTimeCompare(inputHash, storedHash);
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
  return stored.startsWith(HASH_PREFIX);
}

// ── Token & Password Generation ──

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
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
