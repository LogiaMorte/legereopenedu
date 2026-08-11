/**
 * Cloudflare Pages Function — Etkinlik Yönetimi (atölye / seminer / ders / kolokyum / kongre)
 *
 *   GET  /api/events   → herkese açık: etkinlik listesi + GERÇEK başvuru sayıları
 *   POST /api/events   → yalnızca admin: oluştur / güncelle / sil / içe aktar
 *
 * Tek bir "etkinlik" kavramı var; atölye ile seminer arasındaki fark `type`
 * alanında. Böylece takvim, atölye bölümü ve kayıt akışı aynı kaynaktan beslenir.
 *
 * Etkinlikler KV'de `config:events` anahtarında tutulur — eskiden
 * src/data/workshops.json + events.json içindeydi ve her yeni etkinlik için
 * kod değişikliği + commit + deploy gerekiyordu. Artık panelden açılır.
 *
 * Başvuru sayıları `index:{eventId}` anahtarlarından okunur (kayıt akışı orayı
 * yazar), yani sayaçlar elle güncellenen bir alan değil.
 *
 * KV Binding: REGISTRATIONS
 * Env: ADMIN_EMAILS
 */

import { corsHeaders, optionsResponse, parseJsonBody, verifyAdmin } from '../_shared';

interface Env {
  REGISTRATIONS: KVNamespace;
  ADMIN_EMAILS?: string;
}

const EVENTS_KEY = 'config:events';

export const EVENT_TYPES = ['workshop', 'seminar', 'colloquium', 'course', 'congress'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface LegereEvent {
  id: string;
  type: EventType;
  title: { tr: string; en: string };
  description: { tr: string; en: string };
  dateStart: string;
  dateEnd: string;
  /** 'HH:MM' Türkiye saatiyle — panelde girilen ham değer, forma geri doldurmak için. */
  timeStart?: string;
  timeEnd?: string;
  /**
   * Saat dilimi belirtilmiş tam an (ör. '2026-08-02T21:00:00+03:00').
   * Gösterim bunun üzerinden yapılır: tarayıcı bunu ziyaretçinin kendi saat
   * dilimine çevirir, böylece yurt dışındaki katılımcı yanlış saate uyanmaz.
   */
  startsAt?: string;
  endsAt?: string;
  disciplines: string[];
  /** 0 = kontenjan sınırsız / gösterilmiyor (ör. halka açık seminer) */
  maxParticipants: number;
  /**
   * Tamamlanmış etkinliğin GERÇEK katılımcı sayısı.
   *
   * Site üzerinden kayıt almamış etkinlikler (site açılmadan önce yapılanlar)
   * KV'de sıfır başvuruyla görünüyor ve arşivde "0/50" olarak çıkıyordu —
   * "kimse gelmemiş" algısı yaratıyordu. Bu alan yalnızca tamamlanmış
   * etkinliklerde, gerçekte kaç kişi katıldıysa onu göstermek için.
   * Boş bırakılırsa katılımcı satırı hiç gösterilmez (0 yazmaktan iyidir).
   */
  attendees?: number;
  /** Elle kontrol edilen TEK zamansal olmayan alan: başvuru alıyor muyuz. */
  registrationOpen: boolean;
  /**
   * Kayıt site dışında toplanıyorsa formun adresi (ör. Google Form).
   *
   * Doluysa kart sitenin kayıt modalını açmaz ve /api/register bu etkinliğe
   * başvuru KABUL ETMEZ: kayıtların yarısı KV'de yarısı formda olursa kimin
   * geleceği bilinemez. Tek doğruluk kaynağı dış form olur.
   */
  registrationUrl?: string;
  platform?: string;
  location?: { tr: string; en: string };
}

export async function readEvents(kv: KVNamespace): Promise<LegereEvent[]> {
  const raw = await kv.get(EVENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** index:{id} uzunluklarından gerçek başvuru sayıları. */
export async function findEvent(kv: KVNamespace, id: string): Promise<LegereEvent | null> {
  return (await readEvents(kv)).find((e) => e.id === id) ?? null;
}

async function readCounts(kv: KVNamespace, ids: string[]): Promise<Record<string, number>> {
  const raws = await Promise.all(ids.map((id) => kv.get(`index:${id}`)));
  const counts: Record<string, number> = {};
  ids.forEach((id, i) => {
    let n = 0;
    const raw = raws[i];
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) n = arr.length;
      } catch {
        /* bozuk index -> 0 say, isteği düşürme */
      }
    }
    counts[id] = n;
  });
  return counts;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Panelde girilen saatler Türkiye saatidir. Türkiye kalıcı UTC+3 (yaz saati yok). */
const TR_OFFSET = '+03:00';

function badRequest(message: string, headers: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), { status: 400, headers });
}

