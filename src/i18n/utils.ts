import { defaultLang, type Lang } from './languages';
import { ui } from './ui';

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang in ui) return lang as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)[typeof defaultLang]): string {
    return ui[lang]?.[key] ?? ui[defaultLang][key];
  };
}

export function getLocalizedPath(lang: Lang, anchor?: string): string {
  const base = lang === defaultLang ? '/' : `/${lang}/`;
  return anchor ? `${base}#${anchor}` : base;
}

export function getAlternateLang(lang: Lang): Lang {
  return lang === 'tr' ? 'en' : 'tr';
}
