/**
 * Etkinliklerin tarayıcıda hidrasyonu.
 *
 * Site statik build alıyor; etkinlikler ise artık KV'de ve panelden yönetiliyor.
 * Bu yüzden bölümler build sırasında JSON'dan render edilir (SEO + JS kapalıyken
 * çalışsın diye), sayfa açılınca burası /api/events'ten gelen güncel listeyle
 * üzerine yazar. API boş dönerse veya hata olursa statik içerik olduğu gibi kalır.
 *
 * Durum ve disiplin mantığı import edilir, burada tekrarlanmaz.
 */

import {
  deriveStatus, sortForDisplay, STATUS_CLASS, formatEventDate,
  participantsText, fillPercent, type EventStatus,
} from '../utils/events';
import { disciplineLabel } from '../i18n/disciplines';

export interface ApiEvent {
  id: string;
  type: string;
  title: Record<string, string>;
  description: Record<string, string>;
  dateStart: string;
  dateEnd: string;
  timeStart?: string;
  timeEnd?: string;
  /** Saat dilimi belirtilmiş tam an — gösterim bunun üzerinden yapılır. */
  startsAt?: string;
  endsAt?: string;
  disciplines: string[];
  maxParticipants: number;
  registrationOpen: boolean;
  platform?: string;
  location?: Record<string, string>;
}

export interface EventLabels {
  lang: string;
  status: Record<EventStatus, string>;
  type: Record<string, string>;
  participants: string;
  register: string;
}

/**
 * Bölümlerin gömdüğü etiket bloğunu üretir. Workshops.astro ve Calendar.astro
 * bunu aynı şekilde kuruyordu; iki kopya olunca yeni bir tür/durum eklendiğinde
 * biri güncellenmeyip aynı etkinlik iki bölümde farklı görünüyordu.
 */
export function buildEventLabels(lang: string, t: (k: any) => string): EventLabels {
  return {
    lang,
    status: {
      open: t('workshops.status.open'),
      upcoming: t('workshops.status.upcoming'),
      ongoing: t('workshops.status.ongoing'),
      completed: t('workshops.status.completed'),
    },
    type: {
      workshop: t('calendar.type.workshop'),
      seminar: t('calendar.type.seminar'),
      colloquium: t('calendar.type.colloquium'),
      course: t('calendar.type.course'),
      congress: t('calendar.type.congress'),
    },
    participants: t('workshops.participants'),
    register: t('workshops.register'),
  };
}

interface ApiPayload {
  events: ApiEvent[];
  counts: Record<string, number>;
}

let cached: Promise<ApiPayload | null> | null = null;

/** Tek fetch, iki bölüm paylaşır. */
export function fetchEvents(): Promise<ApiPayload | null> {
  if (!cached) {
    cached = fetch('/api/events')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && Array.isArray(d.events) ? (d as ApiPayload) : null))
      .catch(() => null);
  }
  return cached;
}

export function readLabels(id: string): EventLabels | null {
  const node = document.getElementById(id);
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as EventLabels;
  } catch {
    return null;
  }
}

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  // textContent kullanılıyor: etkinlik metinleri panelden geliyor, innerHTML yok.
  if (text != null) n.textContent = text;
  return n;
}

/**
 * "2 Ağustos 2026 · 21:00–21:55 GMT+3" — saat ZİYARETÇİNİN saat diliminde.
 *
 * Etkinlik saatleri Türkiye saatiyle girilir ama `startsAt` içinde ofsetiyle
 * saklanır; burada tarayıcının yerel saatine çevrilir. Almanya'daki bir
 * katılımcı 20:00 görür ve yanlış saate uyanmaz. Saat dilimi kısaltması da
 * yazılır ki hangi saat olduğu tartışmaya açık kalmasın.
 */