/** Panelden gelen ham veriyi temizler. Hata dönerse kayıt yapılmaz. */
function sanitize(input: any): { ok: true; value: LegereEvent } | { ok: false; error: string } {
  const text = (v: any, max: number) => String(v ?? '').trim().slice(0, max);

  const id = text(input?.id, 64).toLowerCase();
  if (!SLUG_RE.test(id)) {
    return { ok: false, error: 'Geçersiz id: yalnızca küçük harf, rakam ve tire (3-64 karakter).' };
  }

  const type = text(input?.type, 20) as EventType;
  if (!EVENT_TYPES.includes(type)) {
    return { ok: false, error: `Geçersiz tür. Seçenekler: ${EVENT_TYPES.join(', ')}` };
  }

  const titleTr = text(input?.title?.tr, 200);
  const titleEn = text(input?.title?.en, 200);
  if (!titleTr || !titleEn) return { ok: false, error: 'Başlık hem TR hem EN için zorunlu.' };

  const dateStart = text(input?.dateStart, 10);
  const dateEnd = text(input?.dateEnd, 10) || dateStart;
  if (!DATE_RE.test(dateStart) || !DATE_RE.test(dateEnd)) {
    return { ok: false, error: 'Tarihler YYYY-AA-GG biçiminde olmalı.' };
  }
  if (dateEnd < dateStart) return { ok: false, error: 'Bitiş tarihi başlangıçtan önce olamaz.' };

  // Saat isteğe bağlı: boş bırakılırsa etkinlik tüm gün sayılır.
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const timeStart = text(input?.timeStart, 5);
  const timeEnd = text(input?.timeEnd, 5);
  if (timeStart && !TIME_RE.test(timeStart)) return { ok: false, error: 'Başlangıç saati SS:DD biçiminde olmalı.' };
  if (timeEnd && !TIME_RE.test(timeEnd)) return { ok: false, error: 'Bitiş saati SS:DD biçiminde olmalı.' };
  if (timeEnd && !timeStart) return { ok: false, error: 'Bitiş saati verildiyse başlangıç saati de gerekli.' };
  if (timeStart && timeEnd && dateStart === dateEnd && timeEnd <= timeStart) {
    return { ok: false, error: 'Aynı gün içinde bitiş saati başlangıçtan sonra olmalı.' };
  }

  const maxRaw = input?.maxParticipants;
  const maxParticipants = maxRaw === '' || maxRaw == null ? 0 : Number(maxRaw);
  if (!Number.isInteger(maxParticipants) || maxParticipants < 0 || maxParticipants > 100000) {
    return { ok: false, error: 'Kontenjan 0 (sınırsız) ile 100000 arasında bir tam sayı olmalı.' };
  }

  // Tamamlanmış etkinlikler için elle girilen gerçek katılımcı sayısı.
  const attRaw = input?.attendees;
  const attendees = attRaw === '' || attRaw == null ? undefined : Number(attRaw);
  if (attendees !== undefined && (!Number.isInteger(attendees) || attendees < 0 || attendees > 100000)) {
    return { ok: false, error: 'Katılımcı sayısı 0 ile 100000 arasında bir tam sayı olmalı.' };
  }

  const disciplines = Array.isArray(input?.disciplines)
    ? input.disciplines.map((d: any) => text(d, 40)).filter(Boolean).slice(0, 12)
    : [];

  const locTr = text(input?.location?.tr, 200);
  const locEn = text(input?.location?.en, 200);

  // Dış kayıt adresi: yalnızca http(s). Aksi hâlde panele yazılan bir
  // `javascript:` adresi karta bağlantı olarak basılırdı.
  const rawRegUrl = text(input?.registrationUrl, 500);
  let registrationUrl: string | undefined;
  if (rawRegUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(rawRegUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      return { ok: false, error: 'Kayıt bağlantısı http(s) ile başlayan geçerli bir adres olmalı.' };
    }
    registrationUrl = parsed.toString();
  }

  return {
    ok: true,
    value: {
      id,
      type,
      title: { tr: titleTr, en: titleEn },
      description: {
        tr: text(input?.description?.tr, 2000),
        en: text(input?.description?.en, 2000),
      },
      dateStart,
      dateEnd,
      timeStart: timeStart || undefined,
      timeEnd: timeEnd || undefined,
      // Türkiye 2016'dan beri yaz saati uygulamıyor, kalıcı UTC+3 — sabit ofset
      // güvenli. Başka bir saat diliminde etkinlik yapılacaksa burası değişmeli.
      startsAt: timeStart ? `${dateStart}T${timeStart}:00${TR_OFFSET}` : undefined,
      endsAt: timeEnd ? `${dateEnd}T${timeEnd}:00${TR_OFFSET}` : undefined,
      disciplines,
      maxParticipants,
      attendees,
      registrationOpen: input?.registrationOpen === true,
      registrationUrl,
      platform: text(input?.platform, 40) || undefined,
      location: locTr || locEn ? { tr: locTr, en: locEn } : undefined,
    },
  };
}

