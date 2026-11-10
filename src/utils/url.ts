/**
 * Kullanıcıdan gelen dış bağlantıların tek temizleme noktası.
 *
 * Hem sunucuda (kaydetmeden önce, `functions/api/auth/me.ts`) hem tarayıcıda
 * (href'e yazmadan önce) çağrılır. İkisi birden gerekiyor: sunucu kapıdır,
 * tarayıcı tarafı ise KV'de zaten duran eski/kirli kayıtlara karşı korur.
 *
 * Reddetme listesi yerine izin listesi: yalnızca http ve https. "javascript:"
 * yazımını yakalamaya çalışan filtreler `java\tscript:` gibi yazımlarda
 * deliniyor, çünkü tarayıcı şema içindeki sekme/satır sonunu yok sayıyor.
 */

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/** URL ayrıştırmasından ÖNCE atılan karakterler: tarayıcı bunları yok sayar. */
const IGNORED_BY_BROWSERS = /[\u0000-\u0020\u007f]/g;

export function sanitizeExternalUrl(raw: unknown, maxLength = 300): string {
  if (typeof raw !== 'string') return '';

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLength) return '';

  // Şema tespitini tarayıcının gördüğü hâl üzerinde yap.
  const collapsed = trimmed.replace(IGNORED_BY_BROWSERS, '');
  if (!collapsed) return '';

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(collapsed)
    ? collapsed
    : 'https://' + collapsed;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return '';
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol.toLowerCase())) return '';
  if (!url.hostname) return '';

  const normalized = url.toString();
  return normalized.length > maxLength ? '' : normalized;
}
