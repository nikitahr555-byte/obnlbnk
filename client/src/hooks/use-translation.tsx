import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { translations, type Translation, getCurrentLanguage, setLanguage as setLang } from '@shared/translations';

type Language = 'ru' | 'en';

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof Translation) => string;
}

const TranslationContext = createContext<TranslationContextType | undefined>(undefined);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => getCurrentLanguage());

  useEffect(() => {
    // Set initial language on mount
    document.documentElement.setAttribute('lang', language);
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    setLang(lang);
    
    // Dispatch custom event for other components to listen to
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: lang }));
  };

  const t = (key: keyof Translation): string => {
    return translations[language][key] || translations['ru'][key] || key;
  };

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (context === undefined) {
    throw new Error('useTranslation must be used within a TranslationProvider');
  }
  return context;
}

export function useLanguageListener(callback: (language: Language) => void) {
  useEffect(() => {
    const handleLanguageChange = (event: CustomEvent<Language>) => {
      callback(event.detail);
    };

    window.addEventListener('languageChanged', handleLanguageChange as EventListener);
    return () => {
      window.removeEventListener('languageChanged', handleLanguageChange as EventListener);
    };
  }, [callback]);
}