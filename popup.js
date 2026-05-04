const IRPCommon = globalThis.IRPCommon || {};
const IRPConfig = globalThis.IRPConfig || {};
const IRPPopupTexts = globalThis.IRPPopupTexts || {};

const defaults = IRPConfig.defaults || {};
const SESSION_KEY = IRPConfig.sessionKey || "irpSession";
const TEXTS = IRPPopupTexts;
const DEFAULT_LANGUAGE = defaults.language || IRPCommon.DEFAULT_LANGUAGE || "en";

let lastConfigSignature = "";
let autoSaveTimer = null;
let refreshTimer = null;

function $(id) {
  return document.getElementById(id);
}

function normalizeLanguage(value) {
  return IRPCommon.normalizeLanguage
    ? IRPCommon.normalizeLanguage(value, DEFAULT_LANGUAGE)
    : String(value || DEFAULT_LANGUAGE).toLowerCase();
}

function t(lang, key, params = {}) {
  if (IRPCommon.translateFlat) {
    return IRPCommon.translateFlat(TEXTS, lang, key, params, DEFAULT_LANGUAGE);
  }
  return key;
}

function escapeHtml(value) {
  return IRPCommon.escapeHtml ? IRPCommon.escapeHtml(value) : String(value || "");
}

function parseStoredDate(value) {
  return IRPCommon.parseFlexibleDate ? IRPCommon.parseFlexibleDate(value) : null;
}

function formatDateInputValue(date) {
  return IRPCommon.formatDateInputValue ? IRPCommon.formatDateInputValue(date) : "";
}

function formatDate(date, lang = DEFAULT_LANGUAGE) {
  return IRPCommon.formatDate ? IRPCommon.formatDate(date, lang) : "—";
}

function formatTime(date, lang = DEFAULT_LANGUAGE) {
  return IRPCommon.formatTime ? IRPCommon.formatTime(date, lang) : "—";
}

function previousDayLabel(value, lang = DEFAULT_LANGUAGE) {
  return IRPCommon.previousDayLabel ? IRPCommon.previousDayLabel(value, lang) : "—";
}

function setText(id, value) {
  const el = $(id);
  if (el) {
    el.textContent = value;
  }
}

function configSignature(config) {
  return JSON.stringify({
    enabled: !!config.enabled,
    delayLocation: Number(config.delayLocation || defaults.delayLocation),
    delayCalendar: Number(config.delayCalendar || defaults.delayCalendar),
    delayBack: Number(config.delayBack || defaults.delayBack),
    autoSelectTime: !!config.autoSelectTime,
    autoContinueReview: !!config.autoContinueReview,
    autoFinishAppointment: !!config.autoFinishAppointment,
    minimumDate: String(config.minimumDate || ""),
    selectedDate: String(config.selectedDate || ""),
    language: normalizeLanguage(config.language)
  });
}

function phaseLabel(session, config, lang) {
  if (session.phase === "paused") {
    return session.phaseLabel || t(lang, "phasePaused");
  }
  if (!config.enabled) {
    return t(lang, "phaseDisabled");
  }

  const labels = {
    idle: t(lang, "phaseReady"),
    loading: t(lang, "phaseLoading"),
    location: t(lang, "phaseLocation"),
    calendar: t(lang, "phaseCalendar"),
    refresh: t(lang, "phaseRefresh"),
    time: session.timeMode === "manual" ? t(lang, "phaseTimeManual") : t(lang, "phaseTime"),
    review: config.autoContinueReview ? t(lang, "phaseReview") : t(lang, "phaseReviewManual"),
    finish: config.autoFinishAppointment ? t(lang, "phaseFinish") : t(lang, "phaseFinishManual"),
    done: t(lang, "phaseDone"),
    disabled: t(lang, "phaseDisabled")
  };

  return session.phaseLabel || labels[session.phase || "idle"] || t(lang, "phaseReady");
}

function progressWidth(session, config) {
  if (session.phase === "paused") return "72%";
  if (!config.enabled) return "0%";

  const widths = {
    idle: "10%",
    location: "33%",
    calendar: "66%",
    refresh: "66%",
    time: "90%",
    review: "95%",
    finish: "98%",
    done: "100%"
  };

  return widths[session.phase || "idle"] || "10%";
}

