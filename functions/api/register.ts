/**
 * Cloudflare Pages Function — Workshop Registration API
 *
 * KV Binding: REGISTRATIONS (Cloudflare Dashboard'dan bağlanır)
 * Env vars: ADMIN_KEY, RESEND_API_KEY (opsiyonel)
 */

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_KEY?: string;
  RESEND_API_KEY?: string;
}

interface RegistrationData {
  name: string;
  email: string;
  university: string;
  department: string;
  workshop: string;
  motivation?: string;
  timestamp: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const data: RegistrationData = await request.json();

    // Validate required fields
    if (!data.name || !data.email || !data.university || !data.department || !data.workshop) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers }
      );
    }

    // Sanitize & create registration
    const registration = {
      id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: data.name.trim().slice(0, 200),
      email: data.email.trim().toLowerCase().slice(0, 200),
      university: data.university.trim().slice(0, 200),
      department: data.department.trim().slice(0, 200),
      workshop: data.workshop.trim().slice(0, 200),
      motivation: (data.motivation || '').trim().slice(0, 1000),
      status: 'pending', // pending | accepted | rejected
      timestamp: data.timestamp || new Date().toISOString(),
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      country: request.headers.get('CF-IPCountry') || 'unknown',
    };

    // Store in KV
    if (env.REGISTRATIONS) {
      await env.REGISTRATIONS.put(
        registration.id,
        JSON.stringify(registration),
        { expirationTtl: 60 * 60 * 24 * 365 }
      );

      // Update workshop index
      const indexKey = `index:${registration.workshop}`;
      const existingIndex = await env.REGISTRATIONS.get(indexKey);
      const ids: string[] = existingIndex ? JSON.parse(existingIndex) : [];
      ids.push(registration.id);
      await env.REGISTRATIONS.put(indexKey, JSON.stringify(ids));

      // Update total count
      const countKey = 'count:total';
      const currentCount = parseInt(await env.REGISTRATIONS.get(countKey) || '0');
      await env.REGISTRATIONS.put(countKey, String(currentCount + 1));
    }

    return new Response(
      JSON.stringify({ success: true, id: registration.id }),
      { status: 200, headers }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers }
    );
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
