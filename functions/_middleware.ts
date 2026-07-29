/**
 * Tüm istekler için ortak ara katman.
 *
 * Amaç: legereopenedu.pages.dev üzerinden gelen istekleri asıl alan adına
 * kalıcı olarak yönlendirmek. Aynı içerik iki ayrı URL'de sunulduğunda arama
 * motorları açısından bölünme oluyor; canonical etiketi bunu zayıflatıyor ama
 * çözmüyor.
 *
 * Neden burada: Cloudflare Pages'in `public/_redirects` dosyası yalnızca yol
 * eşleştirir, hostname eşleştiremez — bu kural oradan yazılamaz.
 *
 * Preview deploy'ları korunur: yalnızca üretim alt alanı (tam olarak
 * "legereopenedu.pages.dev") yönlendirilir. Dallara ait
 * "<hash>.legereopenedu.pages.dev" adresleri olduğu gibi bırakılır, yoksa
 * deploy öncesi önizleme yapılamaz hâle gelir.
 */

const PRODUCTION_HOST = 'legereopenedu.com';
const PAGES_HOST = 'legereopenedu.pages.dev';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);

  if (url.hostname.toLowerCase() === PAGES_HOST) {
    url.hostname = PRODUCTION_HOST;
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
};
