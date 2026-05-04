(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const IRPCommon = globalThis.IRPCommon || {};
  const IRPConfig = globalThis.IRPConfig || {};

  const MONTHS = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11
  };

  const DEFAULTS = IRPConfig.defaults || {};
  const DEFAULT_LANGUAGE = DEFAULTS.language || IRPCommon.DEFAULT_LANGUAGE || "en";

  let CONFIG = { ...DEFAULTS };

  const state = {
    running: false,
    lastActionAt: 0,
    lastActionKey: "",
    pauseAfterDate: false
  };

  let runIntervalId = null;
  let dateAlertIntervalId = null;
  let dateAlertAudioContext = null;

  const MAX_CONSOLE_LINES = 5;
  const MIN_MONTH_VIEW_MS = 2000;
  const CALENDAR_LOAD_TIMEOUT_MS = 10500;
  const PORTAL_READY_POLL_MS = 50;
  const DATE_ALERT_INTERVAL_MS = 3000;
  const DATE_ALERT_BEEP_MS = 180;
  const CONTROL_MIGRATION_KEY = "irpOverlayControlMigrated";
  const CALENDAR_RELOAD_KEY = "irpCalendarReloadedAt";
  const CALENDAR_RELOAD_COOLDOWN_MS = 60000;
  const SETUP_WIZARD_DONE_KEY = "irpSetupWizardDone";
  const SETUP_WIZARD_STATE_KEY = "irpSetupWizardState";
  const BOT_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6" y="7" width="12" height="10" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <circle cx="10" cy="12" r="1.2" fill="currentColor"/>
      <circle cx="14" cy="12" r="1.2" fill="currentColor"/>
      <path d="M12 4.5v2.2M9 4.9 8 3.4M15 4.9 16 3.4M9 18.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;
  const ROCKET_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.5 3.6c2.8.5 5 2.7 5.5 5.5.5 2.8-.5 5.6-2.6 7.6l-1 1-1.5 2.8-2.4-2.4-2.4 2.4-1.5-2.8-1-1C5.5 14.7 4.5 11.9 5 9.1c.5-2.8 2.7-5 5.5-5.5 1.3-.2 2.7-.2 4 0Z" fill="currentColor"/>
      <circle cx="13" cy="10" r="1.3" fill="#07151d"/>
      <path d="M7 17.3c-.8.5-1.5 1.3-2.1 2.5 1.4-.1 2.5-.5 3.4-1M15.6 16.4c.9.4 2 .8 3.4 1-.6-1.2-1.3-2-2.1-2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;
  let consoleBuffer = [];

  const SESSION_KEY = IRPConfig.sessionKey || "irpSession";
  const SUPPORTED_LANGUAGES = IRPConfig.supportedLanguages || new Set(["pt", "en", "es"]);
  const MONTH_LABELS = IRPConfig.monthLabels || {};

  const I18N = globalThis.IRPContentI18n || {};

  function normalizeLanguage(value) {
    if (typeof IRPCommon.normalizeLanguage === "function") {
      return IRPCommon.normalizeLanguage(value, DEFAULT_LANGUAGE);
    }
    const lang = String(value || "").toLowerCase();
    return SUPPORTED_LANGUAGES.has(lang) ? lang : DEFAULT_LANGUAGE;
  }

  function getLanguage() {
    return normalizeLanguage(CONFIG.language);
  }

  function resolveMessage(dict, path) {
    return String(path || "")
      .split(".")
      .reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), dict);
  }

  function t(path, params = {}) {
    if (typeof IRPCommon.translatePath === "function") {
      return IRPCommon.translatePath(I18N, getLanguage(), path, params, "pt");
    }
    const lang = getLanguage();
    const value =
      resolveMessage(I18N[lang], path) ??
      resolveMessage(I18N.pt, path) ??
      path;

    if (typeof value !== "string") return String(value ?? path);
    return value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));
  }

  function tForLang(lang, path, params = {}) {
    if (typeof IRPCommon.translatePath === "function") {
      return IRPCommon.translatePath(I18N, lang, path, params, "pt");
    }
    const normalized = normalizeLanguage(lang);
    const value =
      resolveMessage(I18N[normalized], path) ??
      resolveMessage(I18N.pt, path) ??
      path;

    if (typeof value !== "string") return String(value ?? path);
    return value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ""));
  }

  function monthName(index, lang = getLanguage()) {
    if (typeof IRPCommon.monthName === "function") {
      return IRPCommon.monthName(index, lang, MONTH_LABELS);
    }
    return MONTH_LABELS[lang]?.[index] || MONTH_LABELS.pt[index] || "";
  }
  let sessionState = {
    phase: "idle",
    phaseLabel: "Pronto",
    summary: "Aguardando o inÃ­cio da sessÃ£o",
    locationLabel: "",
    selectedDateLabel: "",
    searchLimitLabel: "",
    monthLabel: "",
    dayLabel: "",
    timeLabel: "",
    timeMode: "",
    checkpoints: [],
    updatedAt: ""
  };

  let lastSessionSignature = "";
  let setupWizardStep = 0;
  let setupWizardActive = false;
  let setupWizardDraft = null;

  function cloneSession() {
    return {
      ...sessionState,
      checkpoints: sessionState.checkpoints.map((item) => ({ ...item }))
    };
  }

  function formatMonthYear(date, lang = getLanguage()) {
    if (typeof IRPCommon.formatMonthYear === "function") {
      return IRPCommon.formatMonthYear(date, lang, MONTH_LABELS);
    }
    if (!date) return "";
    return `${monthName(date.getMonth(), lang)} ${date.getFullYear()}`;
  }

  function subtractDays(date, days) {
    if (typeof IRPCommon.subtractDays === "function") {
      return IRPCommon.subtractDays(date, days);
    }
    const clone = new Date(date.getTime());
    clone.setDate(clone.getDate() - days);
    return clone;
  }

  function pushCheckpoint(title, value) {
    const nextCheckpoints = [
      { title, value },
      ...sessionState.checkpoints.filter((item) => item.title !== title)
    ].slice(0, 4);

    setSession({
      checkpoints: nextCheckpoints
    });
  }

  function setSession(patch) {
    sessionState = {
      ...sessionState,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    if (patch.checkpoints) {
      sessionState.checkpoints = patch.checkpoints.slice(0, 4);
    }

    const snapshot = cloneSession();
    const signature = JSON.stringify(snapshot);

    if (signature === lastSessionSignature) {
      syncOverlayPhase(sessionState.phase, sessionState.phaseLabel, sessionState.summary);
      return;
    }
    lastSessionSignature = signature;
    chrome.storage.local.set({ [SESSION_KEY]: snapshot });
    syncOverlayPhase(sessionState.phase, sessionState.phaseLabel, sessionState.summary);
  }

  function getSelectedDateContext() {
    const selectedDate = parseConfiguredDate(CONFIG.selectedDate);
    const searchLimitDate = selectedDate ? subtractDays(selectedDate, 1) : null;
    return {
      selectedDate,
      searchLimitDate
    };
  }

  function parseConfiguredDate(value) {
    return parseISODate(value) || parseFlexibleDate(value);
  }

  function normalizeConfiguredDateValue(value) {
    const parsed = parseConfiguredDate(value);
    return parsed ? formatISODate(startOfDay(parsed)) : "";
  }

  function getDateNormalizationPatch(configSource = CONFIG) {
    const patch = {};
    const keys = ["minimumDate", "selectedDate"];
    for (const key of keys) {
      const raw = String(configSource?.[key] || "").trim();
      if (!raw) continue;
      const normalized = normalizeConfiguredDateValue(raw);
      if (normalized && normalized !== raw) {
        patch[key] = normalized;
      }
    }
    return patch;
  }

  function normalizeDateConfig(configSource = CONFIG, { persist = false } = {}) {
    const patch = getDateNormalizationPatch(configSource);
    if (!Object.keys(patch).length) {
      return patch;
    }

    Object.assign(configSource, patch);
    if (persist) {
      chrome.storage.sync.set(patch);
    }
    return patch;
  }

  function commitSelectedDate(date) {
    if (!date) return Promise.resolve(false);
    const normalized = formatISODate(startOfDay(date));
    if (!normalized || String(CONFIG.selectedDate || "") === normalized) return Promise.resolve(false);

    CONFIG.selectedDate = normalized;
    return new Promise((resolve) => {
      chrome.storage.sync.set({ selectedDate: normalized }, () => {
        refreshSessionFromConfig(false);
        updateOverlayCopy();
        log(t("summary.selectedDateUpdated", { date: formatDate(date) }), "good");
        resolve(true);
      });
    });
  }

  function setPhase(phase, phaseLabel, summary, patch = {}) {
    setSession({
      phase,
      phaseLabel,
      summary,
      ...patch
    });
  }

  function hasConfiguredDate() {
    const minimum = parseConfiguredDate(CONFIG.minimumDate);
    const selected = parseConfiguredDate(CONFIG.selectedDate);
    if (!minimum || !selected) return false;
    return startOfDay(minimum).getTime() < startOfDay(selected).getTime();
  }

  function isSetupWizardDone() {
    try {
      return sessionStorage.getItem(SETUP_WIZARD_DONE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function setSetupWizardDone(done) {
    try {
      if (done) {
        sessionStorage.setItem(SETUP_WIZARD_DONE_KEY, "1");
      } else {
        sessionStorage.removeItem(SETUP_WIZARD_DONE_KEY);
      }
    } catch (err) {
      // Ignore session storage failures.
    }
  }

  function shouldShowSetupWizard() {
    if (!isRescheduleAppointmentPage()) return false;
    if (setupWizardActive) return true;
    if (isUnsupportedRescheduleLocale()) return true;
    return !hasConfiguredDate();
  }

  function getDefaultSetupWizardDraft() {
    return {
      step: 0,
      language: normalizeLanguage(CONFIG.language || "en"),
      minimumDate: String(CONFIG.minimumDate || "").trim(),
      selectedDate: String(CONFIG.selectedDate || "").trim(),
      autoSelectTime: CONFIG.autoSelectTime !== false,
      autoContinueReview: !!CONFIG.autoContinueReview,
      autoFinishAppointment: !!CONFIG.autoFinishAppointment
    };
  }

  function normalizeWizardDateValue(value) {
    const parsed = parseISODate(value) || parseFlexibleDate(value);
    if (parsed) {
      return formatDatePromptValue(formatDate(parsed));
    }
    return formatDatePromptValue(String(value || "").trim());
  }

  function loadSetupWizardDraft() {
    if (setupWizardDraft) return setupWizardDraft;

    let saved = null;
    try {
      const raw = sessionStorage.getItem(SETUP_WIZARD_STATE_KEY);
      if (raw) {
        saved = JSON.parse(raw);
      }
    } catch (err) {
      saved = null;
    }

    setupWizardDraft = {
      ...getDefaultSetupWizardDraft(),
      ...(saved && typeof saved === "object" ? saved : {})
    };

    setupWizardDraft.language = normalizeLanguage(setupWizardDraft.language || CONFIG.language || "en");
    setupWizardDraft.minimumDate = String(setupWizardDraft.minimumDate || "").trim();
    setupWizardDraft.selectedDate = String(setupWizardDraft.selectedDate || "").trim();
    setupWizardDraft.autoSelectTime = setupWizardDraft.autoSelectTime !== false;
    setupWizardDraft.autoContinueReview = !!setupWizardDraft.autoContinueReview;
    setupWizardDraft.autoFinishAppointment = !!setupWizardDraft.autoFinishAppointment;
    setupWizardStep = Math.max(0, Math.min(Number(setupWizardDraft.step || 0), 4));
    setupWizardDraft.step = setupWizardStep;
    return setupWizardDraft;
  }

  function persistSetupWizardDraft() {
    if (!setupWizardDraft) return;
    setupWizardDraft.step = setupWizardStep;
    try {
      sessionStorage.setItem(SETUP_WIZARD_STATE_KEY, JSON.stringify(setupWizardDraft));
    } catch (err) {
      // Ignore storage failures.
    }
  }

  function clearSetupWizardDraft() {
    setupWizardDraft = null;
    setupWizardStep = 0;
    setupWizardActive = false;
    try {
      sessionStorage.removeItem(SETUP_WIZARD_STATE_KEY);
    } catch (err) {
      // Ignore storage failures.
    }
  }

  function setSetupWizardStep(step) {
    const normalized = Math.max(0, Math.min(Number(step) || 0, 4));
    setupWizardStep = normalized;
    const draft = loadSetupWizardDraft();
    draft.step = normalized;
    persistSetupWizardDraft();
  }

  function updateSetupWizardDraft(patch = {}) {
    const draft = loadSetupWizardDraft();
    if (Object.prototype.hasOwnProperty.call(patch, "language")) {
      draft.language = normalizeLanguage(patch.language || CONFIG.language || "en");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "minimumDate")) {
      draft.minimumDate = String(patch.minimumDate || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "selectedDate")) {
      draft.selectedDate = String(patch.selectedDate || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "autoSelectTime")) {
      draft.autoSelectTime = !!patch.autoSelectTime;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "autoContinueReview")) {
      draft.autoContinueReview = !!patch.autoContinueReview;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "autoFinishAppointment")) {
      draft.autoFinishAppointment = !!patch.autoFinishAppointment;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "step")) {
      setSetupWizardStep(patch.step);
    } else {
      persistSetupWizardDraft();
    }
    return draft;
  }

  function persistWizardConfigPatch(patch = {}, options = {}) {
    const skipRuntimeSync = !!options.skipRuntimeSync;
    const normalizedPatch = {};
    if (Object.prototype.hasOwnProperty.call(patch, "language")) {
      normalizedPatch.language = normalizeLanguage(patch.language || CONFIG.language || "en");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "minimumDate")) {
      const rawMinimum = String(patch.minimumDate || "").trim();
      normalizedPatch.minimumDate = rawMinimum ? normalizeConfiguredDateValue(rawMinimum) : "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "selectedDate")) {
      const rawSelected = String(patch.selectedDate || "").trim();
      normalizedPatch.selectedDate = rawSelected ? normalizeConfiguredDateValue(rawSelected) : "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "autoSelectTime")) {
      normalizedPatch.autoSelectTime = !!patch.autoSelectTime;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "autoContinueReview")) {
      normalizedPatch.autoContinueReview = !!patch.autoContinueReview;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "autoFinishAppointment")) {
      normalizedPatch.autoFinishAppointment = !!patch.autoFinishAppointment;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
      normalizedPatch.enabled = !!patch.enabled;
    }

    Object.assign(CONFIG, normalizedPatch);
    const draftPatch = { ...normalizedPatch };
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "minimumDate")) {
      const parsedMinimum = parseConfiguredDate(normalizedPatch.minimumDate);
      draftPatch.minimumDate = parsedMinimum ? formatDatePromptValue(formatDate(parsedMinimum)) : String(normalizedPatch.minimumDate || "").trim();
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "selectedDate")) {
      const parsedSelected = parseConfiguredDate(normalizedPatch.selectedDate);
      draftPatch.selectedDate = parsedSelected ? formatDatePromptValue(formatDate(parsedSelected)) : String(normalizedPatch.selectedDate || "").trim();
    }
    updateSetupWizardDraft(draftPatch);

    return new Promise((resolve) => {
      chrome.storage.sync.set(normalizedPatch, () => {
        if (!skipRuntimeSync) {
          refreshSessionFromConfig(false);
          updateOverlayCopy();
          syncBotLoop();
        }
        resolve(true);
      });
    });
  }

  function getWizardStepLabels(lang = getLanguage()) {
    const normalized = normalizeLanguage(lang);
    return {
      0: tForLang(normalized, "prompt.stepLanguageTitle"),
      1: tForLang(normalized, "prompt.stepMinimumTitle"),
      2: tForLang(normalized, "prompt.stepSelectedTitle"),
      3: tForLang(normalized, "prompt.stepOptionsTitle"),
      4: tForLang(normalized, "prompt.stepStartTitle")
    };
  }

  function getWizardStepPillLabels(lang = getLanguage()) {
    if (isUnsupportedRescheduleLocale()) {
      switch (normalizeLanguage(lang)) {
        case "en":
          return ["Language", "Notice"];
        case "es":
          return ["Idioma", "Aviso"];
        default:
          return ["Idioma", "Aviso"];
      }
    }

    switch (normalizeLanguage(lang)) {
      case "en":
        return ["Language", "Min date", "Booked", "Options", "Start"];
      case "es":
        return ["Idioma", "Minima", "Reservada", "Opciones", "Inicio"];
      default:
        return ["Idioma", "Minima", "Marcada", "Opcoes", "Inicio"];
    }
  }

  function getWizardStepTitle(step, lang = getLanguage()) {
    const normalized = normalizeLanguage(lang);
    if (isUnsupportedRescheduleLocale()) {
      if ((Number(step) || 0) <= 0) {
        return tForLang(normalized, "prompt.stepLanguageTitle");
      }
      return tForLang(normalized, "prompt.stepBlockedTitle");
    }

    switch (Math.max(0, Math.min(Number(step) || 0, 4))) {
      case 0:
        return tForLang(normalized, "prompt.stepLanguageTitle");
      case 1:
        return tForLang(normalized, "prompt.stepMinimumTitle");
      case 2:
        return tForLang(normalized, "prompt.stepSelectedTitle");
      case 3:
        return tForLang(normalized, "prompt.stepOptionsTitle");
      case 4:
        return tForLang(normalized, "prompt.stepStartTitle");
      default:
        return tForLang(normalized, "prompt.title");
    }
  }

  function getWizardStepBody(step, lang = getLanguage()) {
    const normalized = normalizeLanguage(lang);
    if (isUnsupportedRescheduleLocale()) {
      if ((Number(step) || 0) <= 0) {
        return tForLang(normalized, "prompt.stepLanguageBody");
      }
      return tForLang(normalized, "prompt.stepBlockedBody");
    }

    switch (Math.max(0, Math.min(Number(step) || 0, 4))) {
      case 0:
        return tForLang(normalized, "prompt.stepLanguageBody");
      case 1:
        return tForLang(normalized, "prompt.stepMinimumBody");
      case 2:
        return tForLang(normalized, "prompt.stepSelectedBody");
      case 3:
        return tForLang(normalized, "prompt.stepOptionsBody");
      case 4:
        return tForLang(normalized, "prompt.stepStartBody");
      default:
        return tForLang(normalized, "prompt.body");
    }
  }

  function isRescheduleAppointmentPage() {
    return /reschedule_appointment/i.test(String(window.location.pathname || window.location.href || ""));
  }

  function getRescheduleLocaleFromPath() {
    const pathname = String(window.location.pathname || "");
    const match = pathname.match(/^\/([^/]+)\/reschedule_appointment\/?$/i);
    return match?.[1] ? String(match[1]).toLowerCase() : "";
  }

  function isEnglishRescheduleAppointmentPage() {
    return getRescheduleLocaleFromPath() === "en";
  }

  function isUnsupportedRescheduleLocale() {
    return isRescheduleAppointmentPage() && !isEnglishRescheduleAppointmentPage();
  }

  function getSetupPendingSummary() {
    return isUnsupportedRescheduleLocale()
      ? t("summary.englishRescheduleRequired")
      : t("summary.setupWizardPending");
  }

  function goToEnglishAppointmentsPage() {
    window.location.href = "https://portal.irishimmigration.ie/en/appointments/";
  }

  function removeBotOverlay() {
    document.getElementById("irp-ui")?.remove();
    document.getElementById("irp-date-prompt")?.remove();
  }

  function stopBotLoop(options = {}) {
    const stopAlert = options.stopAlert !== false;
    if (runIntervalId) {
      clearInterval(runIntervalId);
      runIntervalId = null;
    }
    if (stopAlert) {
      stopDateAlertSound();
    }
  }

  function startBotLoop() {
    if (runIntervalId) return;
    runIntervalId = setInterval(run, 2000);
  }

  function syncBotLoop() {
    if (shouldShowSetupWizard()) {
      if (CONFIG.enabled) {
        CONFIG.enabled = false;
        chrome.storage.sync.set({ enabled: false });
        updateOverlayCopy();
      }
      stopBotLoop();
      return;
    }

    if (state.pauseAfterDate) {
      stopBotLoop({ stopAlert: false });
      return;
    }

    if (CONFIG.enabled && hasConfiguredDate() && isRescheduleAppointmentPage() && !isUnsupportedRescheduleLocale()) {
      startBotLoop();
    } else {
      stopBotLoop();
    }
  }

  function toggleBotFromOverlay() {
    const nextEnabled = !CONFIG.enabled;
    if (nextEnabled && state.pauseAfterDate) {
      state.pauseAfterDate = false;
      stopDateAlertSound();
    }

    if (nextEnabled && shouldShowSetupWizard()) {
      setSetupWizardDone(false);
      setDatePromptVisible(true);
      setSession({
        phase: "setup",
        phaseLabel: t("phase.setup"),
        summary: getSetupPendingSummary()
      });
      updateOverlayCopy();
      syncBotLoop();
      return;
    }

    CONFIG.enabled = nextEnabled;

    chrome.storage.sync.set({ enabled: nextEnabled }, () => {
      refreshSessionFromConfig(false);
      syncBotLoop();
      updateOverlayCopy();

      if (nextEnabled && hasConfiguredDate()) {
        void unlockDateAlertSound();
        setTimeout(run, 120);
      } else if (!nextEnabled) {
        stopBotLoop();
      }
    });
  }

  function getDateAlertAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;

    if (dateAlertAudioContext && dateAlertAudioContext.state !== "closed") {
      return dateAlertAudioContext;
    }

    try {
      dateAlertAudioContext = new AudioContextCtor();
    } catch (err) {
      return null;
    }

    return dateAlertAudioContext;
  }

  async function unlockDateAlertSound() {
    const audioContext = getDateAlertAudioContext();
    if (!audioContext) return false;

    try {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      return audioContext.state !== "closed";
    } catch (err) {
      return false;
    }
  }

  function playDateAlertSound() {
    const audioContext = getDateAlertAudioContext();
    if (!audioContext || audioContext.state === "closed") return false;

    try {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (DATE_ALERT_BEEP_MS / 1000));

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + (DATE_ALERT_BEEP_MS / 1000) + 0.02);
      return true;
    } catch (err) {
      return false;
    }
  }

  function stopDateAlertSound() {
    if (dateAlertIntervalId) {
      clearInterval(dateAlertIntervalId);
      dateAlertIntervalId = null;
    }
  }

  function startDateAlertSound() {
    stopDateAlertSound();
    playDateAlertSound();
    dateAlertIntervalId = setInterval(() => {
      playDateAlertSound();
    }, DATE_ALERT_INTERVAL_MS);
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  }

  function getSearchDocuments(root = document) {
    const docs = [];
    const seen = new Set();

    function visit(doc) {
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push(doc);

      for (const frame of [...doc.querySelectorAll("iframe, frame")]) {
        try {
          if (frame.contentDocument) {
            visit(frame.contentDocument);
          }
        } catch (err) {
          // Ignore cross-origin or detached frames.
        }
      }
    }

    try {
      visit(root);
    } catch (err) {
      return docs;
    }

    return docs;
  }

  function queryAllDocuments(selector, root = document) {
    const results = [];
    for (const doc of getSearchDocuments(root)) {
      try {
        results.push(...doc.querySelectorAll(selector));
      } catch (err) {
        // Ignore invalid selectors in nested documents.
      }
    }
    return results;
  }

  function parseISODate(value) {
    if (typeof IRPCommon.parseISODate === "function") {
      return IRPCommon.parseISODate(value);
    }
    if (!value) return null;
    const parts = String(value).split("-");
    if (parts.length !== 3) return null;
    const [year, month, day] = parts.map((part) => Number(part));
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function parseFlexibleDate(value) {
    if (typeof IRPCommon.parseFlexibleDate === "function") {
      return IRPCommon.parseFlexibleDate(value);
    }
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

  function formatDatePromptValue(value) {
    const digits = String(value || "")
      .replace(/\D/g, "")
      .slice(0, 4);

    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  function formatISODate(date) {
    if (typeof IRPCommon.formatISODate === "function") {
      return IRPCommon.formatISODate(date);
    }
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfDay(date) {
    if (typeof IRPCommon.startOfDay === "function") {
      return IRPCommon.startOfDay(date);
    }
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function compareMonths(a, b) {
    const yearDiff = a.getFullYear() - b.getFullYear();
    if (yearDiff !== 0) return yearDiff;
    return a.getMonth() - b.getMonth();
  }

  function formatDate(date) {
    if (typeof IRPCommon.formatDate === "function") {
      return IRPCommon.formatDate(date, getLanguage());
    }
    if (!date) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${date.getFullYear()}`;
  }

  function markAction(key) {
    state.lastActionKey = key;
    state.lastActionAt = Date.now();
  }

  function wasRecentAction(key, cooldownMs = 1500) {
    return state.lastActionKey === key && Date.now() - state.lastActionAt < cooldownMs;
  }

  function ensureUI() {
    if (!isRescheduleAppointmentPage()) {
      removeBotOverlay();
      return;
    }

    if (!document.getElementById("irp-ui")) {
      const el = document.createElement("div");
      el.id = "irp-ui";
      el.innerHTML = `
        <div class="irp-top">
          <div class="irp-brand">
            <div class="irp-brand-icon" aria-hidden="true">${BOT_ICON_SVG}</div>
            <div class="irp-brand-copy">
              <div id="irp-title">IRP BOT V3</div>
              <div id="irp-subtitle">Status, tempo e console</div>
            </div>
            <div id="irp-brand-chip" class="irp-brand-chip">BOT</div>
          </div>
        </div>
        <div class="irp-status-card">
          <div id="irp-status-card-label" class="irp-card-label">Status</div>
          <div id="irp-status" class="irp-status-value">Idle</div>
          <div id="irp-summary" class="irp-summary">Aguardando.</div>
          <div class="irp-progress-wrap">
            <div class="irp-progress-track">
              <div id="irp-progress-bar" class="irp-progress-bar"></div>
              <div id="irp-progress-rocket" class="irp-progress-rocket" aria-hidden="true">${ROCKET_ICON_SVG}</div>
            </div>
          </div>
          <div id="irp-meta-row" class="irp-meta-row" hidden>
            <span id="irp-timer-label" class="irp-meta-label">Tempo</span>
            <strong id="irp-timer" class="irp-meta-value">0s</strong>
          </div>
          <div class="irp-control-row">
            <button id="irp-toggle-bot" class="irp-toggle-bot" type="button"></button>
          </div>
        </div>
        <div class="irp-console-card">
          <div id="irp-console-card-label" class="irp-card-label">Console</div>
          <div id="irp-logs" aria-live="polite"></div>
        </div>
      `;
      el.className = "irp-ui-shell";
      document.body.appendChild(el);

      const toggle = document.getElementById("irp-toggle-bot");
      if (toggle) {
        toggle.addEventListener("click", toggleBotFromOverlay);
      }
    }

    ensureDatePrompt();
  }

  function ensureDatePrompt() {
    if (document.getElementById("irp-date-prompt")) return;

    const prompt = document.createElement("div");
    prompt.id = "irp-date-prompt";
    prompt.hidden = true;
    prompt.setAttribute("role", "dialog");
    prompt.setAttribute("aria-modal", "true");
    prompt.innerHTML = `
      <div class="irp-date-prompt-card">
        <div class="irp-date-prompt-kicker">
          <span class="irp-date-prompt-icon" aria-hidden="true">${BOT_ICON_SVG}</span>
          <span>IRP BOT V3</span>
        </div>
        <div id="irp-date-prompt-title" class="irp-date-prompt-title"></div>
        <p id="irp-date-prompt-body" class="irp-date-prompt-body"></p>
        <div id="irp-date-prompt-stepper" class="irp-date-prompt-stepper"></div>
        <div id="irp-date-prompt-content" class="irp-date-prompt-step"></div>
        <div id="irp-date-prompt-summary" class="irp-date-prompt-summary"></div>
        <div id="irp-date-prompt-error" class="irp-date-prompt-error" hidden></div>
        <div id="irp-date-prompt-hint" class="irp-date-prompt-hint"></div>
        <div id="irp-date-prompt-actions" class="irp-date-prompt-actions"></div>
      </div>
    `;

    document.body.appendChild(prompt);
  }

  function setStatus(s) {
    ensureUI();
    document.getElementById("irp-status").textContent = s;
  }

  function setTimer(sec) {
    ensureUI();
    document.getElementById("irp-timer").textContent = `${sec}s`;
  }

  function setTimerVisible(visible) {
    ensureUI();
    const row = document.getElementById("irp-meta-row");
    if (row) {
      row.hidden = !visible;
    }
  }

  function updateOverlayCopy() {
    ensureUI();
    const title = document.getElementById("irp-title");
    const subtitle = document.getElementById("irp-subtitle");
    const statusLabel = document.getElementById("irp-status-card-label");
    const consoleLabel = document.getElementById("irp-console-card-label");
    const timerLabel = document.getElementById("irp-timer-label");

    if (title) title.textContent = t("overlay.title");
    if (subtitle) subtitle.textContent = t("overlay.subtitle");
    if (statusLabel) statusLabel.textContent = t("overlay.status");
    if (consoleLabel) consoleLabel.textContent = t("overlay.console");
    if (timerLabel) timerLabel.textContent = t("overlay.time");
    updateOverlayControls();
  }

  function updateOverlayControls() {
    ensureUI();
    const toggle = document.getElementById("irp-toggle-bot");
    if (!toggle) return;

    const enabled = !!CONFIG.enabled;
    const label = enabled ? t("overlay.stopBot") : t("overlay.startBot");
    const chip = document.getElementById("irp-brand-chip");
    toggle.innerHTML = `
      <span class="irp-toggle-icon" aria-hidden="true">${BOT_ICON_SVG}</span>
      <span class="irp-toggle-text">${label}</span>
    `;
    toggle.classList.toggle("off", !enabled);
    toggle.classList.toggle("running", enabled);
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.setAttribute("aria-label", label);

    if (chip) {
      chip.textContent = enabled ? "RUN" : "PAUSE";
      chip.classList.toggle("off", !enabled);
    }
  }

  function renderSetupWizardSummary(lang, draft) {
    const minimumParsed = parseFlexibleDate(draft.minimumDate) || parseISODate(draft.minimumDate);
    const selectedParsed = parseFlexibleDate(draft.selectedDate) || parseISODate(draft.selectedDate);
    const searchLimit = selectedParsed ? subtractDays(selectedParsed, 1) : null;
    const languageLabel =
      draft.language === "en"
        ? tForLang(lang, "prompt.optionEn")
        : draft.language === "es"
          ? tForLang(lang, "prompt.optionEs")
          : tForLang(lang, "prompt.optionPt");

    return `
      <div class="irp-date-prompt-summary-row">
        <strong>${tForLang(lang, "prompt.languageLabel")}</strong>
        <span>${languageLabel}</span>
      </div>
      <div class="irp-date-prompt-summary-row">
        <strong>${tForLang(lang, "prompt.minimumLabel")}</strong>
        <span>${minimumParsed ? formatDate(minimumParsed) : "dd/mm"}</span>
      </div>
      <div class="irp-date-prompt-summary-row">
        <strong>${tForLang(lang, "prompt.selectedLabel")}</strong>
        <span>${selectedParsed ? formatDate(selectedParsed) : "dd/mm"}</span>
      </div>
      <div class="irp-date-prompt-summary-row">
        <strong>${tForLang(lang, "prompt.autoSelectTimeLabel")}</strong>
        <span>${draft.autoSelectTime ? tForLang(lang, "prompt.summaryOn") : tForLang(lang, "prompt.summaryOff")}</span>
      </div>
      <div class="irp-date-prompt-summary-row">
        <strong>${tForLang(lang, "prompt.autoContinueReviewLabel")}</strong>
        <span>${draft.autoContinueReview ? tForLang(lang, "prompt.summaryOn") : tForLang(lang, "prompt.summaryOff")}</span>
      </div>
      <div class="irp-date-prompt-summary-row">
        <strong>${tForLang(lang, "prompt.autoFinishAppointmentLabel")}</strong>
        <span>${draft.autoFinishAppointment ? tForLang(lang, "prompt.summaryOn") : tForLang(lang, "prompt.summaryOff")}</span>
      </div>
      <div class="irp-date-prompt-summary-note">
        ${minimumParsed && selectedParsed
          ? tForLang(lang, "summary.searchWindow", {
              from: formatDate(minimumParsed),
              to: formatDate(searchLimit)
            })
          : tForLang(lang, "prompt.hint")}
      </div>
    `;
  }

  function renderSetupWizardContent(lang, draft) {
    if (isUnsupportedRescheduleLocale() && setupWizardStep === 1) {
      return `
        <div class="irp-date-prompt-toggle">
          <input type="checkbox" checked disabled />
          <div>
            <strong>${tForLang(lang, "prompt.stepBlockedTitle")}</strong>
            <span>${tForLang(lang, "prompt.stepBlockedBody")}</span>
          </div>
        </div>
      `;
    }

    switch (setupWizardStep) {
      case 0:
        return `
          <div class="irp-date-prompt-field">
            <label id="irp-date-prompt-language-label" class="irp-date-prompt-label" for="irp-date-prompt-language"></label>
            <select id="irp-date-prompt-language" class="irp-date-prompt-select">
              <option value="pt">${tForLang(lang, "prompt.optionPt")}</option>
              <option value="en">${tForLang(lang, "prompt.optionEn")}</option>
              <option value="es">${tForLang(lang, "prompt.optionEs")}</option>
            </select>
          </div>
        `;
      case 1:
        return `
          <div class="irp-date-prompt-field">
            <label id="irp-date-prompt-minimum-label" class="irp-date-prompt-label" for="irp-date-prompt-minimum-input"></label>
            <input id="irp-date-prompt-minimum-input" class="irp-date-prompt-input" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" />
          </div>
        `;
      case 2:
        return `
          <div class="irp-date-prompt-field">
            <label id="irp-date-prompt-selected-label" class="irp-date-prompt-label" for="irp-date-prompt-input"></label>
            <input id="irp-date-prompt-input" class="irp-date-prompt-input" type="text" inputmode="numeric" maxlength="5" autocomplete="off" spellcheck="false" />
          </div>
        `;
      case 3:
        return `
          <div class="irp-date-prompt-toggle">
            <input id="irp-date-prompt-auto-time" type="checkbox" ${draft.autoSelectTime ? "checked" : ""} />
            <div>
              <strong>${tForLang(lang, "prompt.autoSelectTimeLabel")}</strong>
              <span>${tForLang(lang, "prompt.autoSelectTimeHelp")}</span>
            </div>
          </div>
          <div class="irp-date-prompt-toggle">
            <input id="irp-date-prompt-auto-review" type="checkbox" ${draft.autoContinueReview ? "checked" : ""} />
            <div>
              <strong>${tForLang(lang, "prompt.autoContinueReviewLabel")}</strong>
              <span>${tForLang(lang, "prompt.autoContinueReviewHelp")}</span>
            </div>
          </div>
          <div class="irp-date-prompt-toggle">
            <input id="irp-date-prompt-auto-finish" type="checkbox" ${draft.autoFinishAppointment ? "checked" : ""} />
            <div>
              <strong>${tForLang(lang, "prompt.autoFinishAppointmentLabel")}</strong>
              <span>${tForLang(lang, "prompt.autoFinishAppointmentHelp")}</span>
            </div>
          </div>
        `;
      case 4:
        return `
          <div class="irp-date-prompt-toggle">
            <input type="checkbox" checked disabled />
            <div>
              <strong>${tForLang(lang, "prompt.stepStartTitle")}</strong>
              <span>${tForLang(lang, "prompt.stepStartBody")}</span>
            </div>
          </div>
        `;
      default:
        return "";
    }
  }

  function renderSetupWizardActions(lang) {
    if (isUnsupportedRescheduleLocale()) {
      if (setupWizardStep <= 0) {
        return `
          <button id="irp-date-prompt-save" class="irp-date-prompt-save" type="button">${tForLang(lang, "prompt.nextButton")}</button>
        `;
      }
      return `
        <button id="irp-date-prompt-back" class="irp-date-prompt-secondary" type="button">${tForLang(lang, "prompt.backButton")}</button>
        <button id="irp-date-prompt-go-appointments" class="irp-date-prompt-save" type="button">${tForLang(lang, "prompt.goAppointmentsButton")}</button>
      `;
    }

    switch (setupWizardStep) {
      case 0:
        return `
          <button id="irp-date-prompt-save" class="irp-date-prompt-save" type="button">${tForLang(lang, "prompt.nextButton")}</button>
        `;
      case 1:
      case 2:
      case 3:
        return `
          <button id="irp-date-prompt-back" class="irp-date-prompt-secondary" type="button">${tForLang(lang, "prompt.backButton")}</button>
          <button id="irp-date-prompt-save" class="irp-date-prompt-save" type="button">${tForLang(lang, "prompt.nextButton")}</button>
        `;
      case 4:
        return `
          <button id="irp-date-prompt-back" class="irp-date-prompt-secondary" type="button">${tForLang(lang, "prompt.backButton")}</button>
          <button id="irp-date-prompt-no" class="irp-date-prompt-ghost" type="button">${tForLang(lang, "prompt.startNoButton")}</button>
          <button id="irp-date-prompt-save" class="irp-date-prompt-save" type="button">${tForLang(lang, "prompt.startYesButton")}</button>
        `;
      default:
        return "";
    }
  }

  function bindSetupWizardControls(lang, draft) {
    const prompt = document.getElementById("irp-date-prompt");
    if (!prompt || prompt.hidden) return;

    const save = document.getElementById("irp-date-prompt-save");
    const back = document.getElementById("irp-date-prompt-back");
    const no = document.getElementById("irp-date-prompt-no");
    const goAppointments = document.getElementById("irp-date-prompt-go-appointments");

    const language = document.getElementById("irp-date-prompt-language");
    const minimumInput = document.getElementById("irp-date-prompt-minimum-input");
    const selectedInput = document.getElementById("irp-date-prompt-input");
    const autoTime = document.getElementById("irp-date-prompt-auto-time");
    const autoReview = document.getElementById("irp-date-prompt-auto-review");
    const autoFinish = document.getElementById("irp-date-prompt-auto-finish");
    const error = document.getElementById("irp-date-prompt-error");

    const setCurrentError = (message = "") => {
      if (!error) return;
      if (!message) {
        error.hidden = true;
        error.textContent = "";
        return;
      }
      error.hidden = false;
      error.textContent = message;
    };

    const onDateInput = (field, patchKey) => {
      if (!field) return;

      const syncField = () => {
        field.value = formatDatePromptValue(field.value);
        setupWizardDraft = loadSetupWizardDraft();
        setupWizardDraft[patchKey] = field.value;
        persistSetupWizardDraft();
      };

      field.addEventListener("input", syncField);
      field.addEventListener("blur", syncField);
      field.addEventListener("paste", (event) => {
        event.preventDefault();
        const pasted = event.clipboardData?.getData("text") || "";
        field.value = formatDatePromptValue(pasted);
        syncField();
      });
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveDateFromPrompt();
        }
      });
    };

    if (language) {
      language.value = draft.language;
      language.addEventListener("change", () => {
        const nextLang = normalizeLanguage(language.value || CONFIG.language || "en");
        updateSetupWizardDraft({ language: nextLang });
        persistSetupWizardDraft();
        renderSetupWizard();
      });
    }

    if (minimumInput) {
      minimumInput.value = normalizeWizardDateValue(draft.minimumDate);
      onDateInput(minimumInput, "minimumDate");
    }

    if (selectedInput) {
      selectedInput.value = normalizeWizardDateValue(draft.selectedDate);
      onDateInput(selectedInput, "selectedDate");
    }

    if (autoTime) {
      autoTime.checked = !!draft.autoSelectTime;
      autoTime.addEventListener("change", () => {
        updateSetupWizardDraft({ autoSelectTime: autoTime.checked });
        persistSetupWizardDraft();
        renderSetupWizard();
      });
    }

    if (autoReview) {
      autoReview.checked = !!draft.autoContinueReview;
      autoReview.addEventListener("change", () => {
        updateSetupWizardDraft({ autoContinueReview: autoReview.checked });
        persistSetupWizardDraft();
        renderSetupWizard();
      });
    }

    if (autoFinish) {
      autoFinish.checked = !!draft.autoFinishAppointment;
      autoFinish.addEventListener("change", () => {
        updateSetupWizardDraft({ autoFinishAppointment: autoFinish.checked });
        persistSetupWizardDraft();
        renderSetupWizard();
      });
    }

    if (save) {
      save.addEventListener("click", saveDateFromPrompt);
    }

    if (back) {
      back.addEventListener("click", () => {
        setCurrentError("");
        if (setupWizardStep > 0) {
          setSetupWizardStep(setupWizardStep - 1);
          renderSetupWizard();
        }
      });
    }

    if (no) {
      no.addEventListener("click", () => {
        setCurrentError("");
        completeSetupWizard(false);
      });
    }

    if (goAppointments) {
      goAppointments.addEventListener("click", () => {
        setCurrentError("");
        goToEnglishAppointmentsPage();
      });
    }
  }

  function renderSetupWizard() {
    ensureDatePrompt();
    const prompt = document.getElementById("irp-date-prompt");
    if (!prompt || prompt.hidden) return;

    const draft = loadSetupWizardDraft();
    const lang = normalizeLanguage(draft.language || CONFIG.language || "en");

    setupWizardActive = true;
    if (isUnsupportedRescheduleLocale() && setupWizardStep > 1) {
      setSetupWizardStep(1);
      draft.step = 1;
      persistSetupWizardDraft();
    }
    setSetupWizardStep(draft.step || 0);

    const title = document.getElementById("irp-date-prompt-title");
    const body = document.getElementById("irp-date-prompt-body");
    const hint = document.getElementById("irp-date-prompt-hint");
    const stepper = document.getElementById("irp-date-prompt-stepper");
    const content = document.getElementById("irp-date-prompt-content");
    const summary = document.getElementById("irp-date-prompt-summary");
    const actions = document.getElementById("irp-date-prompt-actions");
    const error = document.getElementById("irp-date-prompt-error");

    if (title) title.textContent = getWizardStepTitle(setupWizardStep, lang);
    if (body) body.textContent = getWizardStepBody(setupWizardStep, lang);
    if (hint) hint.textContent = tForLang(lang, "prompt.hint");
    if (stepper) {
      const pillLabels = getWizardStepPillLabels(lang);
      stepper.innerHTML = pillLabels
        .map((label, index) => `<span class="irp-step-chip${index === setupWizardStep ? " active" : ""}">${index + 1}. ${label}</span>`)
        .join("");
    }
    if (content) content.innerHTML = renderSetupWizardContent(lang, draft);
    if (summary) summary.innerHTML = renderSetupWizardSummary(lang, draft);
    if (actions) actions.innerHTML = renderSetupWizardActions(lang);
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    bindSetupWizardControls(lang, draft);

    const focusTarget = (() => {
      if (setupWizardStep === 0) return document.getElementById("irp-date-prompt-language");
      if (isUnsupportedRescheduleLocale() && setupWizardStep === 1) return document.getElementById("irp-date-prompt-go-appointments");
      if (setupWizardStep === 1) return document.getElementById("irp-date-prompt-minimum-input");
      if (setupWizardStep === 2) return document.getElementById("irp-date-prompt-input");
      return null;
    })();

    if (focusTarget) {
      setTimeout(() => focusTarget.focus(), 0);
    }
  }

  function updateDatePromptCopy() {
    renderSetupWizard();
  }

  function setDatePromptVisible(visible) {
    ensureDatePrompt();

    const prompt = document.getElementById("irp-date-prompt");
    if (!prompt) return;
    const openingFresh = visible && prompt.hidden;

    prompt.hidden = !visible;
    setupWizardActive = visible;

    if (!visible) {
      const error = document.getElementById("irp-date-prompt-error");
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
      return;
    }

    if (openingFresh && (!hasConfiguredDate() || isUnsupportedRescheduleLocale())) {
      setupWizardDraft = {
        ...getDefaultSetupWizardDraft(),
        step: 0
      };
      persistSetupWizardDraft();
    }

    loadSetupWizardDraft();
    renderSetupWizard();
  }

  function syncDatePromptVisibility() {
    setDatePromptVisible(shouldShowSetupWizard());
  }

  async function completeSetupWizard(startNow) {
    const draft = loadSetupWizardDraft();
    const minimumDate = normalizeConfiguredDateValue(draft.minimumDate);
    const selectedDate = normalizeConfiguredDateValue(draft.selectedDate);
    const shouldStart = !!startNow;

    if (shouldStart && state.pauseAfterDate) {
      state.pauseAfterDate = false;
      stopDateAlertSound();
    }

    setSetupWizardDone(true);
    setDatePromptVisible(false);
    clearSetupWizardDraft();

    await persistWizardConfigPatch({
      enabled: shouldStart,
      language: draft.language,
      minimumDate,
      selectedDate,
      autoSelectTime: draft.autoSelectTime,
      autoContinueReview: draft.autoContinueReview,
      autoFinishAppointment: draft.autoFinishAppointment
    }, { skipRuntimeSync: true });

    refreshSessionFromConfig(true);
    updateOverlayCopy();
    syncDatePromptVisibility();

    if (shouldStart) {
      void unlockDateAlertSound();
      syncBotLoop();
      setTimeout(run, 120);
    } else {
      stopBotLoop();
    }
  }

  async function saveDateFromPrompt() {
    ensureDatePrompt();
    const draft = loadSetupWizardDraft();
    const lang = normalizeLanguage(draft.language || CONFIG.language || "en");
    const error = document.getElementById("irp-date-prompt-error");

    const showError = (message) => {
      if (!error) return;
      error.hidden = false;
      error.textContent = message;
    };

    const clearError = () => {
      if (!error) return;
      error.hidden = true;
      error.textContent = "";
    };

    switch (setupWizardStep) {
      case 0: {
        await persistWizardConfigPatch({ language: draft.language });
        if (isUnsupportedRescheduleLocale()) {
          setSetupWizardStep(1);
          persistSetupWizardDraft();
          clearError();
          renderSetupWizard();
          return true;
        }
        setSetupWizardStep(1);
        persistSetupWizardDraft();
        clearError();
        renderSetupWizard();
        return true;
      }
      case 1: {
        if (isUnsupportedRescheduleLocale()) {
          goToEnglishAppointmentsPage();
          return true;
        }

        const minimumInput = document.getElementById("irp-date-prompt-minimum-input");
        const minimumValue = normalizeWizardDateValue(minimumInput?.value || draft.minimumDate);
        const minimumParsed = parseFlexibleDate(minimumValue);
        const selectedParsed = parseFlexibleDate(draft.selectedDate);

        if (!minimumParsed) {
          showError(tForLang(lang, "prompt.error"));
          return false;
        }

        if (selectedParsed && startOfDay(minimumParsed) >= startOfDay(selectedParsed)) {
          showError(tForLang(lang, "prompt.rangeError"));
          return false;
        }

        draft.minimumDate = formatDatePromptValue(minimumValue);
        persistSetupWizardDraft();
        await persistWizardConfigPatch({ minimumDate: formatISODate(minimumParsed) });
        setSetupWizardStep(2);
        clearError();
        renderSetupWizard();
        return true;
      }
      case 2: {
        const selectedInput = document.getElementById("irp-date-prompt-input");
        const selectedValue = normalizeWizardDateValue(selectedInput?.value || draft.selectedDate);
        const selectedParsed = parseFlexibleDate(selectedValue);
        const minimumParsed = parseFlexibleDate(draft.minimumDate);

        if (!selectedParsed) {
          showError(tForLang(lang, "prompt.error"));
          return false;
        }

        if (minimumParsed && startOfDay(minimumParsed) >= startOfDay(selectedParsed)) {
          showError(tForLang(lang, "prompt.rangeError"));
          return false;
        }

        draft.selectedDate = formatDatePromptValue(selectedValue);
        persistSetupWizardDraft();
        await persistWizardConfigPatch({ selectedDate: formatISODate(selectedParsed) });
        const limit = subtractDays(selectedParsed, 1);
        log(t("summary.searchingUntil", { date: formatDate(limit) }), "good");
        setSetupWizardStep(3);
        clearError();
        renderSetupWizard();
        return true;
      }
      case 3: {
        await persistWizardConfigPatch({
          autoSelectTime: !!draft.autoSelectTime,
          autoContinueReview: !!draft.autoContinueReview,
          autoFinishAppointment: !!draft.autoFinishAppointment
        });
        setSetupWizardStep(4);
        clearError();
        renderSetupWizard();
        return true;
      }
      case 4:
        await completeSetupWizard(true);
        return true;
      default:
        clearError();
        return false;
    }
  }

  function progressForPhase(phase) {
    const map = {
      idle: 8,
      setup: 12,
      disabled: 0,
      loading: 18,
      location: 30,
      calendar: 62,
      refresh: 62,
      time: 88,
      review: 94,
      finish: 98,
      paused: 72,
      done: 100
    };
    return map[phase] || 8;
  }

  function syncOverlayPhase(phase, phaseLabel, summary) {
    ensureUI();
    setStatus(phaseLabel);
    const summaryEl = document.getElementById("irp-summary");
    if (summaryEl) {
      summaryEl.textContent = summary || "";
    }
    if (phase === "loading") {
      setTimerVisible(false);
    }
    const progress = progressForPhase(phase);
    const bar = document.getElementById("irp-progress-bar");
    if (bar) {
      bar.style.width = `${progress}%`;
    }
    const rocket = document.getElementById("irp-progress-rocket");
    if (rocket) {
      const rocketPosition = Math.max(6, Math.min(96, progress));
      rocket.style.left = `${rocketPosition}%`;
    }
  }

  function renderConsole() {
    ensureUI();
    const logs = document.getElementById("irp-logs");
    logs.replaceChildren(
      ...consoleBuffer.map((entry) => {
        const line = document.createElement("div");
        line.className = `irp-log-line ${entry.tone || "info"}`;
        line.textContent = entry.text;
        return line;
      })
    );
  }

  function log(msg, tone = "info") {
    ensureUI();
    consoleBuffer.push({
      text: `[${new Date().toLocaleTimeString()}] ${msg}`,
      tone
    });
    if (consoleBuffer.length > MAX_CONSOLE_LINES) {
      consoleBuffer = consoleBuffer.slice(-MAX_CONSOLE_LINES);
    }
    renderConsole();
    console.log("[IRP]", msg);
  }

  async function wait(ms, label) {
    setTimerVisible(true);
    try {
      for (let i = Math.floor(ms / 1000); i > 0; i--) {
        if (!CONFIG.enabled) return false;
        setStatus(label);
        setTimer(i);
        await sleep(1000);
      }

      return CONFIG.enabled;
    } finally {
      setTimerVisible(false);
    }
  }

  async function waitFor(condition, timeoutMs = 4000, pollMs = 120) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!CONFIG.enabled) return false;
      try {
        if (condition()) return true;
      } catch (err) {
        // Ignore transient DOM errors while the page is updating.
      }
      await sleep(pollMs);
    }
    return false;
  }

  async function waitForMonthView(startedAt) {
    if (!CONFIG.enabled) return false;
    const elapsed = Date.now() - startedAt;
    const remaining = MIN_MONTH_VIEW_MS - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }

    return CONFIG.enabled;
  }

  function canReloadCalendarPage() {
    try {
      const lastReloadAt = Number(sessionStorage.getItem(CALENDAR_RELOAD_KEY) || 0);
      return !lastReloadAt || Date.now() - lastReloadAt > CALENDAR_RELOAD_COOLDOWN_MS;
    } catch (err) {
      return true;
    }
  }

  function markCalendarReload() {
    try {
      sessionStorage.setItem(CALENDAR_RELOAD_KEY, String(Date.now()));
    } catch (err) {
      // Ignore session storage failures.
    }
  }

  function clearCalendarReloadMark() {
    try {
      sessionStorage.removeItem(CALENDAR_RELOAD_KEY);
    } catch (err) {
      // Ignore session storage failures.
    }
  }

  function reloadCalendarPage(reason, { force = false } = {}) {
    if (!CONFIG.enabled) return false;
    if (!force && !canReloadCalendarPage()) {
      log(reason || t("summary.loadingTimeoutReload"), "warn");
      return false;
    }

    markCalendarReload();
    const message = reason || t("summary.loadingTimeoutReload");
    log(message, "warn");
    setSession({
      phase: "refresh",
      phaseLabel: t("phase.refresh"),
      summary: message
    });
    setTimeout(() => {
      window.location.reload();
    }, 600);
    return true;
  }

  function getRescheduleAppointmentUrl() {
    const locale = getRescheduleLocaleFromPath() || "en";
    return `${window.location.origin}/${locale}/reschedule_appointment/`;
  }

  function restartAppointmentSearch(reason) {
    if (!CONFIG.enabled) return false;

    clearCalendarReloadMark();
    stopDateAlertSound();
    const message = reason || t("summary.restartSearch");
    log(message, "warn");
    setSession({
      phase: "refresh",
      phaseLabel: t("phase.refresh"),
      summary: message,
      timeMode: "",
      timeLabel: ""
    });
    setTimeout(() => {
      window.location.href = getRescheduleAppointmentUrl();
    }, 700);
    return true;
  }

  function isPortalLoading() {
    function isInsideBotUi(el) {
      return !!el?.closest?.("#irp-ui, #irp-date-prompt");
    }

    function intersectsCenter(rect, viewportWidth, viewportHeight) {
      const centerX = viewportWidth / 2;
      const centerY = viewportHeight / 2;
      return (
        rect.left <= centerX &&
        rect.right >= centerX &&
        rect.top <= centerY &&
        rect.bottom >= centerY
      );
    }

    function isLikelyBlockingLoadingElement(el, viewportWidth, viewportHeight) {
      if (!el || isInsideBotUi(el) || !isVisible(el)) return false;

      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;

      const classText = normalizeText(`${el.id || ""} ${el.className || ""}`);
      const text = normalizeText(el.textContent || "");
      const loadingPattern = /(carregando|loading|spinner|loader|busy|wait|aguarde|progress|blockui)/;
      const mentionsLoading = loadingPattern.test(classText) || loadingPattern.test(text);
      if (!mentionsLoading && style.pointerEvents === "none") return false;

      const zIndex = Number.parseInt(style.zIndex || "0", 10);
      const position = style.position;
      const centerHit = intersectsCenter(rect, viewportWidth, viewportHeight);
      const coversLargeArea = rect.width >= viewportWidth * 0.35 && rect.height >= viewportHeight * 0.2;
      const looksLikeOverlay = (position === "fixed" || position === "absolute") && zIndex >= 80;
      const looksLikeCenteredSpinner =
        centerHit &&
        mentionsLoading &&
        rect.width >= 16 &&
        rect.height >= 16 &&
        rect.width <= 240 &&
        rect.height <= 240;

      if (looksLikeOverlay && (coversLargeArea || centerHit)) {
        return true;
      }

      if (looksLikeCenteredSpinner) {
        return true;
      }

      return false;
    }

    const selectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[data-loading="true"]',
      '[data-state="loading"]',
      '#loading',
      '#loadingDiv',
      '#loadingPanel',
      '#loadingOverlay',
      '#overlay',
      '.loading',
      '.loading-overlay',
      '.loader',
      '.spinner',
      '.spinner-container',
      '.blockUI',
      '.ui-loading',
      '.busy',
      '.wait',
      '.modal-backdrop',
      '[class*="loading"]',
      '[class*="spinner"]',
      '[class*="loader"]',
      '[id*="loading"]',
      '[id*="spinner"]',
      '[id*="loader"]'
    ];

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewportWidth || !viewportHeight) {
      return false;
    }

    for (const selector of selectors) {
      const elements = [...document.querySelectorAll(selector)];
      if (elements.some((el) => isLikelyBlockingLoadingElement(el, viewportWidth, viewportHeight))) {
        return true;
      }
    }

    const centerX = Math.max(1, Math.floor(viewportWidth / 2));
    const centerY = Math.max(1, Math.floor(viewportHeight / 2));
    const centerElements = [...document.elementsFromPoint(centerX, centerY)].filter((el) =>
      isLikelyBlockingLoadingElement(el, viewportWidth, viewportHeight)
    );

    return centerElements.length > 0;
  }

  function getVisibleDatepickerRoot() {
    return (
      [...document.querySelectorAll(".ui-datepicker, .datepicker, .datepicker-dropdown, .bootstrap-datetimepicker-widget, .bootstrap-datepicker, .datetimepicker")]
        .find(isVisible) || null
    );
  }

  function hasCalendarReady() {
    const root = getVisibleDatepickerRoot();
    if (root) {
      const cells = [...root.querySelectorAll(".ui-datepicker-calendar td, .datepicker-days td.day, td.day")];
      if (cells.some(isVisible)) return true;
      const calendar = root.querySelector(".ui-datepicker-calendar, .datepicker-days");
      if (calendar && isVisible(calendar)) return true;
    }

    return [
      ...document.querySelectorAll(".ui-datepicker-calendar td, .datepicker-days td.day")
    ].some(isVisible);
  }

  async function waitForPortalReady({ wantCalendar = false, timeoutMs = 15000 } = {}) {
    if (!CONFIG.enabled) return false;
    const deadline = Date.now() + timeoutMs;
    let sawLoading = false;
    let announcedLoading = false;

    while (Date.now() < deadline) {
      if (!CONFIG.enabled) return false;
      const loading = isPortalLoading();
      const structuralReady = wantCalendar
        ? hasCalendarReady()
        : !!findDateInput() || !!getVisibleDatepickerRoot();

      if (structuralReady && !loading) {
        if (sawLoading) {
          setSession({
            summary: wantCalendar
              ? t("summary.calendarReady")
              : t("summary.portalReady")
          });
        }
        return true;
      }

      if (loading) {
        sawLoading = true;
        if (!announcedLoading) {
          announcedLoading = true;
          setPhase(
            "loading",
            t("phase.loading"),
            wantCalendar
              ? t("summary.loadingCalendar")
              : t("summary.loadingPage")
          );
        }
        await sleep(PORTAL_READY_POLL_MS);
        continue;
      }

      await sleep(PORTAL_READY_POLL_MS);
    }

    return CONFIG.enabled
      ? (wantCalendar ? hasCalendarReady() : !!findDateInput() || !!getVisibleDatepickerRoot())
      : false;
  }

  function pageText() {
    return normalizeText(document.body?.innerText || "");
  }

  function findClickable(name) {
    const target = normalizeText(name);
    return (
      queryAllDocuments("button, input[type='button'], input[type='submit'], a, [role='button']")
        .filter(isVisible)
        .find((el) => {
          const label = normalizeText(
            el.innerText || el.value || el.getAttribute("aria-label") || el.title || ""
          );
          return label === target || label.includes(target);
        }) || null
    );
  }

  function clickButton(name, actionKey = name, cooldownMs = 1500) {
    if (wasRecentAction(actionKey, cooldownMs)) return false;
    const btn = findClickable(name);
    if (!btn) return false;
    if (isControlDisabled(btn)) return false;
    markAction(actionKey);
    triggerSyntheticClick(btn);
    return true;
  }

  function triggerSyntheticClick(el) {
    if (!el) return false;
    try {
      el.focus?.();
    } catch (err) {
      // Ignore focus failures on detached or non-focusable elements.
    }

    try {
      el.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
    } catch (err) {
      // Ignore scroll failures for elements inside custom containers.
    }

    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      buttons: 1
    };

    try {
      if (typeof window.PointerEvent === "function") {
        el.dispatchEvent(new PointerEvent("pointerdown", options));
      }
      el.dispatchEvent(new MouseEvent("mousedown", options));
      if (typeof window.PointerEvent === "function") {
        el.dispatchEvent(new PointerEvent("pointerup", options));
      }
      el.dispatchEvent(new MouseEvent("mouseup", options));
      el.dispatchEvent(new MouseEvent("click", options));
    } catch (err) {
      // Fall back to the native click below.
    }

    return true;
  }

  function resolveInteractiveTimeTarget(el) {
    if (!el) return null;
    const interactiveSelectors = "button, input[type='button'], input[type='submit'], a, label, [role='button'], [role='option'], li, td, [onclick], [data-handler], [data-action], input[type='radio'], input[type='checkbox']";

    if (typeof el.matches === "function" && el.matches(interactiveSelectors)) {
      return el;
    }

    const parent = typeof el.closest === "function" ? el.closest(interactiveSelectors) : null;
    if (parent && isVisible(parent)) {
      return parent;
    }

    return el;
  }

  function findLocationSelect() {
    const selects = [...document.querySelectorAll("select")];
    let best = null;
    let bestScore = 0;

    for (const select of selects) {
      const optionTexts = [...select.options].map((o) => normalizeText(o.textContent));
      let score = 0;

      if (optionTexts.some((text) => text.includes("dublin") && text.includes("burgh"))) {
        score = 3;
      } else if (optionTexts.some((text) => text.includes("burgh"))) {
        score = 2;
      } else if (optionTexts.some((text) => text.includes("dublin"))) {
        score = 1;
      }

      if (isVisible(select)) {
        score += 0.5;
      }

      if (score > bestScore) {
        best = select;
        bestScore = score;
      }
    }

    return best;
  }

  function selectDublin() {
    const select = findLocationSelect();
    if (!select) return false;

    const option =
      [...select.options].find((o) => {
        const text = normalizeText(o.textContent);
        return text.includes("dublin") && text.includes("burgh");
      }) ||
      [...select.options].find((o) => normalizeText(o.textContent).includes("dublin"));

    if (!option) return false;

    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return true;
  }

  function locationLooksReady() {
    const select = findLocationSelect();
    if (select) {
      const selectedText = normalizeText(select.selectedOptions?.[0]?.textContent || "");
      return selectedText.includes("dublin") && selectedText.includes("burgh");
    }

    const text = pageText();
    return text.includes("dublin") && text.includes("burgh");
  }

  function findDateInput() {
    return (
      [...document.querySelectorAll("input")].find((input) => {
        const text = normalizeText(
          `${input.placeholder || ""} ${input.id || ""} ${input.name || ""} ${input.getAttribute("aria-label") || ""}`
        );
        return text.includes("dd/mm/yyyy") || text.includes("appointment date") || text.includes("select date");
      }) || null
    );
  }

  function openCalendarIfNeeded() {
    const calendar = getVisibleDatepickerRoot();
    if (calendar) return true;

    const input = findDateInput();
    if (input) {
      triggerSyntheticClick(input);
      input.focus();
      return true;
    }

    const calendarButton = [...document.querySelectorAll("button, span, a, i")]
      .filter(isVisible)
      .find((el) => {
        const label = normalizeText(
          `${el.innerText || ""} ${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`
        );
        return label.includes("calendar") || label.includes("date");
      });

    if (calendarButton) {
      triggerSyntheticClick(calendarButton);
      return true;
    }

    return false;
  }

  function getDisplayedMonthMeta() {
    const root = getVisibleDatepickerRoot() || document;
    const candidates = [
      ".ui-datepicker-title",
      ".datepicker-switch",
      ".month"
    ];

    for (const selector of candidates) {
      const el = root.querySelector(selector) || document.querySelector(selector);
      const text = normalizeText(el?.textContent || "");
      const match = text.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{4})\b/);
      if (match) {
        return {
          monthIndex: MONTHS[match[1]],
          year: Number(match[2]),
          label: text
        };
      }
    }

    return null;
  }

  function getDisplayedMonthDate() {
    const meta = getDisplayedMonthMeta();
    if (!meta || meta.monthIndex === undefined || Number.isNaN(meta.year)) return null;
    return new Date(meta.year, meta.monthIndex, 1);
  }

  function getMonthKey(date) {
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function adjustDatepickerMonthWithApi(direction) {
    const input = findDateInput();
    const jq = window.jQuery || window.$;
    const api = jq?.datepicker || window.datepicker;
    if (!input || !api || typeof api._adjustDate !== "function") {
      return false;
    }

    try {
      if (typeof api._showDatepicker === "function") {
        api._showDatepicker(input);
      }
    } catch (err) {
      // Showing the widget is best-effort only.
    }

    try {
      api._adjustDate(input.id || input, direction === "next" ? 1 : -1, "M");
      return true;
    } catch (err) {
      return false;
    }
  }

  function resolveMonthControlTarget(el) {
    if (!el) return null;
    return el.closest?.("a, button, th, td, [role='button']") || el;
  }

  function clickPreviousMonth() {
    const selectors = [
      ".ui-datepicker-prev",
      ".ui-datepicker-prev a",
      ".ui-datepicker-prev span",
      "[data-handler='prev']",
      "[aria-label*='prev' i]",
      "[aria-label*='previous' i]",
      "[title*='Prev' i]",
      "[title*='Previous' i]"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        triggerSyntheticClick(el);
        return true;
      }
    }

    const fallback = [...document.querySelectorAll(".ui-datepicker button, .ui-datepicker a, .ui-datepicker span, button, a, span")]
      .filter(isVisible)
      .find((el) => {
        const label = normalizeText(
          `${el.innerText || ""} ${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`
        );
        return label.includes("prev") || label.includes("previous") || label.includes("left") || label.includes("Â«") || label.includes("â€¹") || label.includes("<");
      });

    if (fallback) {
      triggerSyntheticClick(resolveMonthControlTarget(fallback));
      return true;
    }

    return false;
  }

  function clickNextMonth() {
    const selectors = [
      ".ui-datepicker-next",
      ".ui-datepicker-next a",
      ".ui-datepicker-next span",
      "[data-handler='next']",
      "[aria-label*='next' i]",
      "[title*='Next' i]",
      "[title*='next' i]"
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        triggerSyntheticClick(el);
        return true;
      }
    }

    const fallback = [...document.querySelectorAll(".ui-datepicker button, .ui-datepicker a, .ui-datepicker span, button, a, span")]
      .filter(isVisible)
      .find((el) => {
        const label = normalizeText(
          `${el.innerText || ""} ${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`
        );
        return label.includes("next") || label.includes("right") || label.includes("Â»") || label.includes("â€º") || label.includes(">");
      });

    if (fallback) {
      triggerSyntheticClick(resolveMonthControlTarget(fallback));
      return true;
    }

    return false;
  }

  async function waitForMonthChange(previousMonthKey, timeoutMs = 4000) {
    return waitFor(() => {
      const current = getDisplayedMonthDate();
      const currentKey = getMonthKey(current);
      return currentKey && currentKey !== previousMonthKey;
    }, timeoutMs);
  }

  function clickCalendarMonth(direction) {
    if (adjustDatepickerMonthWithApi(direction)) {
      return true;
    }

    const root = getVisibleDatepickerRoot() || document;
    const selectors = direction === "next"
      ? [
          ".ui-datepicker-next",
          ".ui-datepicker-next a",
          ".ui-datepicker-next span",
          ".datepicker .next",
          ".datepicker .next span",
          ".datepicker-days .next",
          ".datepicker-days .next span",
          ".datepicker table thead th.next",
          ".datepicker table thead .next",
          "[data-handler='next']",
          "[aria-label*='next' i]",
          "[title*='Next' i]",
          "[title*='next' i]"
        ]
      : [
          ".ui-datepicker-prev",
          ".ui-datepicker-prev a",
          ".ui-datepicker-prev span",
          ".datepicker .prev",
          ".datepicker .prev span",
          ".datepicker-days .prev",
          ".datepicker-days .prev span",
          ".datepicker table thead th.prev",
          ".datepicker table thead .prev",
          "[data-handler='prev']",
          "[aria-label*='prev' i]",
          "[aria-label*='previous' i]",
          "[title*='Prev' i]",
          "[title*='Previous' i]"
        ];

    for (const selector of selectors) {
      const el = root.querySelector(selector) || document.querySelector(selector);
      if (el && isVisible(el)) {
        triggerSyntheticClick(resolveMonthControlTarget(el));
        return true;
      }
    }

    const fallback = [...root.querySelectorAll("button, a, span, th, td, [role='button']")]
      .filter(isVisible)
      .find((el) => {
        const label = normalizeText(
          `${el.innerText || ""} ${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`
        );
        return direction === "next"
          ? label.includes("next") || label.includes("right") || label.includes("Â»") || label.includes("â€º") || label.includes(">")
          : label.includes("prev") || label.includes("previous") || label.includes("left") || label.includes("Â«") || label.includes("â€¹") || label.includes("<");
      });

    if (fallback) {
      triggerSyntheticClick(fallback);
      return true;
    }

    const jQueryApi = window.jQuery || window.$;
    if (jQueryApi?.fn) {
      const picker = jQueryApi(".ui-datepicker:visible, .datepicker:visible, .datepicker-dropdown:visible, .bootstrap-datetimepicker-widget:visible").first();
      if (picker.length) {
        const target = direction === "next"
          ? picker.find(".ui-datepicker-next, [data-handler='next']").first()
          : picker.find(".ui-datepicker-prev, [data-handler='prev']").first();
        if (target.length) {
          target.trigger("mousedown");
          target.trigger("mouseup");
          target.trigger("click");
          return true;
        }
      }
    }

    const input = findDateInput();
    if (input) {
      try {
        input.focus?.();
        const key = direction === "next" ? "PageDown" : "PageUp";
        const keyCode = direction === "next" ? 34 : 33;
        const eventInit = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, view: window };
        input.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        input.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        input.dispatchEvent(new KeyboardEvent("keyup", eventInit));
        return true;
      } catch (err) {
        // Ignore keyboard fallback failures and keep trying the month move loop.
      }
    }

    return false;
  }

  async function moveCalendarMonth(direction, previousMonthKey) {
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!clickCalendarMonth(direction)) {
        await sleep(120);
        continue;
      }

      if (await waitForMonthChange(previousMonthKey, attempt < 2 ? 3200 : 6500)) {
        return true;
      }
      await sleep(180);
    }
    return false;
  }

  function getCalendarCells() {
    const root = getVisibleDatepickerRoot() || document;
    return [
      ...root.querySelectorAll(".ui-datepicker-calendar td"),
      ...root.querySelectorAll(".datepicker-days td.day"),
      ...root.querySelectorAll(".bootstrap-datetimepicker-widget td.day"),
      ...root.querySelectorAll(".datepicker td.day")
    ];
  }

  function parseCellDate(cell, fallbackMonthMeta) {
    const dataDate = cell.getAttribute("data-date");
    if (dataDate !== null && dataDate !== "") {
      const parsed = Number(dataDate);
      if (!Number.isNaN(parsed)) {
        const millis = parsed < 1e12 ? parsed * 1000 : parsed;
        const date = new Date(millis);
        if (!Number.isNaN(date.getTime())) return date;
      }
    }

    const dayText = normalizeText(cell.textContent || "");
    const dayMatch = dayText.match(/\b(\d{1,2})\b/);
    if (!dayMatch) return null;

    const day = Number(dayMatch[1]);
    const monthValue = cell.getAttribute("data-month");
    const yearValue = cell.getAttribute("data-year");

    const monthIndex = monthValue !== null && monthValue !== "" ? Number(monthValue) : fallbackMonthMeta?.monthIndex;
    const year = yearValue !== null && yearValue !== "" ? Number(yearValue) : fallbackMonthMeta?.year;

    if (Number.isNaN(day) || Number.isNaN(monthIndex) || Number.isNaN(year)) return null;

    return new Date(year, monthIndex, day);
  }

  function sameMonth(a, b) {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function isSelectableDateCell(cell) {
    if (!cell || !isVisible(cell)) return false;
    const classes = cell.classList;
    if (classes.contains("ui-state-disabled")) return false;
    if (classes.contains("disabled")) return false;
    if (classes.contains("unavailable")) return false;
    if (classes.contains("old") || classes.contains("new")) {
      const root = getVisibleDatepickerRoot();
      if (root && root.classList.contains("datepicker")) {
        // Bootstrap datepicker uses old/new for adjacent months.
        // We still allow them if the visible month filter later accepts the cell.
      }
    }
    if (classes.contains("ui-datepicker-other-month") && !cell.querySelector("a, button, [role='button']")) return false;
    if (cell.hasAttribute("data-handler") || cell.hasAttribute("onclick") || cell.getAttribute("role") === "button") return true;
    if (classes.contains("day")) return true;
    if (cell.querySelector("a, button, [role='button']")) return true;
    const cursor = getComputedStyle(cell).cursor;
    return cursor === "pointer" || cursor === "hand" || classes.contains("available") || classes.contains("enabled");
  }

  function getSearchFloorDate() {
    return parseConfiguredDate(CONFIG.minimumDate) || parseFlexibleDate("20/05");
  }

  function isControlDisabled(el) {
    if (!el) return true;
    if ("disabled" in el && el.disabled) return true;
    if (String(el.getAttribute?.("aria-disabled") || "").toLowerCase() === "true") return true;
    return !!(el.classList?.contains("disabled") || el.classList?.contains("is-disabled"));
  }

  function shouldAutoAdvanceAfterDate() {
    return !!CONFIG.autoSelectTime;
  }

  function pauseAfterDateFound(candidateLabel) {
    state.pauseAfterDate = true;
    CONFIG.enabled = false;
    stopBotLoop({ stopAlert: false });
    void unlockDateAlertSound();
    startDateAlertSound();

    log(t("log.dateFoundPaused", { date: candidateLabel }), "warn");
    setSession({
      phase: "paused",
      phaseLabel: t("phase.paused"),
      summary: t("summary.dateFoundPaused", { date: candidateLabel }),
      monthLabel: getDisplayedMonthDate() ? formatMonthYear(getDisplayedMonthDate()) : "",
      dayLabel: candidateLabel,
      timeMode: "",
      timeLabel: ""
    });

    chrome.storage.sync.set({ enabled: false });
    updateOverlayCopy();
    syncBotLoop();
  }

  function clickDateCell(cell) {
    const target = cell.querySelector("a, button, [role='button']") || cell;
    if (!target) return false;
    markAction("date");
    triggerSyntheticClick(target);
    return true;
  }

  function findBestAvailableDate(thresholdDate, floorDate = null, visibleMonthDate = null) {
    const monthMeta = getDisplayedMonthMeta();
    const maxAllowedDate = thresholdDate ? startOfDay(subtractDays(thresholdDate, 1)) : null;
    const minAllowedDate = floorDate ? startOfDay(floorDate) : null;
    const activeMonth = visibleMonthDate ? startOfMonth(visibleMonthDate) : null;
    const candidates = [];

    for (const cell of getCalendarCells()) {
      if (!isSelectableDateCell(cell)) continue;
      const date = parseCellDate(cell, monthMeta);
      if (!date) continue;
      if (activeMonth && !sameMonth(date, activeMonth)) continue;
      if (minAllowedDate && startOfDay(date) < minAllowedDate) continue;
      if (maxAllowedDate && startOfDay(date) > maxAllowedDate) continue;
      candidates.push({ date, cell });
    }

    // Pick the earliest available date inside the current window/month.
    candidates.sort((a, b) => a.date - b.date);
    return candidates[0] || null;
  }

  function findDateValue() {
    const input = findDateInput();
    return input ? String(input.value || "").trim() : "";
  }

  function findTimeSelect() {
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s?(?:am|pm))?\b/i;

    return (
      queryAllDocuments("select").find((select) => {
        const labels = [...select.options].map((opt) => normalizeText(opt.textContent));
        return labels.some((text) => timePattern.test(text));
      }) || null
    );
  }

  function findTimeCandidate() {
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s?(?:am|pm))?\b/i;
    const exactTimePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/;
    const selectors = [
      "button",
      "input",
      "a",
      "label",
      "[role='button']",
      "[role='option']",
      "li",
      "div",
      "span",
      "td"
    ];
    const candidates = [];

    for (const el of queryAllDocuments(selectors.join(", "))) {
      if (!isVisible(el)) continue;
      const text = normalizeText(
        [
          el.innerText || "",
          el.textContent || "",
          el.getAttribute("aria-label") || "",
          el.title || "",
          el.getAttribute("data-time") || "",
          el.getAttribute("data-slot") || "",
          el.getAttribute("data-value") || "",
          el.getAttribute("data-start") || "",
          el.getAttribute("data-end") || "",
          el.getAttribute("value") || ""
        ].join(" ")
      );
      if (!text || !timePattern.test(text)) continue;

      const matches = text.match(/\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/g) || [];
      if (!matches.length) continue;
      if (text.includes("select time") || text.includes("choose time")) continue;

      const rect = el.getBoundingClientRect();
      const area = Math.max(1, rect.width * rect.height);
      const tag = String(el.tagName || "").toLowerCase();
      const role = String(el.getAttribute("role") || "").toLowerCase();
      const cursor = getComputedStyle(el).cursor;
      const directText = normalizeText(el.childElementCount === 0 ? (el.innerText || el.textContent || "") : "");
      let score = 0;

      if (tag === "button" || tag === "a" || tag === "label") score += 6;
      if (role === "button" || role === "option") score += 5;
      if (cursor === "pointer" || cursor === "hand") score += 3;
      if (directText && exactTimePattern.test(directText)) score += 3;
      if (el.children.length === 0) score += 2;
      if (text.length <= 8) score += 2;
      if (text.length <= 12) score += 1;
      if (matches.length > 1) score -= (matches.length - 1) * 2;
      if (matches.length === 1) score += 2;
      score += Math.max(0, 2400 - area) / 1000;

      candidates.push({ el, score, area });
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.area - b.area;
    });

    return candidates[0]?.el || null;
  }

  function selectFirstTimeOption(select) {
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s?(?:am|pm))?\b/i;
    const option = [...select.options].find((opt) => {
      const text = normalizeText(opt.textContent);
      if (!text || /select|choose|time|--/.test(text) && !timePattern.test(text)) return false;
      return timePattern.test(text);
    });

    if (!option) return false;

    if (select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    markAction("time-select");
    return option.textContent.trim();
  }

  function findTimeRadio() {
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s?(?:am|pm))?\b/i;
    const radios = queryAllDocuments("input[type='radio']").filter((input) => !input.disabled && isVisible(input));

    return (
      radios.find((radio) => {
        const id = radio.id;
        const label =
          (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
          radio.closest("label");
        const text = normalizeText(label?.textContent || "");
        return timePattern.test(text);
      }) || null
    );
  }

  function clickTimeElement() {
    const elements = resolveInteractiveTimeTarget(findTimeCandidate());

    if (!elements) return null;
    markAction("time-click");
    triggerSyntheticClick(elements);
    try {
      elements.click?.();
    } catch (err) {
      // Ignore native click failures and keep the synthetic path.
    }
    return elements.textContent.trim();
  }

  function selectFirstAvailableTime() {
    const select = findTimeSelect();
    if (select) {
      const selectedLabel = selectFirstTimeOption(select);
      if (selectedLabel) return selectedLabel;
    }

    const radio = findTimeRadio();
    if (radio) {
      markAction("time-radio");
      const target = resolveInteractiveTimeTarget(radio);
      triggerSyntheticClick(target);
      try {
        target?.click?.();
      } catch (err) {
        // Ignore native click failures and keep the synthetic path.
      }
      const label = radio.closest("label") || document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
      return (label?.textContent || radio.nextElementSibling?.textContent || radio.value || radio.id || "Time").trim();
    }

    return clickTimeElement();
  }

  function looksLikeTimeStep() {
    if (findTimeSelect() || findTimeRadio()) return true;
    const timePattern = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s?(?:am|pm))?\b/i;
    return queryAllDocuments("button, input, a, label, span, div, li")
      .filter(isVisible)
      .some((el) => timePattern.test(normalizeText(`${el.innerText || ""} ${el.textContent || ""}`)));
  }

  async function ensureLocationSelected() {
    setPhase(
      "location",
      t("phase.location"),
      t("summary.openingLocation"),
      { locationLabel: "Dublin Burgh Quay" }
    );

    if (!selectDublin()) {
      log(t("log.locationFieldMissing"), "warn");
      setSession({ summary: t("summary.locationMissing") });
      return false;
    }

    await sleep(700);

    if (locationLooksReady()) {
      log(t("log.dublinSelected"), "good");
      pushCheckpoint(t("checkpoint.location"), "Dublin Burgh Quay");
      setSession({
        phase: "location",
        phaseLabel: t("phase.locationSelected"),
        summary: t("summary.locationReady"),
        locationLabel: "Dublin Burgh Quay"
      });
      return true;
    }

    const ready = await waitFor(locationLooksReady, 5000);
    if (!CONFIG.enabled) return false;
    if (!ready) {
      log(t("log.locationDidNotSettle"), "warn");
      setSession({ summary: t("summary.locationNotReady") });
    } else {
      pushCheckpoint(t("checkpoint.location"), "Dublin Burgh Quay");
      setSession({
        phase: "location",
        phaseLabel: t("phase.locationSelected"),
        summary: t("summary.locationReady"),
        locationLabel: "Dublin Burgh Quay"
      });
    }

    return ready;
  }

  async function handleDatePage() {
    if (!isRescheduleAppointmentPage()) return;

    const { selectedDate, searchLimitDate } = getSelectedDateContext();
    const selectedDateLabel = selectedDate ? formatDate(selectedDate) : "";
    const searchLimitLabel = searchLimitDate ? formatDate(searchLimitDate) : "";
    const hasSelectedDate = !!selectedDate;

    if (!hasSelectedDate) {
      const prompt = t("summary.noDateConfig");
      if (!wasRecentAction("missing-date-config", 30000)) {
        log(prompt, "warn");
        markAction("missing-date-config");
      }
      setSession({
        phase: "idle",
        phaseLabel: t("phase.ready"),
        summary: prompt,
        monthLabel: "",
        dayLabel: "",
        timeLabel: "",
        searchLimitLabel: "",
        selectedDateLabel: ""
      });
      return;
    }

    setPhase(
      "calendar",
      t("phase.calendar"),
      searchLimitLabel
        ? t("summary.searchingUntil", { date: searchLimitLabel })
        : t("summary.waitingAvailable"),
      {
        selectedDateLabel,
        searchLimitLabel,
        dayLabel: searchLimitLabel || ""
      }
    );

    if (searchLimitLabel) {
      pushCheckpoint(t("checkpoint.limit"), searchLimitLabel);
    }

    log(t("log.datePage"));
    const portalReady = await waitForPortalReady({
      wantCalendar: false,
      timeoutMs: CALENDAR_LOAD_TIMEOUT_MS
    });

    if (!CONFIG.enabled) return;
    if (!portalReady) {
      reloadCalendarPage(t("summary.loadingTimeoutReload"));
      return;
    }

    if (!openCalendarIfNeeded()) {
      log(t("log.calendarNotFound"), "warn");
      setSession({ summary: t("summary.calendarMissing") });
      reloadCalendarPage(t("summary.loadingTimeoutReload"));
      return;
    }

    const calendarReady = await waitFor(hasCalendarReady, 4000, 150);
    if (!CONFIG.enabled) return;
    if (!calendarReady) {
      log(t("summary.loadingCalendar"), "warn");
      setSession({ summary: t("summary.loadingCalendar") });
      reloadCalendarPage(t("summary.loadingTimeoutReload"));
      return;
    }

    clearCalendarReloadMark();

    const searchFloorDate = getSearchFloorDate();
    const searchFloorLabel = searchFloorDate ? formatDate(searchFloorDate) : "";

    if (selectedDate) {
      log(t("log.searchingBefore", { date: formatDate(selectedDate) }));
    } else {
      log(t("log.exploringMonths"), "warn");
    }

    if (searchFloorLabel && searchLimitLabel) {
      log(
        t("summary.searchWindow", {
          from: searchFloorLabel,
          to: searchLimitLabel
        }),
        "info"
      );
    }

    const targetMonth = hasSelectedDate ? startOfMonth(selectedDate) : null;
    const initialMonth = getDisplayedMonthDate();
    const searchForward = !targetMonth || !initialMonth
      ? true
      : compareMonths(initialMonth, targetMonth) <= 0;
    const monthAttempts = new Map();
    const maxSteps = hasSelectedDate ? 24 : 14;

    for (let step = 0; step < maxSteps; step++) {
      const monthObservedAt = Date.now();
      const displayedMonth = getDisplayedMonthDate();
      const monthKey = getMonthKey(displayedMonth) || `unknown-${step}`;
      const monthLabel = displayedMonth ? formatMonthYear(displayedMonth) : "Mes desconhecido";
      const monthLimit = searchLimitLabel ? ` ${t("summary.searchingUntil", { date: searchLimitLabel })}` : "";
      const attempts = (monthAttempts.get(monthKey) || 0) + 1;
      monthAttempts.set(monthKey, attempts);

      setSession({
        phase: "calendar",
        phaseLabel: t("phase.calendar"),
        summary: t("summary.analyzingMonth", {
          month: monthLabel,
          limit: monthLimit
        }),
        monthLabel
      });

      log(
        t("summary.analyzingMonth", {
          month: monthLabel,
          limit: monthLimit
        }),
        "info"
      );

      if (monthLabel && monthLabel !== "Mes desconhecido") {
        pushCheckpoint(t("checkpoint.month"), monthLabel);
      }

      if (attempts === 6) {
        log(t("log.noMatchRefresh"), "warn");
      }

      const candidate = findBestAvailableDate(selectedDate, searchFloorDate, displayedMonth);
      if (candidate) {
        const candidateLabel = formatDate(candidate.date);
        clickDateCell(candidate.cell);
        log(t("log.dateSelected", { date: candidateLabel }), "good");
        pushCheckpoint(t("checkpoint.date"), candidateLabel);
        await commitSelectedDate(candidate.date);
        if (!shouldAutoAdvanceAfterDate()) {
          pauseAfterDateFound(candidateLabel);
          return;
        }

        stopDateAlertSound();
        setSession({
          phase: "time",
          phaseLabel: t("phase.time"),
          summary: t("summary.datePicked", { date: candidateLabel }),
          timeMode: "auto",
          dayLabel: candidateLabel
        });
        await sleep(1000);
        if (!CONFIG.enabled) return;

        if (await waitFor(looksLikeTimeStep, 2500)) {
          setTimeout(run, 120);
          return;
        }
        if (!CONFIG.enabled) return;

        if (findClickable("continue")) {
          clickButton("continue", "continue-after-date", 4000);
        }

        setTimeout(run, 120);
        return;
      }

      if (!hasSelectedDate) {
        setSession({
          summary: t("summary.waitingAvailable")
        });
        const nextKey = monthKey;
        if (!(await moveCalendarMonth("next", nextKey))) {
          await sleep(250);
          continue;
        }
        const nextMonth = getDisplayedMonthDate();
        if (nextMonth) {
          const nextMonthLabel = formatMonthYear(nextMonth);
          log(t("log.monthAdvanced", { month: nextMonthLabel }), "info");
          setSession({
            summary: t("summary.goingNext", { month: nextMonthLabel }),
            monthLabel: nextMonthLabel
          });
        }
        continue;
      }

      setSession({
        summary: targetMonth && displayedMonth && compareMonths(displayedMonth, targetMonth) < 0
          ? t("summary.goingNext", { month: monthLabel })
          : t("summary.analyzingMonth", {
              month: monthLabel,
              limit: monthLimit
            })
      });

      if (targetMonth && displayedMonth) {
        const monthComparison = compareMonths(displayedMonth, targetMonth);
        if (monthComparison === 0) {
          await waitForMonthView(monthObservedAt);
          if (!CONFIG.enabled) return;
          break;
        }

      if (searchForward && monthComparison < 0) {
          await waitForMonthView(monthObservedAt);
          if (!CONFIG.enabled) return;
          const nextKey = monthKey;
          if (!(await moveCalendarMonth("next", nextKey))) {
            log(t("log.noMatchRefresh"), "warn");
            await sleep(250);
            continue;
          }
          const nextMonth = getDisplayedMonthDate();
          if (nextMonth) {
            const nextMonthLabel = formatMonthYear(nextMonth);
            log(t("log.monthAdvanced", { month: nextMonthLabel }), "info");
            setSession({
              summary: t("summary.goingNext", { month: nextMonthLabel }),
              monthLabel: nextMonthLabel
            });
          }
          continue;
        }

        if (!searchForward && monthComparison > 0) {
          await waitForMonthView(monthObservedAt);
          if (!CONFIG.enabled) return;
          const previousKey = monthKey;
          if (!(await moveCalendarMonth("previous", previousKey))) {
            log(t("log.noMatchRefresh"), "warn");
            await sleep(250);
            continue;
          }
          const previousMonth = getDisplayedMonthDate();
          if (previousMonth) {
            const previousMonthLabel = formatMonthYear(previousMonth);
            log(t("log.monthRewind", { month: previousMonthLabel }), "info");
            setSession({
              summary: t("summary.goingPrevious", { month: previousMonthLabel }),
              monthLabel: previousMonthLabel
            });
          }
          continue;
        }

        break;
      }

      await waitForMonthView(monthObservedAt);
      if (!CONFIG.enabled) return;
      break;
    }

    log(t("log.noMatchRefresh"), "warn");
    setPhase(
      "refresh",
      t("phase.refresh"),
      t("summary.noMatchRefresh"),
      {
        monthLabel: getDisplayedMonthDate() ? formatMonthYear(getDisplayedMonthDate()) : "",
        dayLabel: ""
      }
    );
    reloadCalendarPage(t("summary.noMatchRefresh"), { force: true });
  }

  async function handleTimePage() {
    if (!CONFIG.autoSelectTime) {
      stopDateAlertSound();
      if (sessionState.timeMode !== "manual") {
        if (!wasRecentAction("manual-time", 15000)) {
          log(t("summary.manualTime"), "warn");
          markAction("manual-time");
        }
        setPhase(
          "time",
          t("phase.timeManual"),
          t("summary.manualTime"),
          {
            timeMode: "manual",
            timeLabel: ""
          }
        );
      }
      return;
    }

    setPhase("time", t("phase.time"), t("summary.timeSearching"));
    log(t("log.timeStep"));
    await wait(1200, t("wait.time"));
    if (!CONFIG.enabled) return;

    const selectedTime = selectFirstAvailableTime();
    if (selectedTime) {
      log(t("log.timeSelected"), "good");
      pushCheckpoint(t("checkpoint.time"), selectedTime);
      setSession({
        phase: "time",
        phaseLabel: t("phase.timeSelected"),
        summary: t("summary.timePicked", { time: selectedTime }),
        timeMode: "auto",
        timeLabel: selectedTime
      });
      await sleep(700);
      if (!CONFIG.enabled) return;
    } else {
      log(t("log.timeControlMissing"), "warn");
      setSession({ summary: t("summary.timeMissing") });
    }

    const continueReady = await waitFor(() => {
      const btn = findClickable("continue");
      return btn && !isControlDisabled(btn);
    }, 8000, 150);
    if (!CONFIG.enabled) return;
    if (!continueReady) {
      log(t("log.timeControlMissing"), "warn");
      setSession({ summary: t("summary.timeMissing") });
      const retryTime = selectFirstAvailableTime();
      if (retryTime) {
        pushCheckpoint(t("checkpoint.time"), retryTime);
        await waitFor(() => {
          const btn = findClickable("continue");
          return btn && !isControlDisabled(btn);
        }, 2500, 150);
      }
      if (!CONFIG.enabled) return;
    }

    if (!clickButton("continue", "continue-time", 4000)) {
      await sleep(500);
      if (!CONFIG.enabled) return;
      clickButton("continue", "continue-time", 4000);
    }
    stopDateAlertSound();
  }

  function looksLikeReviewPage() {
    const page = pageText();
    return (
      page.includes("review and confirm") ||
      page.includes("selected date, time, and location") ||
      (page.includes("please review") && page.includes("continue"))
    );
  }

  function looksLikeFinishPage() {
    const page = pageText();
    return !!findClickable("finish") || page.includes("finish");
  }

  async function handleReviewPage() {
    if (!CONFIG.enabled) return;

    if (!CONFIG.autoContinueReview) {
      setPhase("review", t("phase.reviewManual"), t("summary.reviewManual"));
      return;
    }

    setPhase("review", t("phase.review"), t("summary.reviewPage"));
    if (!wasRecentAction("review-page", 10000)) {
      log(t("summary.reviewPage"));
      markAction("review-page");
    }
    await waitFor(() => !!findClickable("continue"), 3000);
    if (!CONFIG.enabled) return;
    if (clickButton("continue", "continue-review", 4000)) {
      setTimeout(run, 120);
      return;
    }

    setPhase("review", t("phase.reviewManual"), t("summary.reviewManual"));
  }

  async function handleFinishPage() {
    if (!CONFIG.enabled) return;

    if (!CONFIG.autoFinishAppointment) {
      setPhase("finish", t("phase.finishManual"), t("summary.finishManual"));
      return;
    }

    setPhase("finish", t("phase.finish"), t("summary.finishPage"));
    if (!wasRecentAction("finish-page", 10000)) {
      log(t("summary.finishPage"));
      markAction("finish-page");
    }
    await waitFor(() => !!findClickable("finish"), 3000);
    if (!CONFIG.enabled) return;
    if (clickButton("finish", "finish-appointment", 4000)) {
      const confirmedDate = parseFlexibleDate(sessionState.dayLabel || "");
      if (confirmedDate) {
        await commitSelectedDate(confirmedDate);
      }
      restartAppointmentSearch(t("summary.restartSearch"));
      return;
    }

    setPhase("finish", t("phase.finishManual"), t("summary.finishManual"));
  }

  async function run() {
    if (!isRescheduleAppointmentPage()) {
      stopBotLoop();
      removeBotOverlay();
      return;
    }

    if (shouldShowSetupWizard()) {
      if (CONFIG.enabled) {
        CONFIG.enabled = false;
        chrome.storage.sync.set({ enabled: false });
        updateOverlayCopy();
      }
      stopBotLoop();
      syncDatePromptVisibility();
      setSession({
        phase: "setup",
        phaseLabel: t("phase.setup"),
        summary: getSetupPendingSummary(),
        monthLabel: "",
        dayLabel: "",
        timeLabel: "",
        searchLimitLabel: "",
        selectedDateLabel: ""
      });
      return;
    }

    if (state.pauseAfterDate) {
      return;
    }

    if (state.running) return;
    if (!hasConfiguredDate()) {
      stopBotLoop();
      syncDatePromptVisibility();
      const prompt = t("summary.noDateConfig");
      if (!wasRecentAction("missing-date-config", 30000)) {
        log(prompt, "warn");
        markAction("missing-date-config");
      }
      if (!(sessionState.phase === "idle" && sessionState.summary === prompt)) {
        setSession({
          phase: "idle",
          phaseLabel: t("phase.ready"),
          summary: prompt,
          monthLabel: "",
          dayLabel: "",
          timeLabel: "",
          searchLimitLabel: "",
          selectedDateLabel: ""
        });
      }
      return;
    }
    if (!CONFIG.enabled) return;
    syncBotLoop();
    state.running = true;

    try {
      const page = pageText();
      const dateValue = findDateValue();
      const hasChosenDate = !!normalizeText(dateValue) && !/^dd\/mm(?:\/yyyy)?$/.test(normalizeText(dateValue));
      const hasDateStep = page.includes("select date") || page.includes("appointment date");
      const hasTimeStep = page.includes("select time") || looksLikeTimeStep();

      if (page.includes("before proceeding")) {
        log(t("log.initialPage"));
        await wait(3000, t("wait.intro"));
        if (!CONFIG.enabled) return;
        clickButton("continue", "continue-intro", 5000);
        setTimeout(run, 120);
        return;
      }

      if (page.includes("select location")) {
        log(t("log.locationPage"));
        await wait(Math.max(Number(CONFIG.delayLocation || 0), 6000), t("wait.location"));
        if (!CONFIG.enabled) return;
        if (await ensureLocationSelected()) {
          await waitFor(() => !!findClickable("continue"), 3000);
          if (!CONFIG.enabled) return;
          if (clickButton("continue", "continue-location", 5000)) {
            const portalReady = await waitForPortalReady({
              wantCalendar: false,
              timeoutMs: CALENDAR_LOAD_TIMEOUT_MS
            });
            if (!CONFIG.enabled) return;
            if (!portalReady) {
              reloadCalendarPage(t("summary.loadingTimeoutReload"));
              return;
            }
            setTimeout(run, 120);
          }
        }
        return;
      }

      if (hasTimeStep && hasChosenDate) {
        await handleTimePage();
        return;
      }

      if (isRescheduleAppointmentPage() && hasDateStep) {
        await handleDatePage();
        return;
      }

      if (looksLikeReviewPage()) {
        await handleReviewPage();
        return;
      }

      if (looksLikeFinishPage()) {
        await handleFinishPage();
        return;
      }
    } catch (err) {
      log(t("summary.botError", { message: err?.message || err }), "error");
    } finally {
      state.running = false;
    }
  }

  function refreshSessionFromConfig(forceReset = false) {
    const hasDates = hasConfiguredDate();
    if (!hasDates) {
      setSetupWizardDone(false);
    }
    const setupPending = !hasDates || shouldShowSetupWizard();
    const { selectedDate, searchLimitDate } = getSelectedDateContext();
    const selectedDateLabel = selectedDate ? formatDate(selectedDate) : "";
    const searchLimitLabel = hasDates && searchLimitDate ? formatDate(searchLimitDate) : "";
    if (!hasDates) {
      const prompt = setupPending ? getSetupPendingSummary() : t("summary.noDateConfig");
      setSession({
        phase: "idle",
        phaseLabel: setupPending ? t("phase.setup") : t("phase.ready"),
        summary: prompt,
        monthLabel: "",
        dayLabel: "",
        timeLabel: "",
        searchLimitLabel: "",
        selectedDateLabel: ""
      });
      updateOverlayCopy();
      syncDatePromptVisibility();
      syncBotLoop();
      return { selectedDateLabel: "", searchLimitLabel: "" };
    }
    const shouldReset =
      forceReset ||
      (!CONFIG.enabled && !state.pauseAfterDate) ||
      sessionState.phase === "idle" ||
      sessionState.phase === "disabled";

    function currentPhaseLabel() {
      switch (sessionState.phase) {
        case "loading":
          return t("phase.loading");
        case "setup":
          return t("phase.setup");
        case "location":
          return sessionState.locationLabel ? t("phase.locationSelected") : t("phase.location");
        case "calendar":
          return t("phase.calendar");
        case "refresh":
          return t("phase.refresh");
        case "time":
          if (sessionState.timeMode === "manual") return t("phase.timeManual");
          return sessionState.timeLabel ? t("phase.timeSelected") : t("phase.time");
        case "review":
          return CONFIG.autoContinueReview ? t("phase.review") : t("phase.reviewManual");
        case "finish":
          return CONFIG.autoFinishAppointment ? t("phase.finish") : t("phase.finishManual");
        case "paused":
          return t("phase.paused");
        case "done":
          return t("phase.done");
        case "disabled":
          return t("phase.disabled");
        default:
          if (setupPending) {
            return t("phase.setup");
          }
          return t("phase.ready");
      }
    }

    function currentSummary() {
      switch (sessionState.phase) {
        case "loading":
          return searchLimitLabel ? t("summary.loadingCalendar") : t("summary.loadingPage");
        case "setup":
          return getSetupPendingSummary();
        case "location":
          return sessionState.locationLabel ? t("summary.locationReady") : t("summary.openingLocation");
        case "calendar":
          return sessionState.monthLabel
            ? t("summary.analyzingMonth", {
                month: sessionState.monthLabel,
                limit: searchLimitLabel ? ` ${t("summary.searchingUntil", { date: searchLimitLabel })}` : ""
              })
            : (searchLimitLabel ? t("summary.searchingUntil", { date: searchLimitLabel }) : t("summary.waitingAvailable"));
        case "refresh":
          return t("summary.noMatchRefresh");
        case "time":
          if (sessionState.timeMode === "manual") return t("summary.manualTime");
          return sessionState.timeLabel
            ? t("summary.timePicked", { time: sessionState.timeLabel })
            : t("summary.timeSearching");
        case "review":
          return CONFIG.autoContinueReview ? t("summary.reviewPage") : t("summary.reviewManual");
        case "finish":
          return CONFIG.autoFinishAppointment ? t("summary.finishPage") : t("summary.finishManual");
        case "paused":
          return sessionState.summary || t("summary.dateFoundPaused", { date: sessionState.dayLabel || selectedDateLabel || "dd/mm" });
        case "done":
          if (sessionState.timeLabel) return t("summary.timePicked", { time: sessionState.timeLabel });
          if (sessionState.locationLabel) return t("summary.locationReady");
          return t("summary.calendarReady");
        case "disabled":
          return t("phase.disabled");
        default:
          if (setupPending) {
            return getSetupPendingSummary();
          }
          return CONFIG.enabled
            ? (selectedDateLabel
                ? (searchLimitLabel
                    ? t("summary.waitingUntil", { date: searchLimitLabel })
                    : t("summary.waiting"))
                : t("summary.noDateConfig"))
            : t("phase.disabled");
      }
    }

    const patch = {
      selectedDateLabel,
      searchLimitLabel,
      phaseLabel: currentPhaseLabel(),
      summary: currentSummary()
    };

    if (shouldReset) {
      patch.phase = state.pauseAfterDate ? "paused" : (setupPending ? "setup" : (CONFIG.enabled ? "idle" : "disabled"));
      patch.phaseLabel = state.pauseAfterDate
        ? t("phase.paused")
        : (setupPending ? t("phase.setup") : (CONFIG.enabled ? t("phase.ready") : t("phase.disabled")));
      patch.summary = state.pauseAfterDate
        ? (sessionState.summary || t("summary.dateFoundPaused", { date: sessionState.dayLabel || selectedDateLabel || "dd/mm" }))
        : (setupPending
            ? getSetupPendingSummary()
            : (CONFIG.enabled
                ? (selectedDateLabel
                    ? (searchLimitLabel
                        ? t("summary.waitingUntil", { date: searchLimitLabel })
                        : t("summary.waiting"))
                    : t("summary.noDateConfig"))
                : t("phase.disabled")));
      patch.locationLabel = "";
      patch.monthLabel = "";
      patch.dayLabel = searchLimitLabel;
      patch.timeLabel = "";
      patch.timeMode = "";
      patch.checkpoints = searchLimitLabel ? [{ title: t("checkpoint.limit"), value: searchLimitLabel }] : [];
    }

    setSession(patch);
    updateOverlayCopy();
    syncDatePromptVisibility();
    syncBotLoop();
    syncOverlayPhase(sessionState.phase, sessionState.phaseLabel, sessionState.summary);
    return { selectedDateLabel, searchLimitLabel };
  }

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    CONFIG = { ...DEFAULTS, ...cfg };
    normalizeDateConfig(CONFIG, { persist: true });
    chrome.storage.local.get({ [CONTROL_MIGRATION_KEY]: false }, (local) => {
      if (!local[CONTROL_MIGRATION_KEY]) {
        CONFIG.enabled = false;
        chrome.storage.sync.set({ enabled: false });
        chrome.storage.local.set({ [CONTROL_MIGRATION_KEY]: true });
      }

      refreshSessionFromConfig(true);
      syncBotLoop();
      run();
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    let syncChanged = false;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) {
        CONFIG[key] = changes[key].newValue;
        syncChanged = true;
      }
    }

    if (!syncChanged) return;
    normalizeDateConfig(CONFIG, { persist: true });
    refreshSessionFromConfig(false);
  });
})();
