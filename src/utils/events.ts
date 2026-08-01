/**
 * Etkinlik durumu — tek kaynak.
 *
 * Durum ARTIK elle yazılmıyor, tarihten türetiliyor. Eskiden workshops.json
 * içindeki "status" alanı elle güncelleniyordu; kimse güncellemeyi unutunca
 * Nisan'da biten atölye aylarca "Kayıt Açık" göründü. Tek elle kontrol edilen
 * şey artık `registrationOpen` — yani "bu etkinliğe başvuru alıyor muyuz".
 * Zaman bilgisi her zaman tarihlerden gelir.
 *
 * Bu modül hem build sırasında (Astro bileşenleri) hem tarayıcıda (Workshops
 * bölümünün hidrasyon script'i) kullanılır; bu yüzden saf ve bağımlılıksızdır.
 */

export type EventStatus = 'open' | 'upcoming' | 'ongoing' | 'completed';

export interface EventLike {
  dateStart?: string;
  dateEnd?: string;
  /** Yalnızca "başvuru alıyor muyuz" bilgisi. Zamanla ilgisi yok. */
  registrationOpen?: boolean;
  /** Geriye dönük uyum: eski kayıtlarda status: 'open' bunu ifade ediyordu. */
  status?: string;
}

/** 'YYYY-MM-DD' -> yerel gün başlangıcı. Geçersizse null. */
function parseDay(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Başvuru alınıyor mu — eski `status: 'open'` biçimini de kabul eder. */
function acceptsRegistration(ev: EventLike): boolean {
  if (typeof ev.registrationOpen === 'boolean') return ev.registrationOpen;
  return ev.status === 'open';
}

/**
 * Görüntülenecek durum.
 * - bitiş tarihi geçtiyse            -> completed  (arşive düşer)
 * - başlangıç geçti, bitiş geçmediyse -> ongoing
 * - henüz başlamadıysa               -> başvuru açıksa 'open', değilse 'upcoming'
 *
 * Tarihler eksik/bozuksa 'upcoming' döner: bilinmeyen bir etkinliği yanlışlıkla
 * "Kayıt Açık" göstermektense sessiz kalmak yeğdir.
 */
export function deriveStatus(ev: EventLike, now: Date = new Date()): EventStatus {
  const start = parseDay(ev.dateStart);
  const end = parseDay(ev.dateEnd) ?? start;
  if (!start || !end) return 'upcoming';

  const today = startOfDay(now).getTime();
  if (today > end.getTime()) return 'completed';
  if (today >= start.getTime()) return 'ongoing';
  return acceptsRegistration(ev) ? 'open' : 'upcoming';
}


/**
 * Etkinlik tarihini yerelleştirir.
 *
 * `T00:00:00` eki kritik: `new Date('2026-08-02')` UTC gece yarısı olarak
 * ayrıştırılır ve UTC'nin batısındaki ziyaretçide bir gün geriye kayar.
 * Build'de bir tarih, hidrasyondan sonra başka bir tarih görünüyordu.
 */
export function formatEventDate(iso: string, lang: string, long = false): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
    day: 'numeric',
    month: long ? 'long' : 'short',
    year: 'numeric',
  });
}

/**
 * Kayıt kabul edilebilir mi — sunucu tarafı kapı.
 * Sadece 'open' durumundaki etkinliklere başvuru alınır: devam eden veya
 * bitmiş bir etkinliğe kayıt, kapasite dolmasa bile reddedilir.
 */
export function canRegister(ev: EventLike, now: Date = new Date()): boolean {
  return deriveStatus(ev, now) === 'open';
}

/** Yaklaşan önce, sonra devam eden, en sonda geçmişler (yeniden eskiye). */
export function sortForDisplay<T extends EventLike>(events: T[], now: Date = new Date()): T[] {
  const rank: Record<EventStatus, number> = { open: 0, ongoing: 1, upcoming: 2, completed: 3 };
  return [...events].sort((a, b) => {
    const ra = rank[deriveStatus(a, now)];
    const rb = rank[deriveStatus(b, now)];
    if (ra !== rb) return ra - rb;
    const da = parseDay(a.dateStart)?.getTime() ?? 0;
    const db = parseDay(b.dateStart)?.getTime() ?? 0;
    // Geçmişler yeniden eskiye, gelecekler yakından uzağa
    return ra === 3 ? db - da : da - db;
  });
}