function stageStatus(session, id, config) {
  if (session.phase === "paused") {
    if (id === "location" || id === "calendar") return "done";
    return "pending";
  }
  if (!config.enabled) return "pending";

  const phase = session.phase || "idle";
  if (id === "location") {
    if (phase === "location") return "active";
    if (["calendar", "refresh", "time", "review", "finish", "done"].includes(phase)) return "done";
    return "pending";
  }
  if (id === "calendar") {
    if (["calendar", "refresh"].includes(phase)) return "active";
    if (["time", "review", "finish", "done"].includes(phase)) return "done";
    return "pending";
  }
  if (id === "time") {
    if (phase === "time") return "active";
    if (["review", "finish", "done"].includes(phase)) return "done";
  }
  return "pending";
}

function getStageData(session, config, lang) {
  return [
    {
      id: "location",
      title: t(lang, "stageLocation"),
      detail: session.locationLabel || t(lang, "stageWaitingLocation")
    },
    {
      id: "calendar",
      title: t(lang, "stageCalendar"),
      detail: session.monthLabel
        ? t(lang, "stageCalendarDetail", {
            month: session.monthLabel,
            limit: session.searchLimitLabel ? ` ${session.searchLimitLabel}` : ""
          })
        : t(lang, "stageWaitingCalendar")
    },
    {
      id: "time",
      title: t(lang, "stageTime"),
      detail: session.timeMode === "manual"
        ? t(lang, "stageWaitingTimeManual")
        : (session.timeLabel || t(lang, "stageWaitingTime"))
    }
  ].map((stage) => ({
    ...stage,
    status: stageStatus(session, stage.id, config)
  }));
}

function getCheckpointData(session) {
  const items = Array.isArray(session.checkpoints) ? session.checkpoints.slice().reverse() : [];
  return items
    .filter((item) => item && (item.title || item.value))
    .map((item) => ({
      title: item.title || "Checkpoint",
      value: item.value || "—"
    }));
}

function renderLanguageOptions(lang) {
  const select = $("language");
  if (!select) return;

  for (const option of select.options) {
    if (option.value === "pt") option.textContent = t(lang, "optionPt");
    if (option.value === "en") option.textContent = t(lang, "optionEn");
    if (option.value === "es") option.textContent = t(lang, "optionEs");
  }
}

function renderStaticText(lang) {
  document.documentElement.lang = normalizeLanguage(lang);

  const bindings = {
    heroTitle: "heroTitle",
    heroSubtitle: "heroSubtitle",
    sessionStatusHeading: "statusHeading",
    sessionStatusSub: "statusSub",
    progressHeading: "progressHeading",
    progressSub: "progressSub",
    configHeading: "configHeading",
    configSub: "configSub",
    configHint: "configHint",
    controlBannerTitle: "controlTitle",
    controlBannerBody: "controlBody",
    missingDateBannerTitle: "missingDateTitle",
    missingDateBannerBody: "missingDateBody",
    sessionScopePill: "sessionScope",
    configScopePill: "configScope",
    labelLocation: "labelLocation",
    labelSelectedDate: "labelSelectedDate",
    labelMinimumDate: "labelMinimumDate",
    labelSearchLimit: "labelSearchLimit",
    labelMonth: "labelMonth",
    labelDay: "labelDay",
    labelTime: "labelTime",
    delayLocationLabel: "delayLocationLabel",
    delayCalendarLabel: "delayCalendarLabel",
    delayBackLabel: "delayBackLabel",
    selectedDateLabel: "selectedDateConfigLabel",
    minimumDateLabel: "minimumDateConfigLabel",
    languageLabel: "languageLabel",
    languageSectionTitle: "languageSectionTitle",
    languageSectionSub: "languageSectionSub",
    languageHelp: "languageHelp",
    dateWindowTitle: "dateWindowTitle",
    dateWindowSub: "dateWindowSub",
    minimumDateHelp: "minimumDateHelp",
    selectedDateHelp: "selectedDateHelp",
    autoSelectTimeLabel: "autoSelectTimeLabel",
    autoSelectTimeHelp: "autoSelectTimeHelp",
    autoContinueReviewLabel: "autoContinueReviewLabel",
    autoContinueReviewHelp: "autoContinueReviewHelp",
    autoFinishAppointmentLabel: "autoFinishAppointmentLabel",
    autoFinishAppointmentHelp: "autoFinishAppointmentHelp",
    automationSectionTitle: "automationSectionTitle",
    automationSectionSub: "automationSectionSub",
    advancedSectionTitle: "advancedSectionTitle",
    advancedSectionSub: "advancedSectionSub",
    updateSelectedDate: "updateDateButton",
    save: "saveButton"
  };

  for (const [id, key] of Object.entries(bindings)) {
    setText(id, t(lang, key));
  }

  renderLanguageOptions(lang);
}

