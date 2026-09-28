import type { ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n, { type Language, STORAGE_KEY_LANGUAGE } from "./index";

export type { Language };
export { i18n, STORAGE_KEY_LANGUAGE };

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export function useI18n() {
  const { t, i18n: instance } = useTranslation();
  const currentLang = (instance.language === "en" ? "en" : "zh-CN") as Language;

  const setLanguage = (lang: Language) => {
    void instance.changeLanguage(lang);
    try {
      localStorage.setItem(STORAGE_KEY_LANGUAGE, lang);
      if (typeof document !== "undefined") {
        document.documentElement.lang = lang;
      }
    } catch {
      // ignore
    }
  };

  return {
    language: currentLang,
    setLanguage,
    t,
    isEn: currentLang === "en",
  };
}
