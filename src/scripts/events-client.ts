/**
 * Etkinlik bölümünün istemci tarafı.
 *
 * Site statik build alıyor; etkinlikler KV'de ve panelden yönetiliyor. Bu modül
 * kabuğu (Events.astro) /api/events'ten gelen listeyle doldurur.
 *
 * Üç durum: iskelet (istek sürerken) → kart ızgarası veya boş durum.
 * Boş durum İSTİSNA DEĞİL, bugünün normal hâli — o yüzden "Yakında" yazan bir
 * kutu değil, tasarlanmış bir ekran.
 *
 * Durum (Kayıt Açık / Yakında / Devam Ediyor / Tamamlandı) src/utils/events.ts
 * ile TARİHTEN türetilir; burada yeniden hesaplanmaz.
 */

import {
  deriveStatus,
  sortForDisplay,
  formatEventDate,
  type EventStatus,
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
  /** Tamamlanmış etkinliğin panelden girilen gerçek katılımcı sayısı. */
  attendees?: number;
  registrationOpen: boolean;
  platform?: string;
  location?: Record<string, string>;
}

export interface EventLabels {
  lang: string;
  status: Record<EventStatus, string>;
  type: Record<string, string>;
  cta: Record<EventStatus, string>;
  seats: string;
  attendees: string;
  full: string;
  feedLive: string;
  feedOffline: string;
  empty: {
    kicker: string;
    title: string;
    body: string;
    nextCall: string;
    pastCount: string;
    cta1: string;
    cta2: string;
    pastTitle: string;
    pastBody: string;
  };
  signupPath: string;
}

/** Bölümlerin gömdüğü etiket bloğunu üretir (build sırasında çağrılır). */
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
    cta: {
      open: t('lp.card.ctaOpen'),
      upcoming: t('lp.card.ctaUpcoming'),
      ongoing: t('lp.card.ctaOngoing'),
      completed: t('lp.card.ctaClosed'),
    },
    seats: t('lp.card.seats'),
    attendees: t('lp.card.attendees'),
    full: t('lp.card.full'),
    feedLive: t('lp.events.feedLive'),
    feedOffline: t('lp.events.feedOffline'),
    empty: {
      kicker: t('lp.empty.kicker'),
      title: t('lp.empty.title'),
      body: t('lp.empty.body'),
      nextCall: t('lp.empty.nextCall'),
      pastCount: t('lp.empty.pastCount'),
      cta1: t('lp.empty.cta1'),
      cta2: t('lp.empty.cta2'),
      pastTitle: t('lp.empty.pastTitle'),
      pastBody: t('lp.empty.pastBody'),
    },
    signupPath: lang === 'en' ? '/en/signup' : '/signup',
  };
}

interface ApiPayload {
  events: ApiEvent[];
  counts: Record<string, number>;
}

/** Durum → renk. Kart kenarı, rozet ve doluluk çubuğu bunu paylaşır. */
const STATUS_COLOR: Record<EventStatus, { fg: string; bg: string; border: string }> = {
  open: { fg: '#4ADE80', bg: 'rgba(74,222,128,0.13)', border: 'rgba(74,222,128,0.3)' },
  upcoming: { fg: '#60A5FA', bg: 'rgba(96,165,250,0.13)', border: 'rgba(96,165,250,0.3)' },
  ongoing: { fg: '#D4A843', bg: 'rgba(212,168,67,0.13)', border: 'rgba(212,168,67,0.32)' },
  completed: { fg: '#F87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.24)' },
};

function h(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  // textContent: etkinlik metinleri panelden geliyor, innerHTML kullanılmaz.
  if (text != null) n.textContent = text;
  return n;
}

/**
 * "2 Ağustos 2026 · 21:00–21:55 GMT+3" — saat ZİYARETÇİNİN diliminde.
 * Saatler Türkiye saatiyle girilip ofsetiyle saklanır; burada çevrilir.
 */
