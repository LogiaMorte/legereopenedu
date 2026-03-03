/**
 * Auth Verify — Deprecated (password login replaces magic links)
 *
 * GET /api/auth/verify?token=...
 *   → Redirects to /login since we now use password-based auth
 */

interface Env {
  REGISTRATIONS: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/login' },
  });
};
