/** Yalnızca http(s). javascript: / data: bağlarını keser. */
export function safeHttpUrl(raw: string | undefined | null): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch {
    /* ignore */
  }
  return '';
}
