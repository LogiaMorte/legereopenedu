/**
 * Public config — returns non-secret configuration for frontend
 * GET /api/config → { googleClientId: "..." }
 */

import { corsHeaders, optionsResponse } from '../_shared';

interface Env {
  GOOGLE_CLIENT_ID?: string;
  LINKEDIN_CLIENT_ID?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const headers = corsHeaders(context.request);
  return new Response(JSON.stringify({
    googleClientId: context.env.GOOGLE_CLIENT_ID || '',
    linkedinEnabled: !!context.env.LINKEDIN_CLIENT_ID,
  }), {
    status: 200,
    headers: { ...headers, 'Cache-Control': 'public, max-age=300' },
  });
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request);
};