function whenText(ev: ApiEvent, lang: string): string {
  const loc = lang === 'en' ? 'en-US' : 'tr-TR';
  const multiDay = ev.dateEnd && ev.dateEnd !== ev.dateStart;

  if (!multiDay && ev.startsAt) {
    const start = new Date(ev.startsAt);
    if (!Number.isNaN(start.getTime())) {
      const dateStr = start.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' });
      const o: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
      let timeStr = start.toLocaleTimeString(loc, { ...o, timeZoneName: 'short' });
      if (ev.endsAt) {
        const end = new Date(ev.endsAt);
        if (!Number.isNaN(end.getTime())) {
          timeStr = `${start.toLocaleTimeString(loc, o)}–${end.toLocaleTimeString(loc, { ...o, timeZoneName: 'short' })}`;
        }
      }
      return `${dateStr} · ${timeStr}`;
    }
  }

  let out = multiDay
    ? `${formatEventDate(ev.dateStart, lang)} — ${formatEventDate(ev.dateEnd, lang)}`
    : formatEventDate(ev.dateStart, lang);
  if (!multiDay && ev.timeStart) {
    out += ` · ${ev.timeStart}${ev.timeEnd ? `–${ev.timeEnd}` : ''}`;
  }
  return out;
}

// ── Kart ──

function card(ev: ApiEvent, count: number, L: EventLabels): HTMLElement {
  const lang = L.lang;
  const status = deriveStatus(ev);
  const color = STATUS_COLOR[status];
  const isDone = status === 'completed';

  const el = h('article', `lg-card${isDone ? ' is-done' : ''}`);

  const top = h('div', 'lg-card__top');
  top.appendChild(h('span', 'lg-card__type', L.type[ev.type] ?? ev.type));
  const badge = h('span', 'lg-card__status');
  badge.style.color = color.fg;
  badge.style.background = color.bg;
  badge.style.borderColor = color.border;
  const badgeDot = h('span', 'lg-card__statusDot');
  badgeDot.style.background = color.fg;
  badge.appendChild(badgeDot);
  badge.appendChild(document.createTextNode(L.status[status]));
  top.appendChild(badge);
  el.appendChild(top);

  el.appendChild(h('h3', 'lg-card__title', ev.title?.[lang] ?? ev.id));
  el.appendChild(h('div', 'lg-card__date', whenText(ev, lang)));

  const desc = ev.description?.[lang];
  if (desc) el.appendChild(h('p', 'lg-card__body', desc));

  if (ev.disciplines?.length) {
    const tags = h('div', 'lg-card__tags');
    ev.disciplines.forEach((d) => tags.appendChild(h('span', 'lg-card__tag', disciplineLabel(d, lang))));
    el.appendChild(tags);
  }

  const foot = h('div', 'lg-card__foot');

  /*
   * Katılımcı/kontenjan sayısı ZİYARETÇİYE GÖSTERİLMEZ.
   *
   * Gerekçe (kurucu kararı): sayı kimseye bir şey anlatmıyor ama çok şey ima
   * ediyor. Yeni bir oluşumda "3/50" caydırıcı, geçmiş etkinlikte "0/50"
   * ise "kimse gelmemiş" gibi okunuyor. Sayıyı kaldırmak hem bu algıyı hem de
   * rakamı şişirme ihtimalini birden ortadan kaldırıyor. Gerçek sayılar
   * admin panelinde duruyor.
   *
   * TEK istisna: kontenjanı dolmuş açık etkinlik. Bunu göstermezsek ziyaretçi
   * "Kayıt Ol"a basıp sunucudan 409 yiyor — bilgi değil, çıkmaz sokak olurdu.
   */
  const capacity = ev.maxParticipants;
  const isFull = status === 'open' && capacity > 0 && count >= capacity;
  if (isFull) {
    foot.appendChild(h('div', 'lg-card__full', L.full));
  }

  const actions = h('div', 'lg-card__actions');
  actions.appendChild(h('span', 'lg-card__platform', ev.platform ?? ''));

  const cta = h('button', `lg-card__cta${status === 'open' && !isFull ? ' is-solid' : ''}`, L.cta[status]);
  cta.setAttribute('type', 'button');
  cta.setAttribute('aria-label', `${L.cta[status]} — ${ev.title?.[lang] ?? ev.id}`);
  if (isFull) {
    // Dolu: kayıt akışına sokmanın anlamı yok, sunucu zaten reddeder.
    (cta as HTMLButtonElement).disabled = true;
    cta.classList.add('is-disabled');
  } else if (status === 'open') {
    cta.addEventListener('click', () => {
      const open = (window as any).openRegistration;
      if (typeof open === 'function') open(ev.title?.[lang] ?? ev.id, ev.id);
    });
  } else {
    // Kayıt alınmayan durumlarda tek anlamlı eylem topluluğa katılmak
    cta.addEventListener('click', () => {
      location.href = L.signupPath;
    });
  }
  actions.appendChild(cta);
  foot.appendChild(actions);

  el.appendChild(foot);
  return el;
}

