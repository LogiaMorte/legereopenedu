/**
 * Disiplin etiketleri — tek kaynak.
 *
 * Hem build sırasında (WorkshopCard.astro) hem tarayıcıda (etkinlikler
 * /api/events'ten hidrate edilirken) kullanılır. Eskiden yalnızca
 * WorkshopCard.astro içinde gömülüydü.
 */

export const disciplineLabels: Record<string, Record<string, string>> = {
  criminology: { tr: 'Kriminoloji', en: 'Criminology' },
  sociology: { tr: 'Sosyoloji', en: 'Sociology' },
  philosophy: { tr: 'Felsefe', en: 'Philosophy' },
  'data-science': { tr: 'Veri Bilimi', en: 'Data Science' },
  law: { tr: 'Hukuk', en: 'Law' },
  psychology: { tr: 'Psikoloji', en: 'Psychology' },
  anthropology: { tr: 'Antropoloji', en: 'Anthropology' },
  'political-science': { tr: 'Siyaset Bilimi', en: 'Political Science' },
  communication: { tr: 'İletişim Bilimleri', en: 'Communication Sciences' },
  economics: { tr: 'Ekonomi', en: 'Economics' },
  ai: { tr: 'Yapay Zeka', en: 'Artificial Intelligence' },
  'international-relations': { tr: 'Uluslararası İlişkiler', en: 'International Relations' },
};

/** Bilinmeyen disiplin kodu gelirse kodun kendisini göster — kart boş kalmasın. */
export function disciplineLabel(code: string, lang: string): string {
  return disciplineLabels[code]?.[lang] ?? code;
}
