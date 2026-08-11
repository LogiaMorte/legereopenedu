/**
 * Cloudflare Pages Function — Görsel yükleme (yalnızca admin)
 *
 *   POST /api/upload   → çok parçalı form, alan adı "file"
 *                        yanıt: { url: "/media/afis/..." }
 *
 * Afişler eskiden repoya konuyordu; her etkinlik için commit ve deploy
 * gerekiyordu. Artık R2'de (MEDYA kovası) duruyorlar ve panelden yükleniyorlar.
 *
 * Görseller SİTENİN KENDİ ADRESİNDEN servis ediliyor (bkz. functions/media/),
 * ayrı bir alt alan adı üzerinden değil. Sebebi CSP: _headers içinde
 * `img-src 'self'` var; dış bir kökene izin vermek, o kökeni siteye görsel
 * basabilen bir taraf yapardı. Aynı köken kalınca CSP'ye hiç dokunulmuyor.
 *
 * R2 Binding: MEDYA
 * KV Binding: REGISTRATIONS (admin oturumu doğrulaması için)
 * Env: ADMIN_EMAILS
 */

import { corsHeaders, optionsResponse, verifyAdmin } from '../_shared';

interface Env {
  MEDYA: R2Bucket;
  REGISTRATIONS: KVNamespace;
  ADMIN_EMAILS?: string;
}

/** 8 MB. Afiş için fazlasıyla yeterli; R2'ye çöp dolmasın. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * İzin verilen türler ve uzantıları.
 *
 * SVG BİLEREK YOK: SVG içine script gömülebiliyor ve aynı kökenden servis
 * edilen bir SVG'yi tarayıcı belge olarak açarsa o script site bağlamında
 * çalışır. Afiş için raster biçimler yeterli.
 */
const IZINLI: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Dosya adı kullanıcıdan geliyor; anahtar olarak güvenli hâle getir. */
function slugla(ad: string): string {
  const tr: Record<string, string> = {
    ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i',
    ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  };
  return ad
    .replace(/\.[^.]+$/, '')
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'afis';
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request, 'POST, OPTIONS');

  if (!env.MEDYA) {
    return new Response(JSON.stringify({ error: 'R2 bağlı değil (MEDYA).' }), { status: 500, headers });
  }

  const admin = await verifyAdmin(request, env.REGISTRATIONS, env.ADMIN_EMAILS);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Yetkisiz.' }), { status: 403, headers });
  }

  // Content-Length ön kontrolü: 8 MB'lık bir gövdeyi baştan sona okumadan
  // reddedebiliyorsak okumayalım. Başlık yalan söyleyebilir, asıl kontrol altta.
  const bildirilen = Number(request.headers.get('content-length') || '0');
  if (bildirilen > MAX_BYTES * 1.1) {
    return new Response(JSON.stringify({ error: 'Dosya çok büyük (en fazla 8 MB).' }), { status: 413, headers });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Geçersiz form verisi.' }), { status: 400, headers });
  }

  const dosya = form.get('file');
  if (!(dosya instanceof File)) {
    return new Response(JSON.stringify({ error: 'Dosya bulunamadı ("file" alanı).' }), { status: 400, headers });
  }

  const tur = (dosya.type || '').toLowerCase();
  const uzanti = IZINLI[tur];
  if (!uzanti) {
    return new Response(
      JSON.stringify({ error: 'Yalnızca PNG, JPEG, WebP ve AVIF yüklenebilir.' }),
      { status: 415, headers },
    );
  }

  const veri = await dosya.arrayBuffer();
  if (veri.byteLength > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'Dosya çok büyük (en fazla 8 MB).' }), { status: 413, headers });
  }
  if (veri.byteLength === 0) {
    return new Response(JSON.stringify({ error: 'Dosya boş.' }), { status: 400, headers });
  }

  /*
   * Anahtara rastgele bir ek konuyor. İki sebebi var: aynı adla ikinci kez
   * yükleyince öncekinin üzerine yazılmıyor, ve içerik değişmediği için
   * uzun süreli önbellek güvenle verilebiliyor (bkz. functions/media/).
   */
  const rastgele = crypto.randomUUID().slice(0, 8);
  const anahtar = `afis/${slugla(dosya.name || 'afis')}-${rastgele}.${uzanti}`;

  await env.MEDYA.put(anahtar, veri, {
    httpMetadata: {
      contentType: tur,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: { yukleyen: admin, tarih: new Date().toISOString() },
  });

  // Site içi yol dönüyoruz: etkinlik kaydındaki posterUrl doğrulaması zaten
  // yalnızca "/" ile başlayan yolları kabul ediyor.
  return new Response(JSON.stringify({ url: `/media/${anahtar}` }), { status: 200, headers });
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, 'POST, OPTIONS');
};