function renderConfig(config) {
  $("delayLocation").value = config.delayLocation;
  $("delayCalendar").value = config.delayCalendar;
  $("delayBack").value = config.delayBack;
  $("autoSelectTime").checked = !!config.autoSelectTime;
  $("autoContinueReview").checked = !!config.autoContinueReview;
  $("autoFinishAppointment").checked = !!config.autoFinishAppointment;
  $("minimumDate").value = formatDateInputValue(parseStoredDate(config.minimumDate));
  $("selectedDate").value = formatDateInputValue(parseStoredDate(config.selectedDate));
  $("language").value = normalizeLanguage(config.language);
  renderStaticText(config.language);
}

function renderMissingDateBanner(config, lang) {
  const banner = $("missingDateBanner");
  if (!banner) return;

  const hasMinimum = String(config.minimumDate || "").trim();
  const hasSelected = String(config.selectedDate || "").trim();
  banner.hidden = !!(hasMinimum && hasSelected);
  if (!banner.hidden) {
    setText("missingDateBannerTitle", t(lang, "missingDateTitle"));
    setText("missingDateBannerBody", t(lang, "missingDateBody"));
  }
}

function readLanguageConfig() {
  return {
    language: normalizeLanguage($("language").value || defaults.language)
  };
}

function readDateWindowConfig() {
  return {
    minimumDate: $("minimumDate").value || "",
    selectedDate: $("selectedDate").value || ""
  };
}

function readAutomationConfig() {
  return {
    autoSelectTime: $("autoSelectTime").checked,
    autoContinueReview: $("autoContinueReview").checked,
    autoFinishAppointment: $("autoFinishAppointment").checked
  };
}

function readTimingConfig() {
  return {
    delayLocation: Number($("delayLocation").value || defaults.delayLocation),
    delayCalendar: Number($("delayCalendar").value || defaults.delayCalendar),
    delayBack: Number($("delayBack").value || defaults.delayBack)
  };
}

function gatherConfigFromForm() {
  return {
    ...readTimingConfig(),
    ...readAutomationConfig(),
    ...readDateWindowConfig(),
    ...readLanguageConfig()
  };
}

function persistConfig({ showSavedState = true } = {}) {
  const config = gatherConfigFromForm();

  chrome.storage.sync.set(config, () => {
    const saveButton = $("save");
    if (saveButton) {
      saveButton.textContent = showSavedState ? t(config.language, "savedButton") : t(config.language, "saveButton");
    }

    if (showSavedState) {
      setTimeout(refresh, 1000);
    } else {
      scheduleRefresh();
    }
  });
}

function renderStageList(stages) {
  const stageList = $("stageList");
  if (!stageList) return;

  stageList.innerHTML = stages.map((stage) => `
    <div class="stage ${stage.status}">
      <div class="stage-dot"></div>
      <div class="stage-body">
        <div class="stage-title">${escapeHtml(stage.title)}</div>
        <div class="stage-detail">${escapeHtml(stage.detail)}</div>
      </div>
    </div>
  `).join("");
}

function renderCheckpointList(checkpoints, lang) {
  const checkpointList = $("checkpointList");
  if (!checkpointList) return;

  if (!checkpoints.length) {
    checkpointList.innerHTML = `<span class="chip"><span>${escapeHtml(t(lang, "checkpointSession"))}</span>${escapeHtml(t(lang, "checkpointWaiting"))}</span>`;
    return;
  }

  checkpointList.innerHTML = checkpoints
    .map((item) => `<span class="chip"><span>${escapeHtml(item.title)}</span>${escapeHtml(item.value)}</span>`)
    .join("");
}

