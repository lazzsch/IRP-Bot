(() => {
  const supportedLanguages = globalThis.IRPCommon?.SUPPORTED_LANGUAGES || new Set(["pt", "en", "es"]);

  const defaults = {
    enabled: false,
    delayLocation: 4000,
    delayCalendar: 6000,
    delayBack: 8000,
    autoSelectTime: true,
    autoContinueReview: false,
    autoFinishAppointment: false,
    minimumDate: "",
    selectedDate: "",
    language: "en"
  };

  const monthLabels = {
    pt: ["Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"],
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    es: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
  };

  globalThis.IRPConfig = Object.freeze({
    defaults,
    monthLabels,
    sessionKey: "irpSession",
    supportedLanguages
  });
})();
