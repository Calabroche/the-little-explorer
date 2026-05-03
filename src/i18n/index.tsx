'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Lang, translate } from './dictionaries';

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LangCtx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('fr');

  useEffect(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('tle_lang')) as Lang | null;
    if (saved === 'fr' || saved === 'en') setLangState(saved);
    else {
      // Auto-détection : si le navigateur est en EN, on bascule.
      const nav = typeof navigator !== 'undefined' ? navigator.language?.toLowerCase() : '';
      if (nav?.startsWith('en')) setLangState('en');
    }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== 'undefined') localStorage.setItem('tle_lang', l);
  };

  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useT() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useT must be used within a LanguageProvider');
  return c;
}

/** Format a date according to the current language. */
export function formatDateLocale(iso: string, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
  return new Date(iso).toLocaleDateString(locale, opts).toUpperCase().replace('.', '');
}

export type { Lang };
