/**
 * LinkedIn OAuth — Step 2: Handle callback
 *
 * GET /api/auth/linkedin-callback?code=...&state=...
 */

import {
  buildLoginCookies,
  redirectWithCookies,
  notifyAdmin,
  ensureSessionToken,
  isAdminEmail,
} from '../../_shared';
import {
  parseAndVerifyLinkedInState,
  clearLinkedInOAuthCookie,
  loadMemberByEmail,
  isDeactivated,
  reactivateMember,
  createSocialMember,
  putMember,
  bumpMemberCount,
  type AuthMode,
} from '../../_auth-member';

interface Env {
  REGISTRATIONS: KVNamespace;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAILS?: string;
}

interface LinkedInUserInfo {
  sub: string;
  name: string;
  given_name?: string;
  family_name?: string;
  email: string;
  email_verified?: boolean;
  picture?: string;
}

interface LinkedInBasicProfile {
  headline?: string;
  vanityName?: string;
  profileUrl?: string;
}

async function fetchLinkedInBasicProfile(accessToken: string): Promise<LinkedInBasicProfile> {
  try {
    const res = await fetch(
      'https://api.linkedin.com/v2/me?projection=(localizedHeadline,vanityName)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      console.log('[linkedin] Basic profile API status:', res.status);
      return {};
    }
    const data = (await res.json()) as { localizedHeadline?: string; vanityName?: string };
    return {
      headline: data.localizedHeadline || '',
      vanityName: data.vanityName || '',
      profileUrl: data.vanityName ? `https://www.linkedin.com/in/${data.vanityName}` : '',
    };
  } catch (err) {
    console.error('[linkedin] Basic profile fetch failed:', err);
    return {};
  }
}

async function fetchLinkedInVerifications(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.linkedin.com/v2/memberVerifications?q=member', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.log('[linkedin] Verification API status:', res.status);
      return [];
    }
    const data = (await res.json()) as { elements?: Array<Record<string, unknown>> };
    if (!data.elements || !Array.isArray(data.elements)) return [];
    return data.elements
      .filter((v) => v.status === 'VERIFIED' || v.status === 'ACTIVE')
      .map((v) => String(v.type || v.verificationType || 'UNKNOWN').toUpperCase());
  } catch (err) {
    console.error('[linkedin] Verification check failed:', err);
    return [];
  }
}

