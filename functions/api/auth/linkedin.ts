/**
 * LinkedIn OAuth — Step 1: Redirect to LinkedIn authorization
 *
 * GET /api/auth/linkedin?mode=login|signup&lang=tr|en
 *   → CSRF nonce cookie + signed-ish state
 *   → openid profile email (partner scope'lar opsiyonel; yoksa OAuth kırılıyordu)
 */

import { buildLinkedInOAuthState, type AuthMode } from '../../_auth-member';

interface Env {
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  /** '1' ise r_verify + r_profile_basicinfo de istenir (LinkedIn ürünü gerekir) */
  LINKEDIN_FULL_SCOPES?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.LINKEDIN_CLIENT_ID) {
    return new Response('LinkedIn sign-in not configured', { status: 500 });
  }

  const url = new URL(request.url);
  const modeParam = url.searchParams.get('mode') || 'login';
  const lang = url.searchParams.get('lang') || 'tr';
  const mode: AuthMode = modeParam === 'signup' ? 'signup' : 'login';

  const origin = url.origin;
  const redirectUri = `${origin}/api/auth/linkedin-callback`;

  const { state, cookie } = buildLinkedInOAuthState(mode, lang);

  const scope =
    env.LINKEDIN_FULL_SCOPES === '1'
      ? 'openid profile email r_verify r_profile_basicinfo'
      : 'openid profile email';

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', scope);

  const headers = new Headers({ Location: authUrl.toString() });
  headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};
