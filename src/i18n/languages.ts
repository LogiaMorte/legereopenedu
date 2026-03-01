export const languages = {
  tr: { label: 'Türkçe', code: 'tr-TR' },
  en: { label: 'English', code: 'en-US' },
} as const;

export const defaultLang = 'tr' as const;
export type Lang = keyof typeof languages;