// ── Boş durum ──

function emptyState(L: EventLabels, tab: 'upcoming' | 'past', pastCount: number, onShowPast: () => void): HTMLElement {
  const box = h('div', 'lg-empty');

  const mark = h('div', 'lg-empty__mark');
  // innerHTML burada güvenli: tamamen sabit SVG, hiçbir veri enterpolasyonu yok.
  // Dosyanın geri kalanı metin için bilinçli olarak textContent kullanır.
  mark.innerHTML = `
    <svg width="112" height="112" viewBox="0 0 64 64" fill="none" class="lg-empty__breathe" aria-hidden="true">
      <path d="M32 4L56 18V46L32 60L8 46V18L32 4Z" stroke="rgba(212,168,67,0.34)" stroke-width="1.2" fill="rgba(212,168,67,0.04)"/>
    </svg>
    <svg width="112" height="112" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M32 4L56 18V46L32 60L8 46V18L32 4Z" stroke="#FFD54F" stroke-width="1.6" stroke-dasharray="15 170" class="lg-empty__dash"/>
    </svg>
    <svg width="46" height="46" viewBox="0 0 64 64" fill="none" class="lg-empty__l" aria-hidden="true">
      <path d="M24 18V46H42" stroke="#D4A843" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
  box.appendChild(mark);

  const mid = h('div');
  if (tab === 'past') {
    mid.appendChild(h('div', 'lg-empty__kicker', L.empty.kicker));
    mid.appendChild(h('h3', 'lg-empty__title', L.empty.pastTitle));
    mid.appendChild(h('p', 'lg-empty__body', L.empty.pastBody));
  } else {
    mid.appendChild(h('div', 'lg-empty__kicker', L.empty.kicker));
    mid.appendChild(h('h3', 'lg-empty__title', L.empty.title));
    mid.appendChild(h('p', 'lg-empty__body', L.empty.body));
    const meta = h('div', 'lg-empty__meta');
    meta.appendChild(h('span', undefined, L.empty.nextCall));
    meta.appendChild(h('span', 'lg-empty__sep', '/'));
    meta.appendChild(h('span', undefined, `${L.empty.pastCount} · ${pastCount}`));
    mid.appendChild(meta);
  }
  box.appendChild(mid);

  const actions = h('div', 'lg-empty__actions');
  const join = h('a', 'lg-btn-gold lg-empty__cta1', L.empty.cta1);
  join.setAttribute('href', L.signupPath);
  actions.appendChild(join);
  if (tab === 'upcoming' && pastCount > 0) {
    const seePast = h('button', 'lg-btn-outline lg-empty__cta2', L.empty.cta2);
    seePast.setAttribute('type', 'button');
    seePast.addEventListener('click', onShowPast);
    actions.appendChild(seePast);
  }
  box.appendChild(actions);

  return box;
}

// ── Ana akış ──

export function initEvents(): void {
  const labelsNode = document.getElementById('lg-ev-labels');
  const skeleton = document.getElementById('lg-ev-skeleton');
  const list = document.getElementById('lg-ev-list');
  const emptyBox = document.getElementById('lg-ev-empty');
  const tabUpcoming = document.getElementById('lg-tab-upcoming');
  const tabPast = document.getElementById('lg-tab-past');
  const feedDot = document.getElementById('lg-feed-dot');
  const feedLabel = document.getElementById('lg-feed-label');
  if (!labelsNode || !skeleton || !list || !emptyBox || !tabUpcoming || !tabPast) return;

  let L: EventLabels;
  try {
    L = JSON.parse(labelsNode.textContent || '{}');
  } catch {
    return;
  }

  let tab: 'upcoming' | 'past' = 'upcoming';
  let upcoming: ApiEvent[] = [];
  let past: ApiEvent[] = [];
  let counts: Record<string, number> = {};

  const setTab = (next: 'upcoming' | 'past') => {
    tab = next;
    tabUpcoming.classList.toggle('is-active', next === 'upcoming');
    tabPast.classList.toggle('is-active', next === 'past');
    tabUpcoming.setAttribute('aria-selected', String(next === 'upcoming'));
    tabPast.setAttribute('aria-selected', String(next === 'past'));
    render();
  };

  function render(): void {
    const items = tab === 'upcoming' ? upcoming : past;
    list!.replaceChildren();
    emptyBox!.replaceChildren();

    if (items.length === 0) {
      list!.hidden = true;
      emptyBox!.hidden = false;
      emptyBox!.appendChild(emptyState(L, tab, past.length, () => setTab('past')));
      return;
    }

    emptyBox!.hidden = true;
    list!.hidden = false;
    items.forEach((ev) => list!.appendChild(card(ev, Number(counts[ev.id] ?? 0), L)));
  }

  const finish = (ok: boolean) => {
    skeleton.hidden = true;
    skeleton.remove();
    if (feedDot) feedDot.className = `lg-ev__feedDot${ok ? '' : ' is-error'}`;
    if (feedLabel) feedLabel.textContent = ok ? L.feedLive : L.feedOffline;

    document.getElementById('lg-count-upcoming')!.textContent = String(upcoming.length);
    document.getElementById('lg-count-past')!.textContent = String(past.length);
    // About bölümündeki "gerçekleşen etkinlik" istatistiği aynı veriden
    const statPast = document.getElementById('lg-stat-past');
    if (statPast) statPast.textContent = String(past.length);

    render();
    // İçerik belirirken yumuşak giriş (iskelet ani kesilmesin diye)
    list!.classList.add('lg-ev-list--in');
    emptyBox!.classList.add('lg-ev-list--in');
  };

  tabUpcoming.addEventListener('click', () => setTab('upcoming'));
  tabPast.addEventListener('click', () => setTab('past'));

  /*
   * Hata sessiz kalmasın: bu bölüm bir kez canlıda sessizce boş kaldı
   * (Cloudflare kenar önbelleği bu modülün URL'sinde HTML sunuyordu) ve neyin
   * bozulduğunu anlamak uzun sürdü. Artık konsola net bir iz düşüyor.
   */
  fetch('/api/events')
    .then((r) => {
      if (!r.ok) throw new Error(`/api/events HTTP ${r.status}`);
      return r.json();
    })
    .then((d: ApiPayload | null) => {
      if (!d || !Array.isArray(d.events)) throw new Error('/api/events beklenmeyen gövde');
      counts = d.counts || {};
      const all = sortForDisplay(d.events);
      upcoming = all.filter((e) => deriveStatus(e) !== 'completed');
      past = all.filter((e) => deriveStatus(e) === 'completed');
      finish(true);
    })
    .catch((err) => {
      console.error('[events] liste yüklenemedi:', err instanceof Error ? err.message : err);
      finish(false);
    });
}