function whenText(ev: ApiEvent, lang: string, long = false): string {
  const loc = lang === 'tr' ? 'tr-TR' : 'en-US';
  const f = (iso: string, l: string) => formatEventDate(iso, l, long);
  const multiDay = ev.dateEnd && ev.dateEnd !== ev.dateStart;

  if (!multiDay && ev.startsAt) {
    const start = new Date(ev.startsAt);
    if (!Number.isNaN(start.getTime())) {
      // Yerel saate çevrildiğinde tarih de kayabilir (ör. 23:30 TR = ertesi gün
      // bazı dilimlerde), o yüzden tarihi de bu andan okuyoruz.
      const dateStr = start.toLocaleDateString(loc, {
        day: 'numeric',
        month: long ? 'long' : 'short',
        year: 'numeric',
      });
      const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
      let timeStr = start.toLocaleTimeString(loc, { ...timeOpts, timeZoneName: 'short' });
      if (ev.endsAt) {
        const end = new Date(ev.endsAt);
        if (!Number.isNaN(end.getTime())) {
          timeStr = `${start.toLocaleTimeString(loc, timeOpts)}–${end.toLocaleTimeString(loc, { ...timeOpts, timeZoneName: 'short' })}`;
        }
      }
      return `${dateStr} · ${timeStr}`;
    }
  }

  let out = multiDay ? `${f(ev.dateStart, lang)} — ${f(ev.dateEnd, lang)}` : f(ev.dateStart, lang);
  // startsAt yoksa (tüm gün süren etkinlik) ham saat varsa onu göster.
  if (!multiDay && ev.timeStart) {
    out += ` · ${ev.timeStart}${ev.timeEnd ? `–${ev.timeEnd}` : ''}`;
  }
  return out;
}

// ── Atölye kartları ──

function workshopCard(ev: ApiEvent, count: number, L: EventLabels): HTMLElement {
  const lang = L.lang;
  const status = deriveStatus(ev);

  const card = h('div', 'glass p-6 flex flex-col gap-4 min-w-[300px] md:min-w-[350px] hover:gold-glow transition-all duration-300');

  const header = h('div', 'flex items-start justify-between gap-3');
  header.appendChild(h('h3', 'text-lg font-heading font-bold text-text-primary', ev.title?.[lang] ?? ev.id));
  header.appendChild(h('span', `badge shrink-0 ${STATUS_CLASS[status]}`, L.status[status]));
  card.appendChild(header);

  const dateRow = h('div', 'flex items-center gap-2 text-text-secondary text-sm');
  dateRow.appendChild(h('span', undefined, whenText(ev, lang)));
  card.appendChild(dateRow);

  const desc = ev.description?.[lang];
  if (desc) card.appendChild(h('p', 'text-text-secondary text-sm leading-relaxed', desc));

  if (ev.disciplines?.length) {
    const tags = h('div', 'flex flex-wrap gap-2');
    ev.disciplines.forEach((d) => {
      tags.appendChild(h('span', 'badge badge-discipline text-xs', disciplineLabel(d, lang)));
    });
    card.appendChild(tags);
  }

  // Katılımcı çubuğu — sayı KV'den gelen gerçek başvuru sayısı.
  const barWrap = h('div');
  const barTop = h('div', 'flex justify-between text-xs text-text-secondary mb-1.5');
  barTop.appendChild(h('span', undefined, L.participants));
  barTop.appendChild(h('span', 'font-mono', participantsText(count, ev.maxParticipants)));
  barWrap.appendChild(barTop);

  const track = h('div', 'w-full h-1.5 bg-white/5 rounded-full overflow-hidden');
  const fill = h('div', 'h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-all duration-500');
  fill.style.width = `${fillPercent(count, ev.maxParticipants)}%`;
  track.appendChild(fill);
  barWrap.appendChild(track);
  card.appendChild(barWrap);

  if (status === 'open') {
    const btn = h('button', 'btn-gold text-center justify-center text-sm mt-auto cursor-pointer', L.register);
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', `${L.register} - ${ev.title?.[lang] ?? ev.id}`);
    btn.addEventListener('click', () => {
      const open = (window as any).openRegistration;
      if (typeof open === 'function') open(ev.title?.[lang] ?? ev.id, ev.id);
    });
    card.appendChild(btn);
  } else if (status === 'upcoming') {
    card.appendChild(h('div', 'btn-outline text-center justify-center text-sm mt-auto cursor-default opacity-70', L.status.upcoming));
  }

  return card;
}

