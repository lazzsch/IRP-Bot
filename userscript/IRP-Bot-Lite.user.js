// ==UserScript==
// @name         IRP Bot Lite (Tampermonkey)
// @namespace    https://github.com/lazzsch/IRP-Bot
// @version      0.1.0
// @description  Lightweight fallback for IRP reschedule monitoring while Chrome Web Store review is pending.
// @author       IRP Bot V3
// @match        https://portal.irishimmigration.ie/*/reschedule_appointment/*
// @match        https://portal.irishimmigration.ie/en/reschedule_appointment/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "irpBotLiteConfigV1";
  const DEFAULT_CONFIG = {
    botLanguage: "en",
    locationName: "Dublin Burgh Quay",
    minimumDate: "",
    bookedDate: "",
    autoSelectTime: true,
    autoContinueReview: false,
    autoFinish: false,
    monthHoldMs: 2000,
    loopMs: 850
  };

  const I18N = {
    en: {
      title: "IRP BOT LITE",
      running: "Running",
      stopped: "Stopped",
      waiting: "Waiting portal loading",
      setup: "Configure",
      start: "Start",
      stop: "Stop",
      save: "Save",
      close: "Close",
      language: "Language",
      minDate: "Minimum date (dd/mm or dd/mm/yyyy)",
      bookedDate: "Booked date (dd/mm or dd/mm/yyyy)",
      autoTime: "Select time automatically",
      autoReview: "Continue automatically on review page",
      autoFinish: "Finish automatically",
      langRequired: "Please open the portal in English (/en/) for the bot to run reliably.",
      pageNotSupported: "This page is not supported by Lite.",
      configRequired: "Set minimum date and booked date first.",
      dateFound: "Earlier date found",
      noDate: "No date in current month, moving forward",
      monthNow: "Current month",
      clickedDate: "Selected date",
      selectedTime: "Selected time",
      continueClick: "Clicked Continue",
      reloading: "No eligible date this cycle. Reloading page",
      introPage: "Intro page",
      locationPage: "Location page",
      datePage: "Date page",
      reviewPage: "Review page",
      finishPage: "Finish page"
    },
    pt: {
      title: "IRP BOT LITE",
      running: "Rodando",
      stopped: "Parado",
      waiting: "Aguardando carregamento do portal",
      setup: "Configurar",
      start: "Iniciar",
      stop: "Parar",
      save: "Salvar",
      close: "Fechar",
      language: "Idioma",
      minDate: "Data minima (dd/mm ou dd/mm/aaaa)",
      bookedDate: "Data marcada (dd/mm ou dd/mm/aaaa)",
      autoTime: "Selecionar horario automaticamente",
      autoReview: "Continuar automaticamente na revisao",
      autoFinish: "Finalizar automaticamente",
      langRequired: "Abra o portal em ingles (/en/) para o bot funcionar com mais confianca.",
      pageNotSupported: "Esta pagina nao e suportada no Lite.",
      configRequired: "Defina data minima e data marcada primeiro.",
      dateFound: "Data anterior encontrada",
      noDate: "Sem data neste mes, indo para o proximo",
      monthNow: "Mes atual",
      clickedDate: "Data selecionada",
      selectedTime: "Horario selecionado",
      continueClick: "Cliquei em Continue",
      reloading: "Sem data elegivel nesta rodada. Recarregando pagina",
      introPage: "Pagina inicial",
      locationPage: "Pagina de localizacao",
      datePage: "Pagina de data",
      reviewPage: "Pagina de revisao",
      finishPage: "Pagina final"
    },
    es: {
      title: "IRP BOT LITE",
      running: "Ejecutando",
      stopped: "Detenido",
      waiting: "Esperando carga del portal",
      setup: "Configurar",
      start: "Iniciar",
      stop: "Detener",
      save: "Guardar",
      close: "Cerrar",
      language: "Idioma",
      minDate: "Fecha minima (dd/mm o dd/mm/aaaa)",
      bookedDate: "Fecha reservada (dd/mm o dd/mm/aaaa)",
      autoTime: "Seleccionar horario automaticamente",
      autoReview: "Continuar automaticamente en revision",
      autoFinish: "Finalizar automaticamente",
      langRequired: "Abra el portal en ingles (/en/) para ejecucion estable.",
      pageNotSupported: "Esta pagina no esta soportada por Lite.",
      configRequired: "Define fecha minima y fecha reservada primero.",
      dateFound: "Fecha anterior encontrada",
      noDate: "Sin fecha en este mes, avanzando",
      monthNow: "Mes actual",
      clickedDate: "Fecha seleccionada",
      selectedTime: "Horario seleccionado",
      continueClick: "Se hizo click en Continue",
      reloading: "Sin fecha elegible en esta ronda. Recargando pagina",
      introPage: "Pagina inicial",
      locationPage: "Pagina de ubicacion",
      datePage: "Pagina de fecha",
      reviewPage: "Pagina de revision",
      finishPage: "Pagina final"
    }
  };

  const MONTHS_EN = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11
  };

  const state = {
    running: false,
    busy: false,
    selectedDate: null,
    lastMonthClickMs: 0,
    monthKeySeen: "",
    tickHandle: null,
    beepHandle: null,
    config: loadConfig()
  };

  if (!isReschedulePage()) return;
  injectBaseStyle();
  const ui = buildPanel();
  refreshUI();

  if (!state.config.minimumDate || !state.config.bookedDate) {
    openSetupModal();
  }

  function t(key) {
    const lang = state.config.botLanguage in I18N ? state.config.botLanguage : "en";
    return I18N[lang][key] || I18N.en[key] || key;
  }

  function isReschedulePage() {
    return /\/reschedule_appointment\/?$/.test(location.pathname);
  }

  function currentPortalLocale() {
    const parts = location.pathname.split("/").filter(Boolean);
    return (parts[0] || "").toLowerCase();
  }

  function isEnglishPortalPage() {
    return currentPortalLocale() === "en";
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CONFIG };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (_err) {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
  }

  function log(message) {
    const time = new Date().toLocaleTimeString("en-GB");
    const row = `[${time}] ${message}`;
    ui.consoleItems.unshift(row);
    if (ui.consoleItems.length > 6) ui.consoleItems.length = 6;
    ui.console.innerHTML = "";
    for (const item of ui.consoleItems) {
      const li = document.createElement("div");
      li.textContent = item;
      ui.console.appendChild(li);
    }
    // console passthrough
    console.log(`[IRP-LITE] ${message}`);
  }

  function refreshUI() {
    const running = state.running ? t("running") : t("stopped");
    ui.statusValue.textContent = running;
    ui.startStop.textContent = state.running ? t("stop") : t("start");
    ui.summary.textContent = `${state.config.minimumDate || "--"} -> ${state.config.bookedDate || "--"}`;
  }

  function injectBaseStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .irp-lite-panel { position: fixed; right: 18px; top: 120px; width: 320px; z-index: 2147483640; background: #03132a; color: #e9f3ff; border: 1px solid #1c3d65; border-radius: 14px; box-shadow: 0 14px 40px rgba(0,0,0,.45); padding: 12px; font-family: Segoe UI, Arial, sans-serif; }
      .irp-lite-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .irp-lite-title { font-weight: 800; font-size: 15px; letter-spacing: .04em; }
      .irp-lite-status { font-size: 12px; color: #94b3d4; margin-bottom: 6px; }
      .irp-lite-strong { color: #ffffff; font-weight: 700; font-size: 15px; }
      .irp-lite-buttons { display: flex; gap: 8px; margin-top: 10px; }
      .irp-lite-btn { flex: 1; border: 1px solid #2d5a8e; background: #0c2240; color: #d7e9ff; border-radius: 10px; padding: 8px 10px; font-weight: 700; cursor: pointer; }
      .irp-lite-btn.main { background: linear-gradient(90deg, #2ad387, #2dbdff); color: #062035; border: none; }
      .irp-lite-console { margin-top: 10px; border: 1px solid #1f3b60; border-radius: 10px; padding: 8px; max-height: 140px; overflow: auto; background: #081a31; }
      .irp-lite-console > div { background: #102645; border-radius: 7px; padding: 6px; margin-bottom: 6px; font-size: 12px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
      .irp-lite-console > div:last-child { margin-bottom: 0; }
      .irp-lite-modal-mask { position: fixed; inset: 0; background: rgba(3,12,22,.65); z-index: 2147483646; display: flex; align-items: center; justify-content: center; }
      .irp-lite-modal { width: min(560px, 92vw); background: #05182f; border: 1px solid #2a4f7c; border-radius: 14px; padding: 16px; color: #e8f3ff; font-family: Segoe UI, Arial, sans-serif; }
      .irp-lite-modal h2 { margin: 0 0 10px 0; font-size: 24px; }
      .irp-lite-field { margin-bottom: 10px; }
      .irp-lite-label { display: block; margin-bottom: 5px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #91afd1; }
      .irp-lite-input, .irp-lite-select { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #2c4f79; background: #0a1e39; color: #e8f3ff; font-size: 14px; }
      .irp-lite-check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .irp-lite-modal-buttons { display: flex; gap: 8px; margin-top: 12px; }
      .irp-lite-note { color: #95b1d2; font-size: 12px; margin-top: 8px; }
    `;
    document.documentElement.appendChild(style);
  }

  function buildPanel() {
    const root = document.createElement("section");
    root.className = "irp-lite-panel";
    root.innerHTML = `
      <div class="irp-lite-head">
        <div class="irp-lite-title">${t("title")}</div>
      </div>
      <div class="irp-lite-status">${t("language")}: <span class="irp-lite-strong" id="irp-lite-lang">${state.config.botLanguage.toUpperCase()}</span></div>
      <div class="irp-lite-status"><span class="irp-lite-strong" id="irp-lite-state">${t("stopped")}</span></div>
      <div class="irp-lite-status" id="irp-lite-summary">--</div>
      <div class="irp-lite-buttons">
        <button class="irp-lite-btn" id="irp-lite-config">${t("setup")}</button>
        <button class="irp-lite-btn main" id="irp-lite-startstop">${t("start")}</button>
      </div>
      <div class="irp-lite-console" id="irp-lite-console"></div>
    `;
    document.body.appendChild(root);

    const langValue = root.querySelector("#irp-lite-lang");
    const statusValue = root.querySelector("#irp-lite-state");
    const summary = root.querySelector("#irp-lite-summary");
    const configBtn = root.querySelector("#irp-lite-config");
    const startStop = root.querySelector("#irp-lite-startstop");
    const consoleNode = root.querySelector("#irp-lite-console");

    configBtn.addEventListener("click", openSetupModal);
    startStop.addEventListener("click", () => {
      if (state.running) {
        stopBot();
      } else {
        startBot();
      }
    });

    return {
      root,
      langValue,
      statusValue,
      summary,
      startStop,
      console: consoleNode,
      consoleItems: []
    };
  }

  function openSetupModal() {
    const existing = document.querySelector(".irp-lite-modal-mask");
    if (existing) existing.remove();

    const mask = document.createElement("div");
    mask.className = "irp-lite-modal-mask";
    mask.innerHTML = `
      <div class="irp-lite-modal">
        <h2>${t("setup")}</h2>
        <div class="irp-lite-field">
          <label class="irp-lite-label">${t("language")}</label>
          <select class="irp-lite-select" id="irp-lite-inp-lang">
            <option value="en">English</option>
            <option value="pt">Portuguese</option>
            <option value="es">Spanish</option>
          </select>
        </div>
        <div class="irp-lite-field">
          <label class="irp-lite-label">${t("minDate")}</label>
          <input class="irp-lite-input" id="irp-lite-inp-min" placeholder="04/05">
        </div>
        <div class="irp-lite-field">
          <label class="irp-lite-label">${t("bookedDate")}</label>
          <input class="irp-lite-input" id="irp-lite-inp-booked" placeholder="27/06">
        </div>
        <label class="irp-lite-check"><input type="checkbox" id="irp-lite-auto-time"> ${t("autoTime")}</label>
        <label class="irp-lite-check"><input type="checkbox" id="irp-lite-auto-review"> ${t("autoReview")}</label>
        <label class="irp-lite-check"><input type="checkbox" id="irp-lite-auto-finish"> ${t("autoFinish")}</label>
        <div class="irp-lite-modal-buttons">
          <button class="irp-lite-btn main" id="irp-lite-save">${t("save")}</button>
          <button class="irp-lite-btn" id="irp-lite-close">${t("close")}</button>
        </div>
        <p class="irp-lite-note">Use English portal path for stable automation: <strong>/en/reschedule_appointment/</strong></p>
      </div>
    `;
    document.body.appendChild(mask);

    const inpLang = mask.querySelector("#irp-lite-inp-lang");
    const inpMin = mask.querySelector("#irp-lite-inp-min");
    const inpBooked = mask.querySelector("#irp-lite-inp-booked");
    const autoTime = mask.querySelector("#irp-lite-auto-time");
    const autoReview = mask.querySelector("#irp-lite-auto-review");
    const autoFinish = mask.querySelector("#irp-lite-auto-finish");

    inpLang.value = state.config.botLanguage || "en";
    inpMin.value = state.config.minimumDate || "";
    inpBooked.value = state.config.bookedDate || "";
    autoTime.checked = !!state.config.autoSelectTime;
    autoReview.checked = !!state.config.autoContinueReview;
    autoFinish.checked = !!state.config.autoFinish;

    mask.querySelector("#irp-lite-close").addEventListener("click", () => mask.remove());
    mask.querySelector("#irp-lite-save").addEventListener("click", () => {
      const minRaw = normalizeDMYText(inpMin.value);
      const bookedRaw = normalizeDMYText(inpBooked.value);
      const minDate = parseDMY(minRaw);
      const bookedDate = parseDMY(bookedRaw);

      if (!minDate || !bookedDate) {
        alert("Please set valid dates");
        return;
      }
      if (minDate.getTime() >= bookedDate.getTime()) {
        alert("Minimum date must be earlier than booked date");
        return;
      }

      state.config.botLanguage = inpLang.value;
      state.config.minimumDate = formatDMY(minDate);
      state.config.bookedDate = formatDMY(bookedDate);
      state.config.autoSelectTime = autoTime.checked;
      state.config.autoContinueReview = autoReview.checked;
      state.config.autoFinish = autoFinish.checked;
      saveConfig();
      ui.langValue.textContent = state.config.botLanguage.toUpperCase();
      refreshUI();
      log(`Config saved: ${state.config.minimumDate} -> ${state.config.bookedDate}`);
      mask.remove();
    });
  }

  function startBot() {
    if (!isEnglishPortalPage()) {
      alert(t("langRequired"));
      log(t("langRequired"));
      return;
    }
    if (!state.config.minimumDate || !state.config.bookedDate) {
      log(t("configRequired"));
      openSetupModal();
      return;
    }
    state.running = true;
    refreshUI();
    log("Bot started");
    if (state.tickHandle) clearInterval(state.tickHandle);
    state.tickHandle = setInterval(loopTick, state.config.loopMs);
  }

  function stopBot() {
    state.running = false;
    if (state.tickHandle) clearInterval(state.tickHandle);
    state.tickHandle = null;
    stopAlertLoop();
    refreshUI();
    log("Bot stopped");
  }

  async function loopTick() {
    if (!state.running || state.busy) return;
    if (!isReschedulePage()) {
      stopBot();
      return;
    }
    state.busy = true;
    try {
      await processPage();
    } catch (err) {
      log(`Error: ${String(err && err.message ? err.message : err)}`);
    } finally {
      state.busy = false;
    }
  }

  async function processPage() {
    if (!isEnglishPortalPage()) {
      log(t("langRequired"));
      stopBot();
      return;
    }

    if (isPortalLoading()) {
      log(t("waiting"));
      return;
    }

    if (isIntroStep()) {
      log(t("introPage"));
      clickContinueButton();
      return;
    }

    if (isLocationStep()) {
      log(t("locationPage"));
      selectLocationAndContinue();
      return;
    }

    if (isDateStep()) {
      log(t("datePage"));
      await scanCalendarAndAct();
      return;
    }

    if (isReviewStep()) {
      log(t("reviewPage"));
      if (state.config.autoContinueReview) {
        clickContinueButton();
        log(t("continueClick"));
      } else {
        stopAndAlert("Review page reached");
      }
      return;
    }

    if (isFinishStep()) {
      log(t("finishPage"));
      if (state.config.autoFinish) {
        clickFinishButton();
      } else {
        stopAndAlert("Finish page reached");
      }
    }
  }

  function isPortalLoading() {
    const selectors = [
      "img[src*='loading']",
      "img[src*='spinner']",
      ".loading",
      ".spinner",
      ".block-ui"
    ];
    return selectors.some((sel) => {
      const node = document.querySelector(sel);
      return node && isVisible(node);
    });
  }

  function isVisible(el) {
    return !!(el && el.isConnected && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function isIntroStep() {
    const text = (document.body.textContent || "").toLowerCase();
    return text.includes("before proceeding, please read") && !!findContinueButton();
  }

  function isLocationStep() {
    const select = findLocationSelect();
    return !!select && !!findContinueButton();
  }

  function isDateStep() {
    const month = getCurrentMonthYear();
    return !!month;
  }

  function isReviewStep() {
    const text = (document.body.textContent || "").toLowerCase();
    return text.includes("please review and confirm the selected date");
  }

  function isFinishStep() {
    return !!findButtonByRegex(/\bfinish\b/i);
  }

  function findContinueButton() {
    return findButtonByRegex(/\bcontinue\b/i);
  }

  function clickContinueButton() {
    const btn = findContinueButton();
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  function clickFinishButton() {
    const btn = findButtonByRegex(/\bfinish\b/i);
    if (btn && !btn.disabled) {
      btn.click();
      log("Clicked Finish");
      const selected = state.selectedDate || state.config.bookedDate;
      if (selected) {
        state.config.bookedDate = normalizeDMYText(selected);
        saveConfig();
        refreshUI();
        log(`Booked date updated: ${state.config.bookedDate}`);
      }
      return true;
    }
    return false;
  }

  function findButtonByRegex(regex) {
    const nodes = document.querySelectorAll("button,input[type='button'],input[type='submit'],a");
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const label = node.tagName === "INPUT" ? node.value : node.textContent;
      if (label && regex.test(label.trim())) return node;
    }
    return null;
  }

  function findLocationSelect() {
    const selects = document.querySelectorAll("select");
    for (const select of selects) {
      if (!isVisible(select)) continue;
      const hasDublin = Array.from(select.options).some((opt) =>
        /dublin burgh quay/i.test(opt.textContent || "")
      );
      if (hasDublin) return select;
    }
    return null;
  }

  function selectLocationAndContinue() {
    const select = findLocationSelect();
    if (!select) return;
    const targetOption = Array.from(select.options).find((opt) =>
      new RegExp(state.config.locationName, "i").test(opt.textContent || "")
    );
    if (targetOption) {
      select.value = targetOption.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      log(`Location selected: ${targetOption.textContent.trim()}`);
    }
    clickContinueButton();
  }

  async function scanCalendarAndAct() {
    const min = parseDMY(normalizeDMYText(state.config.minimumDate));
    const booked = parseDMY(normalizeDMYText(state.config.bookedDate));
    if (!min || !booked) {
      log(t("configRequired"));
      stopBot();
      return;
    }

    const max = new Date(booked.getFullYear(), booked.getMonth(), booked.getDate() - 1);
    if (max.getTime() < min.getTime()) {
      log("Invalid search window");
      stopBot();
      return;
    }

    const current = getCurrentMonthYear();
    if (!current) {
      log(t("pageNotSupported"));
      return;
    }
    log(`${t("monthNow")}: ${current.label}`);

    const currentMonthDate = new Date(current.year, current.month, 1);
    const minMonthDate = new Date(min.getFullYear(), min.getMonth(), 1);
    const maxMonthDate = new Date(max.getFullYear(), max.getMonth(), 1);

    if (currentMonthDate.getTime() < minMonthDate.getTime()) {
      clickNextMonth();
      return;
    }

    if (currentMonthDate.getTime() > maxMonthDate.getTime()) {
      log(t("reloading"));
      location.reload();
      return;
    }

    const candidates = collectAvailableDates(current.month, current.year).filter((candidate) =>
      candidate.date.getTime() >= min.getTime() && candidate.date.getTime() <= max.getTime()
    );

    if (candidates.length > 0) {
      const chosen = candidates.sort((a, b) => b.date.getTime() - a.date.getTime())[0];
      chosen.node.click();
      state.selectedDate = formatDMY(chosen.date);
      state.config.bookedDate = state.selectedDate;
      saveConfig();
      refreshUI();
      log(`${t("clickedDate")}: ${state.selectedDate}`);

      if (!state.config.autoSelectTime && !state.config.autoContinueReview && !state.config.autoFinish) {
        stopAndAlert(`${t("dateFound")}: ${state.selectedDate}`);
        return;
      }

      await wait(300);
      if (state.config.autoSelectTime) {
        const timeOk = selectTimeSlot();
        if (timeOk) log(`${t("selectedTime")}: ${timeOk}`);
      }

      if (state.config.autoContinueReview) {
        await wait(250);
        if (clickContinueButton()) {
          log(t("continueClick"));
        }
      } else {
        stopAndAlert(`${t("dateFound")}: ${state.selectedDate}`);
      }
      return;
    }

    log(t("noDate"));
    maybeAdvanceMonth();
  }

  function maybeAdvanceMonth() {
    const month = getCurrentMonthYear();
    if (!month) return;
    const key = `${month.month}-${month.year}`;
    const now = Date.now();

    if (state.monthKeySeen !== key) {
      state.monthKeySeen = key;
      state.lastMonthClickMs = now;
      return;
    }

    if (now - state.lastMonthClickMs < Math.max(1000, state.config.monthHoldMs)) {
      return;
    }

    state.lastMonthClickMs = now;
    clickNextMonth();
  }

  function clickNextMonth() {
    const candidates = Array.from(document.querySelectorAll("a,button,span"));
    const next = candidates.find((node) => isVisible(node) && /^»$/.test((node.textContent || "").trim()));
    if (next) {
      next.click();
      log("Next month");
      return true;
    }
    return false;
  }

  function collectAvailableDates(month, year) {
    const rows = [];
    const anchors = document.querySelectorAll("a");
    for (const anchor of anchors) {
      if (!isVisible(anchor) || ui.root.contains(anchor)) continue;
      const text = (anchor.textContent || "").trim();
      if (!/^\d{1,2}$/.test(text)) continue;
      const day = Number(text);
      if (day < 1 || day > 31) continue;
      const date = new Date(year, month, day);
      rows.push({ node: anchor, date });
    }
    return rows;
  }

  function getCurrentMonthYear() {
    const nodes = document.querySelectorAll("div,span,p,th,strong,h2,h3,h4");
    for (const node of nodes) {
      if (!isVisible(node) || ui.root.contains(node)) continue;
      const text = (node.textContent || "").trim();
      const match = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i);
      if (!match) continue;
      const monthName = match[1].toLowerCase();
      const year = Number(match[2]);
      const month = MONTHS_EN[monthName];
      if (Number.isInteger(month)) {
        return { month, year, label: `${match[1]} ${year}` };
      }
    }
    return null;
  }

  function selectTimeSlot() {
    const slots = Array.from(document.querySelectorAll("button,div,li,a,span")).filter((node) => {
      if (!isVisible(node) || ui.root.contains(node)) return false;
      const txt = (node.textContent || "").trim();
      return /^\d{2}:\d{2}$/.test(txt);
    });
    if (!slots.length) {
      log("Time slots not found");
      return null;
    }
    slots[0].click();
    return (slots[0].textContent || "").trim();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function stopAndAlert(message) {
    stopBot();
    log(message);
    startAlertLoop();
  }

  function startAlertLoop() {
    stopAlertLoop();
    playBeep();
    state.beepHandle = setInterval(playBeep, 3000);
  }

  function stopAlertLoop() {
    if (state.beepHandle) clearInterval(state.beepHandle);
    state.beepHandle = null;
  }

  function playBeep() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = "sine";
      oscillator.frequency.value = 780;
      gainNode.gain.value = 0.05;
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch (_err) {
      // no-op
    }
  }

  function normalizeDMYText(value) {
    if (!value) return "";
    const cleaned = value.trim().replace(/-/g, "/").replace(/\s+/g, "");
    const parts = cleaned.split("/");
    if (parts.length === 2) {
      const year = new Date().getFullYear();
      return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${year}`;
    }
    if (parts.length === 3) {
      return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[2]}`;
    }
    return cleaned;
  }

  function parseDMY(value) {
    const normalized = normalizeDMYText(value);
    const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function formatDMY(date) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }
})();

