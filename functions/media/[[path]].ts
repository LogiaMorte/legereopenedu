/**
 * Cloudflare Pages Function — R2'deki görselleri sitenin kendi adresinden servis eder
 *
 *   GET /media/afis/...  → R2'deki (MEDYA) nesne
 *
 * Neden ayrı bir alt alan adı değil de site içi yol:
 *
 * _headers dosyasındaki CSP `img-src 'self'` diyor. Görselleri başka bir
 * kökenden servis etmek CSP'yi o kökene açmak demekti; o an itibarıyla orası
 * siteye görsel basabilen bir taraf olurdu. Aynı kökenden servis edince CSP'ye
 * hiç dokunulmuyor ve etkinlik kaydındaki posterUrl doğrulaması da olduğu gibi
 * kalıyor (yalnızca "/" ile başlayan yollar).
 *
 * Anahtarlar rastgele ek taşıdığı için içerik değişmez; bu yüzden bir yıllık
 * immutable önbellek veriliyor. Böylece istekler çoğunlukla Cloudflare
 * önbelleğinden dönüyor ve her görüntüleme bir Function çalıştırmıyor.
 *
 * R2 Binding: MEDYA
 */

interface Env {
  MEDYA: R2Bucket;
}

const BIR_YIL = 'public, max-age=31536000, immutable';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (!env.MEDYA) {
    return new Response('Depolama bağlı değil', { status: 500 });
  }

  // [[path]] parçaları dizi olarak gelir: /media/afis/x.png -> ['afis', 'x.png']
  const parcalar = Array.isArray(params.path) ? params.path : [params.path];
  const anahtar = parcalar.filter(Boolean).join('/');
  if (!anahtar) return new Response('Bulunamadı', { status: 404 });

  /*
   * Yalnızca yüklediğimiz ön ek okunabilir. Kova ileride başka şeyler de
   * tutarsa (yedek, geçici dosya) bu uç onları servis etmesin.
   */
  if (!anahtar.startsWith('afis/')) {
    return new Response('Bulunamadı', { status: 404 });
  }

  const nesne = await env.MEDYA.get(anahtar);
  if (!nesne) return new Response('Bulunamadı', { status: 404 });

  const headers = new Headers();
  nesne.writeHttpMetadata(headers);
  headers.set('Cache-Control', BIR_YIL);
  headers.set('ETag', nesne.httpEtag);
  // Tarayıcı içeriği kendi tahminine göre yorumlamasın
  headers.set('X-Content-Type-Options', 'nosniff');

  // Şartlı istek: içerik değişmediyse gövdeyi tekrar göndermeye gerek yok
  const etag = request.headers.get('If-None-Match');
  if (etag && etag === nesne.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(nesne.body, { headers });
};
