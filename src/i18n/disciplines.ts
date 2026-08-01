/**
 * Disiplin verisi — tek kaynak.
 *
 * Hem build sırasında (WorkshopCard, Fields bölümü) hem tarayıcıda (etkinlikler
 * /api/events'ten hidrate edilirken) kullanılır.
 *
 * `code` ve `desc`, one-pager tasarımının "Araştırma Alanları" ızgarası ve
 * hero'daki dikey şerit için eklendi. Sıra anlamlıdır: ızgaradaki 01–12
 * numaralandırması bu dizinin sırasından türetilir.
 */

export interface Discipline {
  /** Etkinlik kayıtlarında kullanılan slug. */
  slug: string;
  /** Üç harfli mono etiket (ızgara ve şeritte). */
  code: string;
  label: { tr: string; en: string };
  desc: { tr: string; en: string };
}

export const disciplines: Discipline[] = [
  {
    slug: 'criminology', code: 'KRM',
    label: { tr: 'Kriminoloji', en: 'Criminology' },
    desc: {
      tr: 'Suç analizi, adli bilişim, ceza politikaları.',
      en: 'Crime analysis, digital forensics, penal policy.',
    },
  },
  {
    slug: 'sociology', code: 'SOS',
    label: { tr: 'Sosyoloji', en: 'Sociology' },
    desc: {
      tr: 'Dijital topluluklar, kolektif davranış, eşitsizlik.',
      en: 'Digital communities, collective behaviour, inequality.',
    },
  },
  {
    slug: 'philosophy', code: 'FLS',
    label: { tr: 'Felsefe', en: 'Philosophy' },
    desc: {
      tr: 'Etik, bilim felsefesi, teknoloji felsefesi.',
      en: 'Ethics, philosophy of science, philosophy of technology.',
    },
  },
  {
    slug: 'data-science', code: 'VRB',
    label: { tr: 'Veri Bilimi', en: 'Data Science' },
    desc: {
      tr: 'Nicel yöntem, veri madenciliği, modelleme.',
      en: 'Quantitative method, data mining, modelling.',
    },
  },
  {
    slug: 'law', code: 'HUK',
    label: { tr: 'Hukuk', en: 'Law' },
    desc: {
      tr: 'Veri hukuku, insan hakları, karşılaştırmalı hukuk.',
      en: 'Data law, human rights, comparative law.',
    },
  },
  {
    slug: 'psychology', code: 'PSK',
    label: { tr: 'Psikoloji', en: 'Psychology' },
    desc: {
      tr: 'Karar süreçleri, adli psikoloji, davranış.',
      en: 'Decision processes, forensic psychology, behaviour.',
    },
  },
  {
    slug: 'anthropology', code: 'ANT',
    label: { tr: 'Antropoloji', en: 'Anthropology' },
    desc: {
      tr: 'Dijital etnografi, kültürel örüntü, saha.',
      en: 'Digital ethnography, cultural patterns, fieldwork.',
    },
  },
  {
    slug: 'political-science', code: 'SYB',
    label: { tr: 'Siyaset Bilimi', en: 'Political Science' },
    desc: {
      tr: 'Yönetişim, kamu politikası, temsil.',
      en: 'Governance, public policy, representation.',
    },
  },
  {
    slug: 'communication', code: 'ILT',
    label: { tr: 'İletişim Bilimleri', en: 'Communication Sciences' },
    desc: {
      tr: 'Medya ekolojisi, enformasyon düzeni, dezenformasyon.',
      en: 'Media ecology, information order, disinformation.',
    },
  },
  {
    slug: 'economics', code: 'EKO',
    label: { tr: 'Ekonomi', en: 'Economics' },
    desc: {
      tr: 'Kurumsal ekonomi, suçun maliyeti, ölçüm.',
      en: 'Institutional economics, cost of crime, measurement.',
    },
  },
  {
    slug: 'ai', code: 'YZK',
    label: { tr: 'Yapay Zekâ', en: 'Artificial Intelligence' },
    desc: {
      tr: 'Algoritmik adalet, otomatik karar, denetlenebilirlik.',
      en: 'Algorithmic justice, automated decisions, auditability.',
    },
  },
  {
    slug: 'international-relations', code: 'ULI',
    label: { tr: 'Uluslararası İlişkiler', en: 'International Relations' },
    desc: {
      tr: 'Sınır aşan suç, güvenlik, karşılaştırmalı rejim.',
      en: 'Cross-border crime, security, comparative regimes.',
    },
  },
];

const bySlug = new Map(disciplines.map((d) => [d.slug, d]));

/** Bilinmeyen disiplin kodu gelirse kodun kendisini göster — kart boş kalmasın. */
export function disciplineLabel(code: string, lang: string): string {
  const d = bySlug.get(code);
  return d ? (lang === 'en' ? d.label.en : d.label.tr) : code;
}