function redirectError(
  origin: string,
  page: string,
  code: string,
  description: string,
): Response {
  const location = `${origin}${page}?error=${encodeURIComponent(code)}&error_description=${encodeURIComponent(description)}`;
  const headers = new Headers({ Location: location });
  headers.append('Set-Cookie', clearLinkedInOAuthCookie());
  return new Response(null, { status: 302, headers });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  let mode: AuthMode = 'login';
  let lang = 'tr';

  if (!env.LINKEDIN_CLIENT_SECRET) {
    return redirectError(url.origin, '/login', 'config', 'LinkedIn not configured');
  }

  const verified = await parseAndVerifyLinkedInState(
    url.searchParams.get('state'),
    request,
    env.LINKEDIN_CLIENT_SECRET,
  );
  if (verified.ok) {
    mode = verified.mode;
    lang = verified.lang;
  }

  const langPrefix = lang === 'en' ? '/en' : '';
  const redirectPage = mode === 'signup' ? `${langPrefix}/signup` : `${langPrefix}/login`;
  const profilePage = `${langPrefix}/profile`;

  if (!verified.ok) {
    return redirectError(
      url.origin,
      redirectPage,
      verified.reason,
      lang === 'en'
        ? 'LinkedIn session expired or invalid. Please try again.'
        : 'LinkedIn oturumu geçersiz veya süresi doldu. Lütfen tekrar deneyin.',
    );
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const desc = url.searchParams.get('error_description') || 'LinkedIn authorization failed';
    return redirectError(url.origin, redirectPage, oauthError, desc);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return redirectError(url.origin, redirectPage, 'missing_code', 'Authorization code missing');
  }

  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    return redirectError(url.origin, redirectPage, 'config', 'LinkedIn not configured');
  }

  if (!env.REGISTRATIONS) {
    console.error('[linkedin-callback] REGISTRATIONS KV binding is missing');
    return redirectError(
      url.origin,
      redirectPage,
      'config',
      'KV storage not bound. Please check Cloudflare Pages KV bindings.',
    );
  }

  try {
    const redirectUri = `${url.origin}/api/auth/linkedin-callback`;
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[linkedin] Token exchange failed:', tokenRes.status);
      return redirectError(url.origin, redirectPage, 'token_failed', 'LinkedIn authentication failed');
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    const [userInfoRes, basicProfile, verifications] = await Promise.all([
      fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetchLinkedInBasicProfile(accessToken),
      fetchLinkedInVerifications(accessToken),
    ]);

    if (!userInfoRes.ok) {
      console.error('[linkedin] UserInfo failed:', userInfoRes.status);
      return redirectError(
        url.origin,
        redirectPage,
        'profile_failed',
        'Could not fetch LinkedIn profile',
      );
    }

    const userInfo = (await userInfoRes.json()) as LinkedInUserInfo;

    if (!userInfo.email) {
      return redirectError(url.origin, redirectPage, 'no_email', 'LinkedIn account has no email');
    }

    if (userInfo.email_verified === false) {
      return redirectError(
        url.origin,
        redirectPage,
        'email_unverified',
        'LinkedIn email is not verified',
      );
    }

    const email = userInfo.email.toLowerCase();
    const linkedinVerified = verifications.length > 0;
    const existing = await loadMemberByEmail(env.REGISTRATIONS, email);

    if (existing) {
      if (isDeactivated(existing.member)) {
        if (!isAdminEmail(existing.keyEmail, env.ADMIN_EMAILS) && !isAdminEmail(email, env.ADMIN_EMAILS)) {
          return redirectError(
            url.origin,
            redirectPage,
            'deactivated',
            lang === 'en'
              ? 'This account has been deactivated'
              : 'Bu hesap devre dışı bırakılmış',
          );
        }
        reactivateMember(existing.member);
      }

      const member = existing.member;
      // Mevcut token korunur — bkz. ensureSessionToken (giriş döngüsü)
      member.token = ensureSessionToken(member);
      if (!member.linkedinSub) member.linkedinSub = userInfo.sub;
      member.linkedinVerified = linkedinVerified;
      member.linkedinVerifications = verifications;
      if (userInfo.picture) member.picture = userInfo.picture;
      if (basicProfile.headline) member.linkedinHeadline = basicProfile.headline;
      if (basicProfile.profileUrl && !member.linkedin) member.linkedin = basicProfile.profileUrl;
      await putMember(env.REGISTRATIONS, existing.keyEmail, member);

      const cookies = [
        ...buildLoginCookies(existing.keyEmail, member.token, undefined, request.url),
        clearLinkedInOAuthCookie(),
      ];
      return redirectWithCookies(`${url.origin}${profilePage}`, cookies);
    }

    // Üye yoksa oluştur (login veya signup) — TTL ile silinmiş hesaplar tekrar açılsın
    const displayName =
      userInfo.name ||
      `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim() ||
      '';

    const member = createSocialMember({
      email,
      name: displayName,
      picture: userInfo.picture || '',
      signupSource: 'linkedin',
      linkedinSub: userInfo.sub,
      linkedinVerified,
      linkedinVerifications: verifications,
      linkedinHeadline: basicProfile.headline || '',
      linkedin: basicProfile.profileUrl || '',
      department: basicProfile.headline || '',
      consentAt: mode === 'signup' ? new Date().toISOString() : undefined,
      signupIp: request.headers.get('CF-Connecting-IP') || 'unknown',
      signupCountry: request.headers.get('CF-IPCountry') || 'unknown',
    });

    await putMember(env.REGISTRATIONS, email, member);
    const total = await bumpMemberCount(env.REGISTRATIONS);

    context.waitUntil(
      notifyAdmin(env, 'Yeni üye (LinkedIn)', {
        Ad: member.name || '',
        'E-posta': email,
        'Toplam üye': String(total),
      }),
    );

    const cookies = [
      ...buildLoginCookies(email, member.token, undefined, request.url),
      clearLinkedInOAuthCookie(),
    ];
    const destination =
      mode === 'signup'
        ? `${url.origin}${langPrefix}/signup?success=new`
        : `${url.origin}${profilePage}`;
    return redirectWithCookies(destination, cookies);
  } catch (err) {
    console.error('[linkedin] Error:', err instanceof Error ? err.message : err);
    return redirectError(url.origin, redirectPage, 'internal', 'Internal server error');
  }
};
