/**
 * LinkedIn OAuth — Step 2: Handle callback
 *
 * GET /api/auth/linkedin-callback?code=...&state=...
 *   → Exchange code for access token
 *   → Fetch user profile (name, email, picture)
 *   → Check LinkedIn verification status (identity, employment, education)
 *   → Create or login member (same logic as Google auth)
 *   → Set session cookie and redirect
 *
 * Required env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, REGISTRATIONS (KV)
 */

import {
  generateToken,
  generatePassword,
  hashPassword,
} from '../../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
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

/**
 * Fetch LinkedIn basic profile info (headline, vanityName).
 * Requires r_profile_basicinfo scope.
 */
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
    const data = await res.json() as any;
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

/**
 * Fetch LinkedIn verification categories for the member.
 * Returns array of verified category strings, e.g. ['IDENTITY', 'EMPLOYMENT', 'EDUCATION']
 */
async function fetchLinkedInVerifications(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.linkedin.com/v2/memberVerifications?q=member', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.log('[linkedin] Verification API status:', res.status);
      return [];
    }
    const data = await res.json() as { elements?: any[] };
    if (!data.elements || !Array.isArray(data.elements)) return [];
    return data.elements
      .filter((v: any) => v.status === 'VERIFIED' || v.status === 'ACTIVE')
      .map((v: any) => (v.type || v.verificationType || 'UNKNOWN').toUpperCase());
  } catch (err) {
    console.error('[linkedin] Verification check failed:', err);
    return [];
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  // Parse state to get mode and lang
  let mode = 'login';
  let lang = 'tr';
  try {
    const stateParam = url.searchParams.get('state') || '';
    const stateJson = atob(stateParam);
    const stateData = JSON.parse(stateJson);
    mode = stateData.mode || 'login';
    lang = stateData.lang || 'tr';
  } catch {
    // Default values already set
  }

  const langPrefix = lang === 'en' ? '/en' : '';
  const redirectPage = mode === 'signup' ? `${langPrefix}/signup` : `${langPrefix}/login`;
  const profilePage = `${langPrefix}/profile`;

  // Check for LinkedIn error
  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description') || 'LinkedIn authorization failed';
    return Response.redirect(
      `${url.origin}${redirectPage}?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(desc)}`,
      302,
    );
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return Response.redirect(
      `${url.origin}${redirectPage}?error=missing_code&error_description=${encodeURIComponent('Authorization code missing')}`,
      302,
    );
  }

  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    return Response.redirect(
      `${url.origin}${redirectPage}?error=config&error_description=${encodeURIComponent('LinkedIn not configured')}`,
      302,
    );
  }

  if (!env.REGISTRATIONS) {
    return Response.redirect(
      `${url.origin}${redirectPage}?error=config&error_description=${encodeURIComponent('Server configuration error')}`,
      302,
    );
  }

  try {
    // Exchange code for access token
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
      return Response.redirect(
        `${url.origin}${redirectPage}?error=token_failed&error_description=${encodeURIComponent('LinkedIn authentication failed')}`,
        302,
      );
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenData.access_token;

    // Fetch user profile, basic profile, and verification status in parallel
    const [userInfoRes, basicProfile, verifications] = await Promise.all([
      fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetchLinkedInBasicProfile(accessToken),
      fetchLinkedInVerifications(accessToken),
    ]);

    if (!userInfoRes.ok) {
      console.error('[linkedin] UserInfo failed:', userInfoRes.status);
      return Response.redirect(
        `${url.origin}${redirectPage}?error=profile_failed&error_description=${encodeURIComponent('Could not fetch LinkedIn profile')}`,
        302,
      );
    }

    const userInfo = (await userInfoRes.json()) as LinkedInUserInfo;

    if (!userInfo.email) {
      return Response.redirect(
        `${url.origin}${redirectPage}?error=no_email&error_description=${encodeURIComponent('LinkedIn account has no email')}`,
        302,
      );
    }

    const email = userInfo.email.toLowerCase();
    let isNewMember = false;

    // Check if member exists
    let memberData = await env.REGISTRATIONS.get(`member:${email}`);
    let member: any;

    if (memberData) {
      // Existing member — update token, verification, and LinkedIn profile data
      member = JSON.parse(memberData);
      member.token = generateToken();
      if (!member.linkedinSub) {
        member.linkedinSub = userInfo.sub;
      }
      // Always update verification status on each login
      member.linkedinVerified = true;
      member.linkedinVerifications = verifications;
      // Update picture if available
      if (userInfo.picture) {
        member.picture = userInfo.picture;
      }
      // Update LinkedIn profile data
      if (basicProfile.headline) member.linkedinHeadline = basicProfile.headline;
      if (basicProfile.profileUrl && !member.linkedin) member.linkedin = basicProfile.profileUrl;
      await env.REGISTRATIONS.put(`member:${email}`, JSON.stringify(member), {
        expirationTtl: 60 * 60 * 24 * 365,
      });
    } else {
      // Check alias
      const alias = await env.REGISTRATIONS.get(`member-alias:${email}`);
      if (alias) {
        memberData = await env.REGISTRATIONS.get(`member:${alias}`);
        if (memberData) {
          member = JSON.parse(memberData);
          member.token = generateToken();
          if (!member.linkedinSub) member.linkedinSub = userInfo.sub;
          member.linkedinVerified = true;
          member.linkedinVerifications = verifications;
          if (userInfo.picture) member.picture = userInfo.picture;
          if (basicProfile.headline) member.linkedinHeadline = basicProfile.headline;
          if (basicProfile.profileUrl && !member.linkedin) member.linkedin = basicProfile.profileUrl;
          await env.REGISTRATIONS.put(`member:${alias}`, JSON.stringify(member), {
            expirationTtl: 60 * 60 * 24 * 365,
          });

          const cookieValue = `${encodeURIComponent(alias)}:${member.token}`;
          const maxAge = 30 * 24 * 60 * 60;
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${url.origin}${profilePage}`,
              'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
            },
          });
        }
      }

      // New member
      isNewMember = true;
      const plainPassword = generatePassword();
      const token = generateToken();

      member = {
        email,
        name: userInfo.name || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim() || '',
        password: await hashPassword(plainPassword),
        token,
        university: '',
        department: basicProfile.headline || '',
        linkedin: basicProfile.profileUrl || '',
        linkedinHeadline: basicProfile.headline || '',
        picture: userInfo.picture || '',
        joinDate: new Date().toISOString().split('T')[0],
        showFullName: true,
        showEmail: false,
        certificates: [],
        adminBadges: [],
        regIds: [],
        interests: [],
        ideas: '',
        signupSource: 'linkedin',
        linkedinSub: userInfo.sub,
        linkedinVerified: true,
        linkedinVerifications: verifications,
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

    // Set session cookie and redirect
    const cookieValue = `${encodeURIComponent(email)}:${member.token}`;
    const maxAge = 30 * 24 * 60 * 60;

    const destination = isNewMember
      ? `${url.origin}${mode === 'signup' ? `${langPrefix}/signup?success=new` : profilePage}`
      : `${url.origin}${profilePage}`;

    return new Response(null, {
      status: 302,
      headers: {
        Location: destination,
        'Set-Cookie': `legere_token=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
      },
    });
  } catch (err) {
    console.error('[linkedin] Error:', err instanceof Error ? err.message : err);
    return Response.redirect(
      `${url.origin}${redirectPage}?error=internal&error_description=${encodeURIComponent('Internal server error')}`,
      302,
    );
  }
};
