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
    // Credentialed fetch (cookies) — Origin varsa tarayıcı bunu ister
    headers['Access-Control-Allow-Credentials'] = 'true';
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

/** Oturum token'ı biçimi — çerezdeki değer de bununla doğrulanıyor. */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * Girişte kullanılacak oturum token'ı: ÜYENİN MEVCUT TOKEN'I VARSA KORUNUR.
 *
 * Eskiden her giriş yeni token üretiyordu ve "giriş başarılı ama profil boş"
 * döngüsünün sebebi buydu:
 *
 *   1. Ziyaretçi sayfayı açar, nav üye durumu için /api/auth/me çağırır.
 *      Bu okuma `member:{email}` kaydını Cloudflare uçta önbelleğe alır.
 *   2. Kullanıcı giriş yapar; sunucu YENİ token üretip KV'ye yazar ve çereze
 *      yeni token'ı koyar.
 *   3. Profil sayfası /api/auth/me çağırır. KV okuması hâlâ önbellekteki ESKİ
 *      kaydı dönebilir (KV eventual consistent, okumalar uçta ~60 sn tutulur).
 *      Çerezdeki yeni token ile KV'deki eski token eşleşmez -> 401.
 *   4. Profil "giriş yapmanız gerekiyor" der ve çerezi siler; kullanıcı yeniden
 *      giriş yapar, yeni bir token daha üretilir — döngü kapanmaz.
 *
 * Token'ı korumak bu yarışı tamamen ortadan kaldırır: eski kayıt okunsa bile
 * içindeki token çerezdekiyle AYNI olur. Oturumu geçersiz kılma yeteneği
 * kaybolmuyor — çıkış (DELETE /api/auth/me) token'ı hâlâ döndürüyor.
 */
export function ensureSessionToken(member: { token?: unknown }): string {
  const current = typeof member.token === 'string' ? member.token : '';
  return TOKEN_RE.test(current) ? current : generateToken();
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

/** Cookie header'daki tüm legere_token değerlerini (yeniden eskiye) döndür. */
export function listSessionTokenCandidates(
  request: Request,
): Array<{ email: string; token: string }> {
  try {
    const cookieHeader = request.headers.get('Cookie') || '';
    const candidates = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter((c) => c.startsWith('legere_token='))
      .map((c) => c.slice('legere_token='.length));

    const out: Array<{ email: string; token: string }> = [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const parsed = parseTokenValue(candidates[i]);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}

export function parseSessionCookie(request: Request): { email: string; token: string } | null {
  const list = listSessionTokenCandidates(request);
  return list[0] || null;
}

function parseTokenValue(cookieValue: string): { email: string; token: string } | null {
  const separatorIndex = cookieValue.lastIndexOf(':');
  if (separatorIndex === -1) return null;

  let email: string;
  try {
    email = decodeURIComponent(cookieValue.substring(0, separatorIndex));
  } catch {
    email = cookieValue.substring(0, separatorIndex);
  }
  const token = cookieValue.substring(separatorIndex + 1);

  if (!email || !token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return { email: email.toLowerCase(), token };
}

// ── Cookie Helpers ──

/**
 * Build Set-Cookie headers for login.
 *
 * Host-only cookie kullanırız (Domain YOK): www zaten apex'e 301.
 * Eski Domain=.legereopenedu.com çerezlerini Max-Age=0 ile temizleriz —
 * aksi halde tarayıcı iki legere_token gönderir; ilki eski/bozuk token
 * olunca /api/auth/me 401 döner ve "giriş yapmanız gerekiyor" döngüsü oluşur.
 */
export function buildLoginCookies(
  email: string,
  token: string,
  maxAge = 30 * 24 * 60 * 60,
  _requestUrl?: string,
): string[] {
  const cookieValue = `${encodeURIComponent(email.toLowerCase())}:${token}`;
  return [
    // Eski Domain= çerezlerini sil (host-only silme bunları temizlemez)
    'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Domain=.legereopenedu.com',
    'legere_logged_in=; Path=/; Secure; SameSite=Lax; Max-Age=0; Domain=.legereopenedu.com',
    // Eski host-only kalıntı
    'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'legere_logged_in=; Path=/; Secure; SameSite=Lax; Max-Age=0',
    // Yeni oturum (host-only)
    `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
    `legere_logged_in=1; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  ];
}

/**
 * Build Set-Cookie headers for logout (clear host-only + Domain= kalıntıları).
 */
export function buildLogoutCookies(_requestUrl?: string): string[] {
  return [
    'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Domain=.legereopenedu.com',
    'legere_logged_in=; Path=/; Secure; SameSite=Lax; Max-Age=0; Domain=.legereopenedu.com',
    'legere_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'legere_logged_in=; Path=/; Secure; SameSite=Lax; Max-Age=0',
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

// ── Admin bildirimi ──

interface NotifyEnv {
  DISCORD_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAILS?: string;
}

/**
 * Yeni başvuru / yeni üye gibi olaylarda admini haberdar eder.
 *
 * Hangi kanal yapılandırılmışsa oraya gider: DISCORD_WEBHOOK_URL varsa Discord'a,
 * RESEND_API_KEY + ADMIN_EMAILS varsa e-posta. İkisi de yoksa sessizce hiçbir şey
 * yapmaz — bildirim yokluğu bir hata değil.
 *
 * ÖNEMLİ: bu fonksiyon asla throw etmez ve çağıran akışı bloklamamalıdır.
 * Bildirim servisi çökse bile kayıt alınmaya devam etmeli; bu yüzden çağrılar
 * `context.waitUntil(notifyAdmin(...))` ile yanıt döndükten sonra çalışır.
 */
export async function notifyAdmin(
  env: NotifyEnv,
  title: string,
  fields: Record<string, string>,
): Promise<void> {
  const lines = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `**${k}:** ${String(v).slice(0, 300)}`);

  const tasks: Promise<unknown>[] = [];

  if (env.DISCORD_WEBHOOK_URL) {
    tasks.push(
      fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: title.slice(0, 250),
            description: lines.join('\n').slice(0, 3900),
            color: 0xd4a843, // Legere altını
            timestamp: new Date().toISOString(),
          }],
        }),
      })
        .then((r) => {
          // Sessiz başarısızlık en kötüsü: webhook silinmiş/yanlışsa haber alınmalı.
          if (!r.ok) console.error('[notify] Discord webhook döndü:', r.status);
        })
        .catch((e) => console.error('[notify] Discord webhook hatası:', e instanceof Error ? e.message : e)),
    );
  }

  if (env.RESEND_API_KEY && env.ADMIN_EMAILS) {
    // Birden çok admin tanımlıysa hepsine değil ilkine gider — bildirim
    // kopyası çoğaltmak yerine tek adres yeter, panelde zaten hepsi görünür.
    const to = env.ADMIN_EMAILS.split(',')[0]?.trim();
    if (to) {
      const html = `<h2>${escapeHtml(title)}</h2><ul>${Object.entries(fields)
        .filter(([, v]) => v)
        .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v).slice(0, 300))}</li>`)
        .join('')}</ul><p><a href="https://legereopenedu.com/admin">Panele git</a></p>`;
      tasks.push(sendEmail(env.RESEND_API_KEY, to, `[Legere] ${title}`, html).catch(() => undefined));
    }
  }

  await Promise.allSettled(tasks);
}
