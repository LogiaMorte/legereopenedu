/**
 * LinkedIn OAuth — Step 1: Redirect to LinkedIn authorization
 *
 * GET /api/auth/linkedin?mode=login|signup&lang=tr|en
 *   → Redirects user to LinkedIn OAuth 2.0 authorization URL
 *   → Uses OpenID Connect scopes (openid, profile, email)
 *
 * Required env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 */

interface Env {
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (!env.LINKEDIN_CLIENT_ID) {
    return new Response('LinkedIn sign-in not configured', { status: 500 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'login';
  const lang = url.searchParams.get('lang') || 'tr';

  // Build callback URL from request origin
  const origin = url.origin;
  const redirectUri = `${origin}/api/auth/linkedin-callback`;

  // State parameter encodes mode and lang for the callback
  const stateData = JSON.stringify({ mode, lang });
  const stateBytes = new TextEncoder().encode(stateData);
  const state = btoa(String.fromCharCode(...stateBytes));

  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'openid profile email r_verify r_profile_basicinfo');

  return Response.redirect(authUrl.toString(), 302);
};
