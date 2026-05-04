(() => {
  const SUPPORTED_LANGUAGES = new Set(["pt", "en", "es"]);
  const DEFAULT_LANGUAGE = "en";

  function normalizeLanguage(value, fallback = DEFAULT_LANGUAGE) {
    const lang = String(value || "").toLowerCase();
    return SUPPORTED_LANGUAGES.has(lang) ? lang : fallback;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function resolvePathValue(dict, path) {
    return String(path || "")
      .split(".")
      .reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), dict);
  }

  function translateFlat(dict, lang, key, params = {}, fallbackLang = DEFAULT_LANGUAGE) {
    const normalized = normalizeLanguage(lang, fallbackLang);
    const value = dict?.[normalized]?.[key] ?? dict?.[fallbackLang]?.[key] ?? key;

    if (typeof value !== "string") return String(value ?? key);
    return value.replace(/\{(\w+)\}/g, (_, token) => String(params[token] ?? ""));
  }

  function translatePath(dict, lang, path, params = {}, fallbackLang = "pt") {
    const normalized = normalizeLanguage(lang, fallbackLang);
    const value =
      resolvePathValue(dict?.[normalized], path) ??
      resolvePathValue(dict?.[fallbackLang], path) ??
      path;

    if (typeof value !== "string") return String(value ?? path);
    return value.replace(/\{(\w+)\}/g, (_, token) => String(params[token] ?? ""));
  }

  function parseISODate(value) {
    if (!value) return null;
    const parts = String(value).split("-");
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map((part) => Number(part));
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseFlexibleDate(value) {
    const iso = parseISODate(value);
    if (iso) return iso;

    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}))?$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3] ? Number(match[3]) : new Date().getFullYear();
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function formatISODate(date) {
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateInputValue(date) {
    return formatISODate(date);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function subtractDays(date, days) {
    const clone = new Date(date.getTime());
    clone.setDate(clone.getDate() - days);
    return clone;
  }

  function localeFor(lang) {
    const normalized = normalizeLanguage(lang);
    if (normalized === "en") return "en-GB";
    if (normalized === "es") return "es-ES";
    return "pt-BR";
  }

  function formatDate(date, lang = DEFAULT_LANGUAGE) {
    if (!date) return "—";
    return new Intl.DateTimeFormat(localeFor(lang), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatTime(date, lang = DEFAULT_LANGUAGE) {
    if (!date) return "—";
    return new Intl.DateTimeFormat(localeFor(lang), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  }

  function previousDayLabel(value, lang = DEFAULT_LANGUAGE) {
    const date = parseFlexibleDate(value) || parseISODate(value);
    if (!date) return "—";
    date.setDate(date.getDate() - 1);
    return formatDate(date, lang);
  }

  function monthName(index, lang, monthLabels) {
    const normalized = normalizeLanguage(lang);
    const label = monthLabels?.[normalized]?.[index] ?? monthLabels?.en?.[index] ?? monthLabels?.pt?.[index];
    return label || "";
  }

  function formatMonthYear(date, lang, monthLabels) {
    if (!date) return "";
    return `${monthName(date.getMonth(), lang, monthLabels)} ${date.getFullYear()}`;
  }

  globalThis.IRPCommon = Object.freeze({
    SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE,
    normalizeLanguage,
    escapeHtml,
    resolvePathValue,
    translateFlat,
    translatePath,
    parseISODate,
    parseFlexibleDate,
    formatISODate,
    formatDateInputValue,
    startOfDay,
    subtractDays,
    localeFor,
    formatDate,
    formatTime,
    previousDayLabel,
    monthName,
    formatMonthYear
  });
})();