// ── Herkese açık okuma ──

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = {
    ...corsHeaders(request, 'GET, OPTIONS'),
    // Kısa cache: panelden yapılan değişiklik en geç 1 dakikada görünür.
    'Cache-Control': 'public, max-age=60',
  };

  try {
    if (!env.REGISTRATIONS) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
    }
    const events = await readEvents(env.REGISTRATIONS);
    // Sayaç yalnızca kontenjanlı etkinlikte gösteriliyor; sınırsız olanlar için
    // KV okumak boşuna round-trip.
    const counts = await readCounts(
      env.REGISTRATIONS,
      events.filter((e) => e.maxParticipants > 0).map((e) => e.id),
    );
    return new Response(JSON.stringify({ events, counts }), { status: 200, headers });
  } catch (err) {
    console.error('[events] GET error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

// ── Admin yazma ──

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const headers = corsHeaders(request);

  try {
    if (!env.REGISTRATIONS) {
      return new Response(JSON.stringify({ error: 'KV not configured' }), { status: 500, headers });
    }

    const admin = await verifyAdmin(request, env.REGISTRATIONS, env.ADMIN_EMAILS);
    if (!admin) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    const body = await parseJsonBody<{ action?: string; event?: any; events?: any[]; id?: string }>(request);
    if (!body?.action) return badRequest('Missing action', headers);

    const current = await readEvents(env.REGISTRATIONS);

    if (body.action === 'save') {
      const result = sanitize(body.event);
      if (!result.ok) return badRequest(result.error, headers);

      const next = [...current];
      const at = next.findIndex((e) => e.id === result.value.id);
      if (at >= 0) next[at] = result.value;
      else next.push(result.value);

      await env.REGISTRATIONS.put(EVENTS_KEY, JSON.stringify(next));
      // Etkinlik kaydetmek başvuru sayılarını değiştirmez — istemcideki sayaç
      // önbelleği hâlâ geçerli, N adet KV okumasına gerek yok.
      return new Response(JSON.stringify({ success: true, events: next }), { status: 200, headers });
    }

    if (body.action === 'delete') {
      const id = String(body.id ?? '').trim().toLowerCase();
      if (!id) return badRequest('Missing id', headers);

      // Başvuru almış etkinlik silinmez — kayıtlar sahipsiz kalırdı.
      const counts = await readCounts(env.REGISTRATIONS, [id]);
      if (counts[id] > 0) {
        return new Response(
          JSON.stringify({
            error: `Bu etkinlikte ${counts[id]} başvuru var, silinemez. Bunun yerine kaydı kapatabilirsiniz.`,
          }),
          { status: 409, headers },
        );
      }

      const next = current.filter((e) => e.id !== id);
      await env.REGISTRATIONS.put(EVENTS_KEY, JSON.stringify(next));
      return new Response(JSON.stringify({ success: true, events: next }), { status: 200, headers });
    }

    // Mevcut JSON dosyalarını KV'ye bir kereliğine taşımak için.
    if (body.action === 'seed') {
      if (current.length > 0) {
        return new Response(
          JSON.stringify({ error: 'KV zaten dolu. İçe aktarma yalnızca liste boşken çalışır.' }),
          { status: 409, headers },
        );
      }
      if (!Array.isArray(body.events)) return badRequest('events dizisi gerekli', headers);

      const seeded: LegereEvent[] = [];
      for (const raw of body.events.slice(0, 200)) {
        const result = sanitize(raw);
        if (!result.ok) return badRequest(`İçe aktarma hatası (${raw?.id ?? '?'}): ${result.error}`, headers);
        seeded.push(result.value);
      }
      await env.REGISTRATIONS.put(EVENTS_KEY, JSON.stringify(seeded));
      // Tohumlama yalnızca liste boşken çalışır, dolayısıyla tüm sayaçlar 0.
      return new Response(JSON.stringify({ success: true, events: seeded }), { status: 200, headers });
    }

    return badRequest('Unknown action', headers);
  } catch (err) {
    console.error('[events] POST error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction = async (context) => {
  return optionsResponse(context.request, 'GET, POST, OPTIONS');
};
