import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Dictionary = Record<string, unknown>;
type LocaleModule = { default: Dictionary } | Dictionary;

const localeModules = import.meta.glob("./locales/*.json", { eager: true }) as Record<string, LocaleModule>;

const dictionaries = Object.fromEntries(
  Object.entries(localeModules).map(([path, value]) => {
    const locale = path.split("/").pop()?.replace(".json", "");
    if (!locale) {
      throw new Error(`Invalid locale file path: ${path}`);
    }
    const dictionary = "default" in value ? value.default : value;
    return [locale, dictionary];
  })
) as Record<string, Dictionary>;

export const SUPPORTED_LOCALES = Object.keys(dictionaries).sort();
export type SupportedLocale = string;

type TranslationParams = Record<string, string | number>;

type I18nContextValue = {
  locale: SupportedLocale;
  setPreferredLocale: (locale: SupportedLocale | null) => void;
  t: (key: string, params?: TranslationParams) => string;
  hasTranslation: (key: string) => boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return !!value && value in dictionaries;
}

function getDeviceLocale(): SupportedLocale {
  if (typeof navigator === "undefined") return "en";
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().split("-")[0];
    if (isSupportedLocale(normalized)) return normalized;
  }
  return "en";
}

function getByPath(source: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, source);
}

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? `{${token}}`));
}

export function I18nProvider(props: { children: ReactNode }) {
  const [locale, setLocale] = useState<SupportedLocale>(getDeviceLocale());
  const fallbackLocale = isSupportedLocale("en") ? "en" : SUPPORTED_LOCALES[0] ?? "en";

  const value = useMemo<I18nContextValue>(() => {
    const hasTranslation = (key: string) => {
      return (
        typeof getByPath(dictionaries[locale] ?? {}, key) === "string" ||
        typeof getByPath(dictionaries[fallbackLocale] ?? {}, key) === "string"
      );
    };

    const t = (key: string, params?: TranslationParams) => {
      const localized = getByPath(dictionaries[locale] ?? {}, key);
      const fallback = getByPath(dictionaries[fallbackLocale] ?? {}, key);
      const resolved = typeof localized === "string" ? localized : typeof fallback === "string" ? fallback : key;
      return interpolate(resolved, params);
    };

    return {
      locale,
      setPreferredLocale: (nextLocale) => setLocale(isSupportedLocale(nextLocale) ? nextLocale : getDeviceLocale()),
      t,
      hasTranslation
    };
  }, [fallbackLocale, locale]);

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}
