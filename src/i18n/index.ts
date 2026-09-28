import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

export const STORAGE_KEY_LANGUAGE = "cpa_dashboard_language";
export type Language = "zh-CN" | "en";

export function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "zh-CN";
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANGUAGE);
    if (saved === "zh-CN" || saved === "en") return saved;
    const browserLang = navigator.languages?.[0] || navigator.language || "zh-CN";
    return browserLang.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  } catch {
    return "zh-CN";
  }
}

const initialLang = getInitialLanguage();

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
  },
  lng: initialLang,
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

if (typeof document !== "undefined") {
  document.documentElement.lang = initialLang;
}

export default i18n;
