/**
 * Debug endpoint — lists available env bindings
 * DELETE THIS FILE after debugging!
 */
export const onRequestGet: PagesFunction = async (context) => {
  const envKeys = Object.keys(context.env || {});
  const envTypes: Record<string, string> = {};
  for (const key of envKeys) {
    const val = (context.env as any)[key];
    envTypes[key] = val === null ? 'null' : typeof val === 'object' ? val.constructor?.name || 'object' : typeof val;
  }
  return new Response(JSON.stringify({ envKeys, envTypes }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
