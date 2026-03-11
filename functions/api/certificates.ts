/**
 * Certificates API — Public sertifika doğrulama
 *
 * GET /api/certificates?cert=LEGERE-2026-001  → Sertifika verisi (public)
 */

import { corsHeaders, optionsResponse } from '../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  const headers = {
    ...corsHeaders(request, 'GET, OPTIONS'),
    'Cache-Control': 'public, max-age=86400, immutable',
  };

  if (!env.REGISTRATIONS) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
  }

  const certId = url.searchParams.get('cert');
  if (!certId) {
    return new Response(JSON.stringify({ error: 'Missing cert parameter' }), { status: 400, headers });
  }

  try {
    const certData = await env.REGISTRATIONS.get(`cert:${certId}`);
    if (!certData) {
      return new Response(JSON.stringify({ valid: false, error: 'Certificate not found' }), {
        status: 404,
        headers,
      });
    }

    const cert = JSON.parse(certData);

    return new Response(
      JSON.stringify({
        valid: true,
        certificate: {
          id: cert.id,
          type: cert.type,
          participantName: cert.participantName,
          workshopTitle: cert.workshopTitle,
          dateStart: cert.dateStart,
          dateEnd: cert.dateEnd,
          disciplines: cert.disciplines,
          issueDate: cert.issueDate,
        },
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error('[certificates] Error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, 'GET, OPTIONS');
};