function renderSession(session, config) {
  const lang = normalizeLanguage(config.language);
  const minimumDate = parseStoredDate(config.minimumDate);
  const selectedDate = parseStoredDate(config.selectedDate);
  const minimumDateLabel = minimumDate ? formatDate(minimumDate, lang) : "—";
  const selectedDateLabel = selectedDate ? formatDate(selectedDate, lang) : session.selectedDateLabel || "—";
  const searchLimitLabel = selectedDate ? previousDayLabel(config.selectedDate, lang) : session.searchLimitLabel || "—";
  const summary = session.summary || t(lang, "sessionSummaryDefault");
  const title = phaseLabel(session, config, lang);
  const updatedAt = session.updatedAt ? new Date(session.updatedAt) : null;
  const phaseTone = session.phase === "paused"
    ? "warn"
    : !config.enabled
      ? "warn"
      : ["calendar", "refresh", "review", "finish"].includes(session.phase || "")
        ? "sky"
        : ["time", "done", "location"].includes(session.phase || "")
          ? "good"
          : "sky";
  const liveTone = updatedAt ? "good" : "sky";

  renderStaticText(lang);
  renderMissingDateBanner(config, lang);

  setText("sessionSummary", summary);
  setText("phasePill", title);
  setText("sessionTitle", title);
  setText("livePill", updatedAt ? t(lang, "liveUpdated", { time: formatTime(updatedAt, lang) }) : t(lang, "liveNoUpdate"));
  setText("sessionUpdated", updatedAt ? formatTime(updatedAt, lang) : "—");
  setText("locationValue", session.locationLabel || t(lang, "stageWaitingLocation"));
  setText("minimumDateValue", minimumDateLabel);
  setText("selectedDateValue", selectedDateLabel);
  setText("searchLimitValue", searchLimitLabel);
  setText("monthValue", session.monthLabel || "—");
  setText("dayValue", session.dayLabel || "—");
  setText("timeValue", session.timeLabel || "—");
  setText(
    "dateWindowPill",
    minimumDate && selectedDate
      ? `${minimumDateLabel} -> ${searchLimitLabel}`
      : searchLimitLabel !== "—"
        ? searchLimitLabel
        : minimumDateLabel
  );

  const phasePill = $("phasePill");
  const livePill = $("livePill");
  if (phasePill) phasePill.className = `pill ${phaseTone}`;
  if (livePill) livePill.className = `pill ${liveTone}`;

  if (config.selectedDate) {
    if (config.minimumDate) {
      setText("searchHint", t(lang, "searchHintWithRange", { minimum: minimumDateLabel, limit: searchLimitLabel }));
      setText("configHint", t(lang, "configHintWithRange", { minimum: minimumDateLabel, selected: selectedDateLabel, limit: searchLimitLabel }));
    } else {
      setText("searchHint", t(lang, "searchHintWithDate", { selected: selectedDateLabel, limit: searchLimitLabel }));
      setText("configHint", t(lang, "configHintWithDate", { selected: selectedDateLabel, limit: searchLimitLabel }));
    }
  } else {
    setText("searchHint", t(lang, "searchHintNoDate"));
    setText("configHint", t(lang, "configHintNoDate"));
  }

  renderStageList(getStageData(session, config, lang));
  renderCheckpointList(getCheckpointData(session), lang);

  const progressBar = $("progressBar");
  if (progressBar) {
    progressBar.style.width = progressWidth(session, config);
  }
}

function readStorage(area, keys) {
  return new Promise((resolve) => {
    chrome.storage[area].get(keys, resolve);
  });
}

async function refresh() {
  const [config, local] = await Promise.all([
    readStorage("sync", defaults),
    readStorage("local", { [SESSION_KEY]: {} })
  ]);

  const session = local[SESSION_KEY] || {};
  const signature = configSignature(config);
  if (signature !== lastConfigSignature) {
    lastConfigSignature = signature;
    renderConfig(config);
  }

  renderSession(session, config);
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    persistConfig({ showSavedState: false });
  }, 220);
}

function bindAutoSave() {
  const ids = [
    "delayLocation",
    "delayCalendar",
    "delayBack",
    "autoSelectTime",
    "autoContinueReview",
    "autoFinishAppointment",
    "minimumDate",
    "selectedDate",
    "language"
  ];

  for (const id of ids) {
    const el = $(id);
    if (!el) continue;

    const eventName = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(eventName, scheduleAutoSave);
    if (eventName !== "change") {
      el.addEventListener("change", scheduleAutoSave);
    }
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 60);
}

function bindEvents() {
  $("save")?.addEventListener("click", () => persistConfig({ showSavedState: true }));
  $("updateSelectedDate")?.addEventListener("click", () => persistConfig({ showSavedState: true }));

  document.addEventListener("DOMContentLoaded", () => {
    bindAutoSave();
    refresh();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" || areaName === "local") {
      scheduleRefresh();
    }
  });
}

bindEvents();