/** #workshops-grid içeriğini API'den gelen atölyelerle değiştirir. */
export async function hydrateWorkshops(gridId: string, labelsId: string): Promise<void> {
  const grid = document.getElementById(gridId);
  const L = readLabels(labelsId);
  if (!grid || !L) return;

  const data = await fetchEvents();
  if (!data || !data.events.length) return;

  const workshops = sortForDisplay(data.events.filter((e) => e.type === 'workshop'));
  if (!workshops.length) return;

  grid.replaceChildren(
    ...workshops.map((ev) => {
      const cell = h('div', 'snap-start shrink-0 w-[85vw] md:w-auto');
      cell.appendChild(workshopCard(ev, Number(data.counts[ev.id] ?? 0), L));
      return cell;
    }),
  );
}

// ── Takvim zaman çizelgesi ──

function timelineItem(ev: ApiEvent, i: number, L: EventLabels): HTMLElement {
  const lang = L.lang;
  const status = deriveStatus(ev);
  const past = status === 'completed';
  const even = i % 2 === 0;

  const row = h('div', `relative flex items-start gap-6 md:gap-0 ${past ? 'opacity-50' : ''}`);

  const dot = h('div', `absolute left-4 md:left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 z-10 mt-6 ${past ? 'border-text-secondary bg-bg-primary' : 'border-gold-500 bg-gold-500/30'}`);
  if (!past) dot.appendChild(h('div', 'absolute inset-0 rounded-full bg-gold-500/50 animate-ping'));
  row.appendChild(dot);

  const card = h('div', `ml-10 md:ml-0 md:w-[calc(50%-2rem)] glass p-5 ${even ? 'md:mr-auto md:pr-8' : 'md:ml-auto md:pl-8'}`);

  const badges = h('div', 'flex items-center gap-2 mb-2 flex-wrap');
  badges.appendChild(h('span', 'badge text-xs badge-discipline', L.type[ev.type] ?? ev.type));
  badges.appendChild(h('span', `badge text-xs ${STATUS_CLASS[status]}`, L.status[status]));
  card.appendChild(badges);

  card.appendChild(h('h3', 'text-lg font-heading font-bold text-text-primary mb-1', ev.title?.[lang] ?? ev.id));

  card.appendChild(h('p', 'text-gold-500/80 text-sm font-mono mb-2', whenText(ev, lang, true)));

  const desc = ev.description?.[lang];
  if (desc) card.appendChild(h('p', 'text-text-secondary text-sm mb-2', desc));

  const meta = h('div', 'flex items-center gap-3 flex-wrap');
  const loc = ev.location?.[lang];
  if (loc) meta.appendChild(h('p', 'text-text-secondary/60 text-xs', `📍 ${loc}`));
  if (ev.platform) {
    meta.appendChild(h('span', 'text-[10px] font-mono text-text-secondary/60 tracking-wide', ev.platform));
  }
  if (meta.childElementCount) card.appendChild(meta);

  /*
   * Kayıt butonu takvimde de olmalı. Atölye ızgarası yalnızca type==='workshop'
   * gösterdiği için seminer/kolokyum/ders "Kayıt Açık" rozetiyle görünüyor ama
   * kaydolunacak yer yoktu — açık seminerde bile bağlantıyı e-postayla
   * gönderebilmek için kaydın alınması gerekiyor.
   */
  if (deriveStatus(ev) === 'open') {
    const btn = h('button', 'btn-gold justify-center text-xs mt-4 w-full sm:w-auto cursor-pointer', L.register);
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', `${L.register} — ${ev.title?.[lang] ?? ev.id}`);
    btn.addEventListener('click', () => {
      const open = (window as any).openRegistration;
      if (typeof open === 'function') open(ev.title?.[lang] ?? ev.id, ev.id);
    });
    card.appendChild(btn);
  }

  row.appendChild(card);
  return row;
}

/** #calendar-timeline içeriğini API'den gelen etkinliklerle değiştirir. */
export async function hydrateCalendar(listId: string, labelsId: string): Promise<void> {
  const list = document.getElementById(listId);
  const L = readLabels(labelsId);
  if (!list || !L) return;

  const data = await fetchEvents();
  if (!data || !data.events.length) return;

  const ordered = sortForDisplay(data.events);
  list.replaceChildren(...ordered.map((ev, i) => timelineItem(ev, i, L)));
}
