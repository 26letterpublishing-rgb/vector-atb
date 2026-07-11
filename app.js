let state = null;
let mode = localStorage.getItem("sa-atb-mode") || "welcome";
let currentRoomCode = (localStorage.getItem("sa-atb-room-code") || "").trim().toUpperCase();
let myUnitId = localStorage.getItem("sa-atb-unit-id") || "";
let alertsEnabled = localStorage.getItem("sa-atb-alerts") === "on";
let gmSoundsMuted = localStorage.getItem("sa-atb-gm-muted") === "on";
let playerActionLogEnabled = localStorage.getItem("sa-atb-action-log-enabled") !== "off";
let visualMode = "bars";
let selectedCharacterIcon = "";
let actionLogTimeout = null;
let pendingActionLog = null;
let lastNotifiedActiveId = "";
let lastCommandWarningKey = "";
let lastInterruptedNotice = "";
let lastHandledDelayRequest = "";
let audioContext = null;
let events = null;
let lastGmClockClickAt = 0;
let lastRingActionPressAt = 0;
let ringDrag = null;
let ringMovedId = "";
let ringMovedTimeout = null;
let delayModalState = null;
let queuedEffectModalState = null;
let npcDefaultBag = [];
const KEEP_ALIVE_MS = 30000;
const ACTION_LOG_TIMEOUT_MS = 300000;
const ICON_MAX_SIZE = 192;
const ICON_STORAGE_LIMIT = 240000;
const ICON_JPEG_QUALITY = 0.78;
const diceColumns = ["D4", "D6", "D8", "D10", "D12"];
const actionLogChoices = [
  ["MELEE ATTACKED", "melee attacked"],
  ["WRESTLE/TACKLED", "wrestled/tackled"],
  ["MOVED", "moved"],
  ["CHARGED GUN", "charged a gun"],
  ["READIED GUN", "readied a gun"],
  ["READIED WEAPON", "readied a weapon"],
  ["USED ITEM", "used an item"],
  ["DEFENSE ACTION", "took a defensive action"],
  ["FIRED GUN", "fired a gun"],
  ["SHIP OPERATION", "performed a ship operation"],
  ["DELAYED RESOLUTION", "started a delayed resolution"],
  ["OTHER", "other"],
  ["NO ACTION", "took no action"],
];
const pcBuild = {
  perception: [1, 1, 0, 0],
  intellect: [1, 1, 0, 0],
};
const delayBaseOptions = [
  { label: "Very Slow", value: 3 },
  { label: "Slow", value: 6 },
  { label: "Moderate", value: 8 },
  { label: "Fast", value: 10 },
  { label: "Very Fast", value: 14 },
];
const c4Factors = ["Situation", "Execution", "Quality", "Performance", "Efficiency", "Ingenuity"];
const c4GreenFactors = new Set(["Situation", "Execution"]);
const c4PositiveSteps = [
  { flat: 2, percent: 0, label: "+2" },
  { flat: 3, percent: 0, label: "+3" },
  { flat: 0, percent: 0.16, label: "+16%" },
  { flat: 0, percent: 0.33, label: "+33%" },
];
const c4NegativeSteps = [
  { flat: -2, percent: 0, label: "-2" },
  { flat: -3, percent: 0, label: "-3" },
  { flat: 0, percent: -0.16, label: "-16%" },
  { flat: 0, percent: -0.33, label: "-33%" },
];
const npcDefaults = [
  { characterName: "Security Guard", speed: 5, color: "#39e58f" },
  { characterName: "Space Slug", speed: 3, color: "#7ad66d" },
  { characterName: "Civilian", speed: 4, color: "#f2d16b" },
  { characterName: "Chief Security Guard", speed: 7, color: "#35b7ff" },
  { characterName: "Thug", speed: 6, color: "#f07a4a" },
  { characterName: "Purple Alien", speed: 8, color: "#a65cff" },
  { characterName: "Mini Boss", speed: 9, color: "#ff5fa2" },
  { characterName: "Robot Sentry", speed: 10, color: "#8bd7ff" },
  { characterName: "Cyber Ninja", speed: 11, color: "#20f5d0" },
  { characterName: "Final Boss", speed: 12, color: "#ff3d55" },
];

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    try {
      if (key !== "sa-atb-character-icons") localStorage.removeItem("sa-atb-character-icons");
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

function forgetSavedRoom() {
  currentRoomCode = "";
  myUnitId = "";
  state = null;
  if (events) {
    events.close();
    events = null;
  }
  localStorage.removeItem("sa-atb-room-code");
  localStorage.removeItem("sa-atb-unit-id");
}

function returnToWelcome(message = "") {
  forgetSavedRoom();
  mode = "welcome";
  safeLocalStorageSet("sa-atb-mode", mode);
  render();
  if (message) setConnected(false, message);
}

if (!/^[A-Z0-9]{4}$/.test(currentRoomCode)) {
  forgetSavedRoom();
}

if (!currentRoomCode && mode !== "welcome" && mode !== "roomJoin") {
  mode = "welcome";
  safeLocalStorageSet("sa-atb-mode", mode);
}

const roomCode = document.querySelector("#roomCode");
const connectionStatus = document.querySelector("#connectionStatus");
const welcomePanel = document.querySelector("#welcomePanel");
const createRoom = document.querySelector("#createRoom");
const showJoinRoom = document.querySelector("#showJoinRoom");
const roomJoinPanel = document.querySelector("#roomJoinPanel");
const joinRoomCode = document.querySelector("#joinRoomCode");
const confirmJoinRoom = document.querySelector("#confirmJoinRoom");
const backToWelcome = document.querySelector("#backToWelcome");
const topbar = document.querySelector("#topbar");
const joinPanel = document.querySelector("#joinPanel");
const gmPanel = document.querySelector("#gmPanel");
const gmTopControls = document.querySelector("#gmTopControls");
const playerTopControls = document.querySelector("#playerTopControls");
const playerPanel = document.querySelector("#playerPanel");
const playerName = document.querySelector("#playerName");
const characterName = document.querySelector("#characterName");
const playerColor = document.querySelector("#playerColor");
const characterIcon = document.querySelector("#characterIcon");
const perceptionDiceGrid = document.querySelector("#perceptionDiceGrid");
const intellectDiceGrid = document.querySelector("#intellectDiceGrid");
const awarenessSkill = document.querySelector("#awarenessSkill");
const initiativeSkill = document.querySelector("#initiativeSkill");
const calculatedSpeed = document.querySelector("#calculatedSpeed");
const calculatedCommand = document.querySelector("#calculatedCommand");
const joinPlayer = document.querySelector("#joinPlayer");
const openGm = document.querySelector("#openGm");
const rejoinBlock = document.querySelector("#rejoinBlock");
const rejoinSelect = document.querySelector("#rejoinSelect");
const rejoinPlayer = document.querySelector("#rejoinPlayer");
const stepTick = document.querySelector("#stepTick");
const resetAll = document.querySelector("#resetAll");
const clearEncounter = document.querySelector("#clearEncounter");
const undoLastTiming = document.querySelector("#undoLastTiming");
const exitCombat = document.querySelector("#exitCombat");
const gmMuteSound = document.querySelector("#gmMuteSound");
const gmAddUnit = document.querySelector("#gmAddUnit");
const gmPlayerName = document.querySelector("#gmPlayerName");
const gmCharacterName = document.querySelector("#gmCharacterName");
const gmSpeedRating = document.querySelector("#gmSpeedRating");
const gmCommandWindow = document.querySelector("#gmCommandWindow");
const gmCommandWindowWrap = document.querySelector("#gmCommandWindowWrap");
const gmColor = document.querySelector("#gmColor");
const gmTeam = document.querySelector("#gmTeam");
const unitList = document.querySelector("#unitList");
const initiativePanel = document.querySelector("#initiativePanel");
const logPanel = document.querySelector("#logPanel");
const readyCount = document.querySelector("#readyCount");
const clockState = document.querySelector("#clockState");
const playerClock = document.querySelector("#playerClock");
const myCharacter = document.querySelector("#myCharacter");
const myTurnBanner = document.querySelector("#myTurnBanner");
const playerTurnTitle = document.querySelector("#playerTurnTitle");
const playerTurnActions = document.querySelector("#playerTurnActions");
const playerEndTurn = document.querySelector("#playerEndTurn");
const playerDelay = document.querySelector("#playerDelay");
const playerRoomCode = document.querySelector("#playerRoomCode");
const playerCommandDial = document.querySelector("#playerCommandDial");
const playerCommandTime = document.querySelector("#playerCommandTime");
const playerCommandStatus = document.querySelector("#playerCommandStatus");
const enableAlerts = document.querySelector("#enableAlerts");
const leaveRoom = document.querySelector("#leaveRoom");
const playerActionLogToggle = document.querySelector("#playerActionLogToggle");
const myUnitCard = document.querySelector("#myUnitCard");
const activePanel = document.querySelector("#activePanel");
const activeKicker = document.querySelector("#activeKicker");
const activeTitle = document.querySelector("#activeTitle");
const activeMeta = document.querySelector("#activeMeta");
const logList = document.querySelector("#logList");
const turnDialog = document.querySelector("#turnDialog");
const turnDialogKicker = document.querySelector("#turnDialogKicker");
const activeName = document.querySelector("#activeName");
const activeOwner = document.querySelector("#activeOwner");
const completeTurn = document.querySelector("#completeTurn");
const gmDelay = document.querySelector("#gmDelay");
const delayDialog = document.querySelector("#delayDialog");
const delayDialogTitle = document.querySelector("#delayDialogTitle");
const delayDialogTarget = document.querySelector("#delayDialogTarget");
const delayRatePreview = document.querySelector("#delayRatePreview");
const delayModifierPreview = document.querySelector("#delayModifierPreview");
const delayBaseGrid = document.querySelector("#delayBaseGrid");
const delayC4Grid = document.querySelector("#delayC4Grid");
const delayActionNameWrap = document.querySelector("#delayActionNameWrap");
const delayActionName = document.querySelector("#delayActionName");
const cancelDelayDialog = document.querySelector("#cancelDelayDialog");
const confirmDelayDialog = document.querySelector("#confirmDelayDialog");
const queuedEffectDialog = document.querySelector("#queuedEffectDialog");
const queuedEffectTarget = document.querySelector("#queuedEffectTarget");
const queuedEffectRatePreview = document.querySelector("#queuedEffectRatePreview");
const queuedEffectModifierPreview = document.querySelector("#queuedEffectModifierPreview");
const queuedEffectName = document.querySelector("#queuedEffectName");
const queuedEffectBaseGrid = document.querySelector("#queuedEffectBaseGrid");
const queuedEffectC4Grid = document.querySelector("#queuedEffectC4Grid");
const cancelQueuedEffectDialog = document.querySelector("#cancelQueuedEffectDialog");
const confirmQueuedEffectDialog = document.querySelector("#confirmQueuedEffectDialog");
const gmPanicPause = document.querySelector("#gmPanicPause");
const visualModeToggle = document.querySelector("#visualModeToggle");
const playerActionSheet = document.querySelector("#playerActionSheet");
const playerActionChoices = document.querySelector("#playerActionChoices");
const dismissActionSheet = document.querySelector("#dismissActionSheet");

function pct(unit) {
  if (!state) return 0;
  return Math.min(100, (unit.atb / state.threshold) * 100);
}

function delayTimerFor(unit) {
  if (unit?.delayTimer) return unit.delayTimer;
  return unit?.delay?.kind === "timer" ? unit.delay : null;
}

function delayedActionFor(unit) {
  if (unit?.delayedAction) return unit.delayedAction;
  return unit?.delay?.kind === "action" ? unit.delay : null;
}

function hasAnyDelay(unit) {
  return Boolean(delayTimerFor(unit) || delayedActionFor(unit));
}

function activeDelayFor(unit) {
  return delayTimerFor(unit) || delayedActionFor(unit);
}

function editableDelayFor(unit) {
  return delayTimerFor(unit) || delayedActionFor(unit);
}

function delayConsoleAllowed() {
  const active = state?.units.find((unit) => unit.id === state.activeId);
  return Boolean(state?.hardPaused || (active?.team === "npc" && state?.pausedForTurn));
}

function formatSpeed(value) {
  if (!value) return "Unset";
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1);
}

function estimateTurn(unit) {
  if (!unit.speed) return "Awaiting GM values";
  const delay = activeDelayFor(unit);
  if (delay) return `${delayText(delay)} - ${formatSeconds(delaySeconds(delay))}`;
  if (!state || unit.atb >= state.threshold) return "Ready";
  if (!state.running || state.pausedForTurn || state.hardPaused || state.holdPaused) return "Clock paused";
  const seconds = Math.max(0, (state.threshold - unit.atb) / unit.speed);
  if (seconds < 1) return "acts in <1 sec";
  return `acts in ~${Math.ceil(seconds)} sec`;
}

function formatSeconds(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function clampSkill(value) {
  return Math.max(0, Math.min(20, Math.floor(Number(value) || 0)));
}

function purchasedBoxes(rows) {
  return rows.reduce((total, count) => total + count, 0);
}

function calculatedPcStats() {
  const perceptionBoxes = purchasedBoxes(pcBuild.perception);
  const intellectBoxes = purchasedBoxes(pcBuild.intellect);
  const awareness = clampSkill(awarenessSkill.value);
  const initiative = clampSkill(initiativeSkill.value);
  return {
    speed: Math.max(1, intellectBoxes + initiative),
    commandWindow: Math.max(1, perceptionBoxes * 10 + awareness * 30),
  };
}

function renderDiceGrid(statName, grid) {
  const rows = pcBuild[statName];
  grid.innerHTML = rows
    .map((filled, rowIndex) => {
      const cells = diceColumns
        .map((die, dieIndex) => {
          const count = dieIndex + 1;
          const isFilled = filled >= count;
          return `<button type="button" class="die-cell ${isFilled ? "filled" : ""}" data-stat="${statName}" data-row="${rowIndex}" data-count="${count}">${die}</button>`;
        })
        .join("");
      return `<div class="die-row">${cells}</div>`;
    })
    .join("");
}

function renderPcBuilder() {
  renderDiceGrid("perception", perceptionDiceGrid);
  renderDiceGrid("intellect", intellectDiceGrid);
  const stats = calculatedPcStats();
  calculatedSpeed.textContent = String(stats.speed);
  calculatedCommand.textContent = `${stats.commandWindow} sec`;
}

function commandFor(unit) {
  return state?.command?.unitId === unit?.id ? state.command : null;
}

function commandPercent(command) {
  if (!command || !command.total) return 0;
  return Math.max(0, Math.min(100, (command.remaining / command.total) * 100));
}

function delayPercent(delay) {
  if (!delay || !delay.total) return 0;
  return Math.max(0, Math.min(100, (delay.remaining / delay.total) * 100));
}

function delaySeconds(delay) {
  if (!delay || !delay.rate) return 0;
  return Math.max(0, delay.remaining / delay.rate);
}

function queuedEffectsFor(unit) {
  return Array.isArray(unit?.queuedEffects) ? unit.queuedEffects : [];
}

function queuedEffectPercent(effect) {
  if (!effect || !effect.total) return 0;
  return Math.max(0, Math.min(100, ((Number(effect.progress) || 0) / effect.total) * 100));
}

function queuedEffectSeconds(effect) {
  if (!effect || !effect.rate) return 0;
  const impairmentMultiplier = Math.max(0, 1 - (Math.max(0, Math.min(2, Number(effect.impairments) || 0)) * 0.1));
  const speed = effect.rate * impairmentMultiplier;
  return speed > 0 ? Math.max(0, (100 - (Number(effect.progress) || 0)) / speed) : 0;
}

function delayText(delay) {
  if (!delay) return "";
  if (delay.kind === "queued") return `Queued Setup: ${delay.label}`;
  if (delay.kind === "action") return `Delayed Resolution: ${delay.label}`;
  return "Reload/Recovery";
}

function delayBars(unit) {
  const bars = [];
  const timer = delayTimerFor(unit);
  const actionDelay = delayedActionFor(unit);
  if (actionDelay) bars.push({ delay: actionDelay, className: "action-delay" });
  if (timer) bars.push({ delay: timer, className: "timer-delay" });
  return bars;
}

function delayBarsMarkup(unit) {
  return delayBars(unit)
    .map(({ delay, className }) => `
      <div class="delay-bar ${className}">
        <div class="delay-bar-fill" style="width:${delayPercent(delay)}%"></div>
        <span>${escapeHtml(delayText(delay))} - ${formatSeconds(delaySeconds(delay))}</span>
      </div>
    `)
    .join("");
}

function queuedEffectsMarkup(unit, { gm = false } = {}) {
  return queuedEffectsFor(unit)
    .map((effect) => {
      const impairments = Math.max(0, Math.min(3, Number(effect.impairments) || 0));
      return `
        <div class="queued-effect-bar ${effect.resolving ? "resolving" : ""}" data-effect-id="${escapeHtml(effect.id)}">
          <div class="queued-effect-fill" style="width:${queuedEffectPercent(effect)}%"></div>
          <span>${escapeHtml(effect.label)} - ${Math.floor(queuedEffectPercent(effect))}%${effect.resolving ? " - READY" : ` - ${formatSeconds(queuedEffectSeconds(effect))}`}</span>
          <div class="queued-effect-pips" aria-label="${impairments} impairments">
            <i class="${impairments >= 1 ? "active" : ""}"></i>
            <i class="${impairments >= 2 ? "active" : ""}"></i>
            <i class="${impairments >= 3 ? "active" : ""}"></i>
          </div>
          ${
            gm
              ? `<div class="queued-effect-actions">
                  <button class="mini" data-action="impairQueuedEffect" data-id="${unit.id}" data-effect-id="${escapeHtml(effect.id)}">Impair</button>
                  <button class="mini danger" data-action="removeQueuedEffect" data-id="${unit.id}" data-effect-id="${escapeHtml(effect.id)}">X</button>
                </div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function c4ArcPoint(radius, degrees) {
  const radians = (degrees - 90) * (Math.PI / 180);
  return {
    x: 50 + radius * Math.cos(radians),
    y: 50 + radius * Math.sin(radians),
  };
}

function c4ArcPath(radius, startAngle, endAngle, sweep = 1) {
  const start = c4ArcPoint(radius, startAngle);
  const end = c4ArcPoint(radius, endAngle);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 0 ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function c4IconMarkup(value) {
  const radii = [18, 27, 36, 45];
  const activeCount = Math.abs(value);
  const activeSide = value < 0 ? "left" : value > 0 ? "right" : "";
  const paths = radii
    .map((radius, index) => {
      const leftActive = activeSide === "left" && index < activeCount;
      const rightActive = activeSide === "right" && index < activeCount;
      return `
        <path class="c4-ring left ${leftActive ? "active" : ""}" d="${c4ArcPath(radius, 332, 208, 0)}"></path>
        <path class="c4-ring right ${rightActive ? "active" : ""}" d="${c4ArcPath(radius, 28, 152, 1)}"></path>
      `;
    })
    .join("");
  return `<svg class="c4-icon" viewBox="0 0 100 100" aria-hidden="true">${paths}</svg>`;
}

function c4CritIconMarkup(active) {
  const rainbow = active
    ? `
      <path class="c4-crit-rainbow" d="${c4ArcPath(30, 332, 208, 0)}"></path>
      <path class="c4-crit-rainbow" d="${c4ArcPath(30, 28, 152, 1)}"></path>
      <path class="c4-crit-rainbow" d="${c4ArcPath(43, 332, 208, 0)}"></path>
      <path class="c4-crit-rainbow" d="${c4ArcPath(43, 28, 152, 1)}"></path>
    `
    : "";
  return `
    <svg class="c4-icon c4-crit-icon" viewBox="0 0 100 100" aria-hidden="true">
      <path class="c4-ring left ${active ? "active" : ""}" d="${c4ArcPath(30, 332, 208, 0)}"></path>
      <path class="c4-ring right ${active ? "active" : ""}" d="${c4ArcPath(30, 28, 152, 1)}"></path>
      <path class="c4-ring left ${active ? "active" : ""}" d="${c4ArcPath(43, 332, 208, 0)}"></path>
      <path class="c4-ring right ${active ? "active" : ""}" d="${c4ArcPath(43, 28, 152, 1)}"></path>
      ${rainbow}
    </svg>
  `;
}

function c4StepsForValue(value) {
  const count = Math.min(4, Math.abs(Number(value) || 0));
  if (!count) return [];
  const source = value > 0 ? c4PositiveSteps : c4NegativeSteps;
  return source.slice(0, count);
}

function calculateDelayDetailsFor(modalState) {
  if (!modalState) {
    return { base: 8, flat: 0, percent: 0, critBonus: 0, rate: 8, labels: [] };
  }
  let flat = 0;
  let percent = 0;
  let critBonus = 0;
  const labels = [];
  for (const [factor, value] of Object.entries(modalState.factors)) {
    if (factor === "Execution") {
      if (value > 0) labels.push("Execution Crit");
      continue;
    }
    const steps = c4StepsForValue(value);
    if (!steps.length) continue;
    for (const step of steps) {
      flat += step.flat;
      percent += step.percent;
    }
    labels.push(`${factor} ${steps.map((step) => step.label).join(" ")}`);
  }
  const withFlat = Math.max(1, modalState.base + flat);
  const beforeCrit = Math.max(0.1, withFlat * (1 + percent));
  if ((modalState.factors.Execution || 0) > 0) {
    critBonus = Math.max(2, beforeCrit * 0.25);
  }
  const finalValue = beforeCrit + critBonus;
  return {
    base: modalState.base,
    flat,
    percent,
    critBonus,
    rate: Math.ceil(finalValue * 10) / 10,
    labels,
  };
}

function calculateDelayDetails() {
  return calculateDelayDetailsFor(delayModalState);
}

function calculateDelayRate() {
  return calculateDelayDetails().rate;
}

function currentDelaySettings() {
  return settingsFromModalState(delayModalState);
}

function settingsFromModalState(modalState) {
  if (!modalState) return null;
  return {
    base: modalState.base,
    factors: Object.fromEntries(c4Factors.map((factor) => [factor, modalState.factors?.[factor] || 0])),
  };
}

function delaySettingsFromExisting(delay) {
  const saved = delay?.settings || {};
  const base = delayBaseOptions.some((option) => option.value === Number(saved.base)) ? Number(saved.base) : 8;
  const factors = Object.fromEntries(c4Factors.map((factor) => {
    const value = Number(saved.factors?.[factor]) || 0;
    if (factor === "Execution") return [factor, value > 0 ? 1 : 0];
    return [factor, Math.max(-4, Math.min(4, value))];
  }));
  return { base, factors };
}

function defaultDelaySettings() {
  return {
    base: 8,
    factors: Object.fromEntries(c4Factors.map((factor) => [factor, 0])),
  };
}

function delayModifierText(details) {
  const parts = [`Base ${details.base}`];
  if (details.flat) parts.push(`${details.flat > 0 ? "+" : ""}${details.flat}`);
  if (details.percent) parts.push(`${details.percent > 0 ? "+" : ""}${Math.round(details.percent * 100)}%`);
  if (details.critBonus) parts.push(`Crit +${details.critBonus.toFixed(1)}`);
  const summary = parts.join(" ");
  if (!details.labels.length) return summary;
  return `${summary} | ${details.labels.join("; ")}`;
}

function renderBaseGrid(container, modalState, scope) {
  container.innerHTML = delayBaseOptions
    .map((option) => {
      const words = option.label.split(" ").map((word) => `<span>${escapeHtml(word)}</span>`).join("");
      return `
        <button type="button" data-delay-base="${option.value}" data-c4-scope="${scope}" class="${option.value === modalState.base ? "active" : ""}">
          ${words}
          <small>${option.value}</small>
        </button>
      `;
    })
    .join("");
}

function renderC4Grid(container, modalState, scope) {
  container.innerHTML = c4Factors
    .map((factor, index) => {
      const value = modalState.factors[factor] || 0;
      const factorClass = c4GreenFactors.has(factor) ? "green-factor" : "orange-factor";
      const crit = factor === "Execution";
      return `
        <div class="c4-control ${factorClass} ${crit ? "crit-factor" : ""}" data-c4-factor="${escapeHtml(factor)}" data-c4-scope="${scope}">
          <button type="button" class="c4-hit left ${crit ? "crit-toggle" : ""}" data-c4-index="${index}" data-c4-side="${crit ? "toggle" : "left"}" data-c4-scope="${scope}" aria-label="${escapeHtml(factor)} ${crit ? "toggle" : "down"}"></button>
          ${crit ? c4CritIconMarkup(value > 0) : c4IconMarkup(value)}
          ${crit ? "" : `<button type="button" class="c4-hit right" data-c4-index="${index}" data-c4-side="right" data-c4-scope="${scope}" aria-label="${escapeHtml(factor)} up"></button>`}
          <div class="c4-label">${escapeHtml(factor)}${crit ? "<small>(Crit)</small>" : ""}</div>
        </div>
      `;
    })
    .join("");
}

function renderDelayDialog() {
  if (!delayModalState) {
    delayDialog.classList.add("hidden");
    return;
  }
  const unit = state?.units.find((entry) => entry.id === delayModalState.unitId);
  if (!unit) {
    delayModalState = null;
    delayDialog.classList.add("hidden");
    return;
  }

  const delayDetails = calculateDelayDetails();
  delayDialog.classList.remove("hidden");
  delayDialogTitle.textContent = delayModalState.kind === "queued" ? "Queued Effect Setup" : delayModalState.kind === "action" ? "Delayed Resolution" : "Reload/Recovery";
  delayDialogTarget.textContent = `${unit.characterName} - ${unit.playerName}`;
  const instantResolution = !delayModalState.editing && delayDetails.rate > 99;
  delayRatePreview.textContent = instantResolution ? "Instant Resolution!" : delayDetails.rate.toFixed(1);
  delayRatePreview.classList.toggle("instant-resolution", instantResolution);
  delayModifierPreview.textContent = delayModifierText(delayDetails);
  delayActionNameWrap.classList.toggle("hidden", delayModalState.kind !== "action" && delayModalState.kind !== "queued");
  delayActionName.value = delayModalState.label;
  confirmDelayDialog.textContent = delayModalState.editing ? "Confirm Changes" : "Confirm Delay";

  delayDialog.querySelectorAll("[data-delay-kind]").forEach((button) => {
    button.classList.toggle("active", button.dataset.delayKind === delayModalState.kind);
    button.disabled = Boolean(delayModalState.editing);
  });

  renderBaseGrid(delayBaseGrid, delayModalState, "delay");
  renderC4Grid(delayC4Grid, delayModalState, "delay");
}

function openDelayDialog(unitId, kind = "timer", requestId = "", existingDelay = null) {
  const unit = state?.units.find((entry) => entry.id === unitId);
  if (!unit) return;
  const settings = delaySettingsFromExisting(existingDelay);
  const resolvedKind = existingDelay?.kind || kind;
  delayModalState = {
    unitId,
    requestId,
    editing: Boolean(existingDelay),
    delayId: existingDelay?.id || "",
    kind: resolvedKind === "queued" ? "queued" : resolvedKind === "action" ? "action" : "timer",
    label: existingDelay?.label || "",
    base: settings.base,
    factors: settings.factors,
  };
  if (delayModalState.kind === "action") delayModalState.label = "Delayed Resolution";
  if (delayModalState.kind === "queued") delayModalState.label = existingDelay?.label || "Launch Queued Effect";
  if (existingDelay?.kind === "action") delayModalState.label = existingDelay.label || "Delayed Resolution";
  if (existingDelay?.kind === "queued") delayModalState.label = existingDelay.label || "Launch Queued Effect";
  renderDelayDialog();
}

function renderQueuedEffectDialog() {
  if (!queuedEffectModalState) {
    queuedEffectDialog.classList.add("hidden");
    return;
  }
  const unit = state?.units.find((entry) => entry.id === queuedEffectModalState.unitId);
  if (!unit) {
    queuedEffectModalState = null;
    queuedEffectDialog.classList.add("hidden");
    return;
  }
  const details = calculateDelayDetailsFor(queuedEffectModalState);
  queuedEffectDialog.classList.remove("hidden");
  queuedEffectTarget.textContent = `${unit.characterName} - ${unit.playerName}`;
  queuedEffectRatePreview.textContent = details.rate.toFixed(1);
  queuedEffectModifierPreview.textContent = delayModifierText(details);
  queuedEffectName.value = queuedEffectModalState.label;
  renderBaseGrid(queuedEffectBaseGrid, queuedEffectModalState, "queued");
  renderC4Grid(queuedEffectC4Grid, queuedEffectModalState, "queued");
}

function openQueuedEffectDialog(pendingDelay) {
  const defaults = defaultDelaySettings();
  queuedEffectModalState = {
    ...defaults,
    pendingDelay,
    unitId: pendingDelay.unitId,
    label: "Missile Impact",
  };
  renderQueuedEffectDialog();
}

function closeQueuedEffectDialog() {
  queuedEffectModalState = null;
  renderQueuedEffectDialog();
}

function handleC4DialogClick(event, modalState, renderFn, scope) {
  if (!modalState) return;
  const scoped = (element) => !element.dataset.c4Scope || element.dataset.c4Scope === scope;
  const baseButton = event.target.closest("[data-delay-base]");
  if (baseButton && scoped(baseButton)) {
    modalState.base = Number(baseButton.dataset.delayBase) || 8;
    renderFn();
    return;
  }
  const critControl = event.target.closest(".c4-control.crit-factor");
  if (critControl && scoped(critControl)) {
    modalState.factors.Execution = modalState.factors.Execution > 0 ? 0 : 1;
    renderFn();
    return;
  }
  const c4Button = event.target.closest("[data-c4-side]");
  if (c4Button && scoped(c4Button)) {
    const factor = c4Factors[Number(c4Button.dataset.c4Index)];
    if (!factor) return;
    if (factor === "Execution") {
      modalState.factors.Execution = modalState.factors.Execution > 0 ? 0 : 1;
      renderFn();
      return;
    }
    const current = modalState.factors[factor] || 0;
    modalState.factors[factor] = c4Button.dataset.c4Side === "left"
      ? Math.max(-4, current - 1)
      : Math.min(4, current + 1);
    renderFn();
  }
}

async function confirmQueuedEffectDialogAction() {
  if (!queuedEffectModalState?.pendingDelay) return;
  const pending = queuedEffectModalState.pendingDelay;
  const queuedDetails = calculateDelayDetailsFor(queuedEffectModalState);
  const queuedEffect = {
    label: queuedEffectName.value.trim() || "Queued Effect",
    rate: queuedDetails.rate,
    settings: settingsFromModalState(queuedEffectModalState),
  };
  queuedEffectModalState = null;
  delayModalState = null;
  renderQueuedEffectDialog();
  renderDelayDialog();
  await action({
    action: "startDelay",
    id: pending.unitId,
    kind: "queued",
    label: pending.label || "Launch Queued Effect",
    rate: pending.rate,
    settings: pending.settings,
    queuedEffect,
  }, "start");
}

function openDelayForUnit(unitId, kind = "timer") {
  if (!delayConsoleAllowed()) return;
  const unit = state?.units.find((entry) => entry.id === unitId);
  const existingDelay = editableDelayFor(unit);
  if (existingDelay) {
    openDelayDialog(unitId, existingDelay.kind, "", existingDelay);
    return;
  }
  if (state?.activeId === unitId && !state.delayRequest) {
    action({ action: "requestDelay", id: unitId, kind, requestedBy: "gm" }, "tap");
    return;
  }
  openDelayDialog(unitId, kind, state?.delayRequest?.unitId === unitId ? state.delayRequest.id : "");
}

function closeDelayDialog({ cancelRequest = false } = {}) {
  const requestId = delayModalState?.requestId;
  delayModalState = null;
  renderDelayDialog();
  if (cancelRequest && requestId && state?.delayRequest?.id === requestId) {
    action({ action: "cancelDelayRequest" }, "tap");
  }
}

async function confirmDelayDialogAction() {
  if (!delayModalState) return;
  const delay = {
    unitId: delayModalState.unitId,
    kind: delayModalState.kind,
    label: (delayModalState.kind === "action" || delayModalState.kind === "queued") ? delayActionName.value.trim() : "",
    rate: calculateDelayRate(),
    settings: currentDelaySettings(),
    editing: delayModalState.editing,
    delayId: delayModalState.delayId,
  };
  if (!delay.editing && delay.kind === "queued") {
    openQueuedEffectDialog(delay);
    return;
  }
  delayModalState = null;
  renderDelayDialog();
  if (delay.editing) {
    await action({
      action: "updateDelay",
      id: delay.unitId,
      delayId: delay.delayId,
      kind: delay.kind,
      label: delay.label,
      rate: delay.rate,
      settings: delay.settings,
    }, "resolve");
    return;
  }
  if (delay.rate > 99) {
    await action({
      action: "instantDelay",
      id: delay.unitId,
      kind: delay.kind,
      label: delay.label,
      settings: delay.settings,
    }, "resolve");
    return;
  }
  await action({
    action: "startDelay",
    id: delay.unitId,
    kind: delay.kind,
    label: delay.label,
    rate: delay.rate,
    settings: delay.settings,
  }, delay.kind === "action" ? "start" : "tap");
}

function hexToRgb(hex) {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#39e58f";
  const value = Number.parseInt(clean.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function stableOffset(value, range) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % range;
  return hash;
}

function barStyle(unit) {
  const color = unit.color || "#39e58f";
  const rgb = hexToRgb(color);
  const flareLeft = Math.max(8, Math.min(96, pct(unit)));
  return `--bar-color:${color}; --bar-rgb:${rgb.r}, ${rgb.g}, ${rgb.b}; --own-flare-left:${flareLeft}%;`;
}

function ringOrderKey() {
  return `sa-atb-ring-order-${currentRoomCode || "local"}-${mode === "gm" ? "gm" : "player"}`;
}

function loadRingOrder() {
  try {
    const order = JSON.parse(localStorage.getItem(ringOrderKey()) || "[]");
    return Array.isArray(order) ? order : [];
  } catch {
    return [];
  }
}

function saveRingOrder(order) {
  safeLocalStorageSet(ringOrderKey(), JSON.stringify(order));
}

function ringOrderedUnits(units) {
  const remaining = new Map(units.map((unit) => [unit.id, unit]));
  const ordered = [];
  for (const id of loadRingOrder()) {
    const unit = remaining.get(id);
    if (!unit) continue;
    ordered.push(unit);
    remaining.delete(id);
  }
  return [...ordered, ...units.filter((unit) => remaining.has(unit.id))];
}

function setRingOrderFromUnits(units) {
  saveRingOrder(units.map((unit) => unit.id));
}

function shuffleNpcDefaultBag() {
  npcDefaultBag = npcDefaults.slice();
  for (let i = npcDefaultBag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [npcDefaultBag[i], npcDefaultBag[j]] = [npcDefaultBag[j], npcDefaultBag[i]];
  }
}

function nextNpcDefault() {
  if (!npcDefaultBag.length) shuffleNpcDefaultBag();
  return npcDefaultBag.pop() || npcDefaults[0];
}

function previewNpcDefault() {
  if (!npcDefaultBag.length) shuffleNpcDefaultBag();
  return npcDefaultBag[npcDefaultBag.length - 1] || npcDefaults[0];
}

function applyNpcDefaultPreview({ force = false } = {}) {
  if (!gmTeam || gmTeam.value !== "npc") return;
  const next = previewNpcDefault();
  if (force || !gmCharacterName.value.trim()) gmCharacterName.value = next.characterName;
  if (force || !gmSpeedRating.value) gmSpeedRating.value = String(next.speed);
  if (force || !gmColor.value) gmColor.value = next.color;
}

function polarPoint(cx, cy, radius, degrees) {
  const radians = (degrees - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function describeWedge(cx, cy, radius, startAngle, endAngle) {
  if (radius <= 1) return `M ${cx} ${cy}`;
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function describeRingSideWall(cx, cy, radius, startAngle, endAngle, depth) {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const startDrop = { x: start.x, y: start.y + depth };
  const endDrop = { x: end.x, y: end.y + depth };
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return [
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    `L ${endDrop.x.toFixed(2)} ${endDrop.y.toFixed(2)}`,
    `A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} 0 ${startDrop.x.toFixed(2)} ${startDrop.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function frontDepthForAngle(angle, depth = 38) {
  const normalized = (angle + 360) % 360;
  if (normalized < 88 || normalized > 272) return 0;
  const frontFactor = Math.sin(((normalized - 88) / 184) * Math.PI);
  return frontFactor <= 0.08 ? 0 : depth * (0.28 + frontFactor * 0.72);
}

function ringFrontSeamPath(angle, radius = 141, depth = 38) {
  const normalized = (angle + 360) % 360;
  const seamDepth = frontDepthForAngle(angle, depth);
  if (!seamDepth) return "";
  const top = polarPoint(160, 160, radius, normalized);
  const bottom = { x: top.x, y: top.y + seamDepth };
  return `<path class="ring-side-seam" d="M ${top.x.toFixed(2)} ${top.y.toFixed(2)} L ${bottom.x.toFixed(2)} ${bottom.y.toFixed(2)}" />`;
}

function ringFrontWallSegment(unit, startAngle, endAngle, rgb, radius = 141, depth = 38) {
  const segmentStart = Math.max(startAngle, 88);
  const segmentEnd = Math.min(endAngle, 272);
  if (segmentEnd <= segmentStart) return "";
  const color = unit.color || "#39e58f";
  const dark = `rgb(${Math.max(0, rgb.r - 78)}, ${Math.max(0, rgb.g - 78)}, ${Math.max(0, rgb.b - 78)})`;
  return `
    <path
      class="ring-side-wall-segment"
      d="${describeRingSideWall(160, 160, radius, segmentStart, segmentEnd, depth)}"
      style="--segment-color:${escapeHtml(color)}; --segment-dark:${dark}; --bar-rgb:${rgb.r}, ${rgb.g}, ${rgb.b};"
    />
  `;
}

function ringInnerLabel(unit, sliceCount) {
  const name = unit.characterName || "Character";
  const words = name.split(/\s+/).filter(Boolean);
  if (sliceCount >= 12) {
    return words
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  }
  if (sliceCount >= 9 && words.length > 2) return `${words[0]} ${words[words.length - 1]}`;
  if (sliceCount >= 9 && name.length > 14) return name.slice(0, 13).trim() + ".";
  return name;
}

function ringInnerLabelSize(label, sliceCount) {
  const base = sliceCount <= 6 ? 17 : sliceCount <= 8 ? 14 : sliceCount <= 10 ? 11.5 : 9.5;
  const lengthPenalty = Math.max(0, label.length - 9) * 0.55;
  return Math.max(6.8, base - lengthPenalty);
}

function ringDelayPocket(delay, startAngle, endAngle, radius, className) {
  if (!delay) return "";
  const gap = Math.min(5, Math.max(1.5, (endAngle - startAngle) * 0.08));
  const usableStart = startAngle + gap;
  const usableEnd = Math.max(usableStart + 0.1, endAngle - gap);
  const targetEnd = usableStart + (usableEnd - usableStart) * (delayPercent(delay) / 100);
  return `<path class="ring-delay-pocket ${className}" d="${describeArc(160, 160, radius, usableStart, targetEnd)}" />`;
}

function ringCommandDrain(unit, startAngle, endAngle) {
  const command = commandFor(unit);
  if (!command || command.unitId !== unit.id) return "";
  const remaining = command.expired ? 0 : commandPercent(command);
  const drainRadius = 18 + (118 * (100 - remaining)) / 100;
  if (drainRadius <= 20) return "";
  return `<path class="ring-command-drain" d="${describeWedge(160, 160, Math.min(136, drainRadius), startAngle, endAngle)}" />`;
}

function ringQueuedEffects(unit, startAngle, endAngle) {
  const effects = queuedEffectsFor(unit);
  if (!effects.length) return "";
  const width = Math.max(4, (endAngle - startAngle) * 0.22);
  return effects
    .map((effect, index) => {
      const miniStart = endAngle + 1.5 + index * (width + 1);
      const miniEnd = miniStart + width;
      const fillRadius = 18 + (116 * queuedEffectPercent(effect)) / 100;
      return `
        <g class="ring-queued-effect ${effect.resolving ? "resolving" : ""}">
          <path class="ring-queued-shell" d="${describeWedge(160, 160, 136, miniStart, miniEnd)}"></path>
          <path class="ring-queued-fill" d="${describeWedge(160, 160, Math.min(136, fillRadius), miniStart, miniEnd)}"></path>
        </g>
      `;
    })
    .join("");
}

function ringActionButtons(unit, midAngle) {
  if (mode !== "gm") return "";
  const radians = (midAngle - 90) * (Math.PI / 180);
  const x = 50 + Math.cos(radians) * 51;
  const y = 49 + Math.sin(radians) * 36;
  const id = escapeHtml(unit.id);
  const delayDisabled = !delayConsoleAllowed();
  return `
    <div class="ring-action-cluster" style="--ring-action-x:${x.toFixed(2)}%; --ring-action-y:${y.toFixed(2)}%;">
      <button class="ring-action-btn delay-button ${delayDisabled ? "delay-blocked" : ""}" data-action="delay" data-id="${id}" title="${delayDisabled ? "Pause Everything before opening Delay" : "Delay"}" aria-disabled="${delayDisabled ? "true" : "false"}"><span class="delay-label-main">DL</span><span class="delay-label-blocked">DL</span></button>
      <button class="ring-action-btn" data-action="nudge" data-id="${id}" title="Add 5% ATB">+5</button>
      <button class="ring-action-btn danger" data-action="remove" data-id="${id}" title="Remove">X</button>
    </div>
  `;
}

function tacticalRingMarkup(units) {
  if (!units.length) {
    return `
      <div class="tactical-ring-empty">
        <strong>No combatants loaded.</strong>
        <span>Add characters or NPCs to populate the tactical ring.</span>
      </div>
    `;
  }

  const ordered = ringOrderedUnits(units);
  const slice = 360 / ordered.length;
  const gap = Math.min(2.2, slice * 0.08);
  const active = activeUnit();
  const defs = [];
  const slices = [];
  const controls = [];
  const actionButtons = [];
  const sideWalls = [];
  const sideSeams = [];

  ordered.forEach((unit, index) => {
    const start = index * slice + gap / 2;
    const end = (index + 1) * slice - gap / 2;
    const mid = start + (end - start) / 2;
    const rgb = hexToRgb(unit.color || "#39e58f");
    const gradId = `ringGrad${unit.id.replace(/[^a-zA-Z0-9]/g, "")}`;
    const atbRadius = 18 + (116 * pct(unit)) / 100;
    const delayed = hasAnyDelay(unit);
    const ready = unit.atb >= state.threshold && !delayed;
    const own = mode === "player" && unit.id === myUnitId;
    const icon = mode === "player" ? myIconForUnit(unit) : "";
    const labelPoint = polarPoint(160, 160, 83, mid);
    const label = ringInnerLabel(unit, ordered.length);
    const labelSize = ringInnerLabelSize(label, ordered.length);

    defs.push(`
      <radialGradient id="${gradId}" cx="50%" cy="46%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.36)" />
        <stop offset="22%" stop-color="rgba(${rgb.r},${rgb.g},${rgb.b},0.84)" />
        <stop offset="67%" stop-color="${escapeHtml(unit.color || "#39e58f")}" />
        <stop offset="100%" stop-color="rgba(${Math.max(0, rgb.r - 58)},${Math.max(0, rgb.g - 58)},${Math.max(0, rgb.b - 58)},0.96)" />
      </radialGradient>
    `);

    slices.push(`
      <g class="ring-unit ${ready ? "ready" : ""} ${delayed ? "delayed" : ""} ${own ? "own-ring-unit" : ""} ${active?.id === unit.id ? "active-ring-unit" : ""} ${ringDrag?.id === unit.id ? "dragging" : ""} ${ringMovedId === unit.id ? "moved" : ""}" data-unit-id="${unit.id}" style="--bar-color:${escapeHtml(unit.color || "#39e58f")}; --bar-rgb:${rgb.r}, ${rgb.g}, ${rgb.b};">
        <path class="ring-slice-shell" d="${describeWedge(160, 160, 136, start, end)}" />
        <path class="ring-slice-fill" d="${describeWedge(160, 160, atbRadius, start, end)}" fill="url(#${gradId})" />
        <path class="ring-slice-sheen" d="${describeWedge(160, 160, Math.min(136, atbRadius + 2), start, end)}" />
        ${active?.id === unit.id ? ringCommandDrain(unit, start, end) : ""}
        ${ringDelayPocket(delayedActionFor(unit), start, end, 106, "action-delay")}
        ${ringDelayPocket(delayTimerFor(unit), start, end, 92, "timer-delay")}
        ${ringQueuedEffects(unit, start, end)}
        <text class="ring-slice-name" x="${labelPoint.x.toFixed(2)}" y="${labelPoint.y.toFixed(2)}" style="font-size:${labelSize.toFixed(2)}px;">${escapeHtml(label)}</text>
        ${icon ? `<image class="ring-avatar" href="${escapeHtml(icon)}" x="${(labelPoint.x - 12).toFixed(2)}" y="${(labelPoint.y - 12).toFixed(2)}" width="24" height="24" />` : ""}
      </g>
    `);

    controls.push(`<path class="ring-slice-control draggable" data-unit-id="${unit.id}" d="${describeWedge(160, 160, 154, start, end)}" />`);
    actionButtons.push(ringActionButtons(unit, mid));
    sideWalls.push(ringFrontWallSegment(unit, start, end, rgb));
    sideSeams.push(ringFrontSeamPath(start), ringFrontSeamPath(end));
  });

  return `
    <div class="tactical-ring-view" data-count="${ordered.length}">
      <div class="ring-instructions">${mode === "gm" ? "Long-hold any slice to reposition it around the table." : "Tactical ring view is local to this screen."}</div>
      <div class="ring-stage">
        <svg class="tactical-ring-svg" viewBox="0 0 320 320" role="img" aria-label="ATB tactical ring" xmlns:xlink="http://www.w3.org/1999/xlink">
          <defs>
            <linearGradient id="ringLipGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#5e0710" />
              <stop offset="18%" stop-color="#e31928" />
              <stop offset="52%" stop-color="#ff2936" />
              <stop offset="82%" stop-color="#93101a" />
              <stop offset="100%" stop-color="#3b0509" />
            </linearGradient>
            ${defs.join("")}
          </defs>
          <ellipse class="ring-shadow" cx="160" cy="174" rx="132" ry="116" />
          ${sideWalls.join("")}
          ${sideSeams.join("")}
          <circle class="ring-backplate" cx="160" cy="160" r="139" />
          ${slices.join("")}
          <path class="ring-front-lip" d="${describeArc(160, 160, 141, 88, 272)}" />
          <circle class="ring-core" cx="160" cy="160" r="34" />
          <text class="ring-core-text" x="160" y="153">${state.running && !state.hardPaused ? "ATB" : "HOLD"}</text>
          <text class="ring-core-subtext" x="160" y="172">${readyCount.textContent}</text>
          ${controls.join("")}
        </svg>
        ${mode === "gm" ? `<div class="ring-action-orbit">${actionButtons.join("")}</div>` : ""}
      </div>
      <div class="ring-legend">
        <span><i class="timer-delay"></i>Reload/Recovery</span>
        <span><i class="action-delay"></i>Delayed Resolution</span>
      </div>
    </div>
  `;
}

function iconStore() {
  try {
    return JSON.parse(localStorage.getItem("sa-atb-character-icons") || "{}");
  } catch {
    return {};
  }
}

async function imageFileToIconDataUrl(file) {
  if (!file || !String(file.type || "").startsWith("image/")) return "";
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) return "";

    let size = ICON_MAX_SIZE;
    while (size >= 96) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return "";
      context.fillStyle = "#08111f";
      context.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", ICON_JPEG_QUALITY);
      if (dataUrl.length <= ICON_STORAGE_LIMIT || size === 96) return dataUrl;
      size = Math.floor(size * 0.75);
    }
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return "";
}

function saveIconForCharacter(name, dataUrl) {
  const key = String(name || "").trim().toLowerCase();
  if (!key || !dataUrl || dataUrl.length > ICON_STORAGE_LIMIT) return false;
  const icons = iconStore();
  icons[key] = dataUrl;
  if (safeLocalStorageSet("sa-atb-character-icons", JSON.stringify(icons))) return true;
  return safeLocalStorageSet("sa-atb-character-icons", JSON.stringify({ [key]: dataUrl }));
}

function iconForCharacter(name) {
  const key = String(name || "").trim().toLowerCase();
  return key ? iconStore()[key] || "" : "";
}

function myIconForUnit(unit) {
  if (!unit || unit.id !== myUnitId) return "";
  return selectedCharacterIcon || iconForCharacter(unit.characterName);
}

function setActionLogEnabled(enabled) {
  playerActionLogEnabled = Boolean(enabled);
  safeLocalStorageSet("sa-atb-action-log-enabled", playerActionLogEnabled ? "on" : "off");
  if (playerActionLogToggle) playerActionLogToggle.checked = playerActionLogEnabled;
}

function setConnected(isConnected, message) {
  connectionStatus.classList.toggle("connected", isConnected);
  connectionStatus.classList.toggle("disconnected", !isConnected);
  connectionStatus.textContent = isConnected
    ? "Connected."
    : message || "Cannot reach the ATB room server. Start the server launcher, then refresh this page.";
}

function receiveState(nextState, { force = false } = {}) {
  if (!nextState) return false;
  if (!force && state?.revision && nextState.revision && nextState.revision < state.revision) return false;
  state = nextState;
  render();
  return true;
}

async function action(payload, soundName = "tap") {
  let response;
  try {
    response = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, roomCode: currentRoomCode }),
    });
  } catch {
    setConnected(false, "Cannot reach the ATB room server. Check the connection, then try again.");
    return state;
  }
  if (!response.ok) {
    if (response.status === 404) {
      returnToWelcome("That room expired. Create or join a new room.");
    } else {
      setConnected(false, "The ATB room server rejected that action. Try again.");
    }
    return state;
  }
  try {
    const nextState = await response.json();
    receiveState(nextState, { force: true });
  } catch {
    setConnected(false, "The ATB room server sent an unreadable response. Try again.");
    return state;
  }
  if (mode === "gm") playGmSound(soundName);
  return state;
}

function setMode(next) {
  mode = next;
  safeLocalStorageSet("sa-atb-mode", mode);
  render();
}

function setVisualMode(next) {
  visualMode = next === "ring" ? "ring" : "bars";
  render();
}

function setRoom(nextState) {
  state = nextState;
  currentRoomCode = state.roomCode;
  safeLocalStorageSet("sa-atb-room-code", currentRoomCode);
  connectEvents();
}

function connectEvents() {
  if (events) events.close();
  if (!currentRoomCode) return;
  events = new EventSource(`/events?room=${encodeURIComponent(currentRoomCode)}`);
  events.addEventListener("state", (event) => {
    setConnected(true);
    receiveState(JSON.parse(event.data));
  });
  events.addEventListener("error", () => {
    setConnected(false, "Cannot reach this ATB room. It may have expired or the server may be waking up.");
    verifySavedRoomStillExists();
  });
}

async function verifySavedRoomStillExists() {
  if (!currentRoomCode || mode === "welcome" || mode === "roomJoin") return;
  try {
    const response = await fetch(`/api/state?room=${encodeURIComponent(currentRoomCode)}`);
    if (response.status === 404) {
      returnToWelcome("That room expired. Create or join a new room.");
      return;
    }
    if (response.ok && !events) {
      setRoom(await response.json());
      render();
    }
  } catch {
    // Keep the current screen during brief network wake-ups; the visible warning is enough.
  }
}

async function keepRoomAwake() {
  if (mode !== "gm" || !currentRoomCode) return;
  try {
    const response = await fetch(`/api/keep-alive?room=${encodeURIComponent(currentRoomCode)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status === 404) {
      returnToWelcome("That room expired. Create or join a new room.");
      return;
    }
    if (!response.ok) {
      setConnected(false, "Trying to keep the ATB room awake...");
      return;
    }
    receiveState(await response.json());
    setConnected(true);
  } catch {
    setConnected(false, "Trying to keep the ATB room awake...");
  }
}

function unitCard(unit, { gm = false, player = false } = {}) {
  const delayed = hasAnyDelay(unit);
  const ready = unit.atb >= state.threshold && !delayed;
  const atbPercent = Math.min(100, unit.atb);
  const close = atbPercent >= 75 && !ready && !delayed;
  const hotClass = atbPercent >= 95 && !ready && !delayed ? "charge-critical" : atbPercent >= 90 && !ready && !delayed ? "charge-hot" : close ? "charge-warm" : "";
  const own = player && unit.id === myUnitId;
  const icon = player ? myIconForUnit(unit) : "";
  const speed = formatSpeed(unit.speed);
  const command = commandFor(unit);
  const speedInputValue = unit.speed ? formatSpeed(unit.speed) : "";
  const commandLabel = unit.team === "pc"
    ? `${unit.commandWindow || "Unset"} sec Command`
    : "No Command Window";
  const setupMissing = !unit.speed || (unit.team === "pc" && !unit.commandWindow);
  const delayDisabled = gm && !delayConsoleAllowed();
  const side = unit.team === "pc" ? "PC" : "NPC";
  const type = "Character";
  const signature = unitSignature(unit, { gm, player });
  return `
    <article class="unit-card ${ready ? "ready" : ""} ${close ? "close-ready" : ""} ${hotClass} ${delayed ? "delayed" : ""} ${own ? "own-unit" : ""} ${icon ? "has-avatar" : ""}" data-unit-id="${unit.id}" data-signature="${escapeHtml(signature)}" style="${barStyle(unit)}">
      <div class="unit-top">
        ${icon ? `<img class="unit-avatar" src="${escapeHtml(icon)}" alt="" />` : ""}
        <div>
          <div class="unit-name">${escapeHtml(unit.characterName)}</div>
          <div class="unit-owner">${escapeHtml(unit.playerName)} - ${side} ${type}${player ? "" : ` - Speed ${speed}${unit.speed ? "%/sec" : ""} - ${escapeHtml(commandLabel)}`}</div>
        </div>
        ${
          player && own
            ? `<label class="player-color-inline" title="Change your ATB color">
                <span>Color</span>
                <input data-action="playerColor" data-id="${unit.id}" type="color" value="${escapeHtml(unit.color || "#39e58f")}" />
              </label>`
            : ""
        }
        <div class="unit-readout">
          <strong>${Math.floor(atbPercent)}%</strong>
          <span>${delayed ? "Delayed" : player ? (ready ? "Ready" : "Charging") : escapeHtml(estimateTurn(unit))}</span>
        </div>
        ${
          gm
            ? `<div class="unit-actions">
                <label class="name-edit">
                  Name
                  <input data-action="name" data-id="${unit.id}" value="${escapeHtml(unit.characterName)}" />
                </label>
                <label class="speed-edit">
                  Speed
                  <input data-action="speed" data-id="${unit.id}" type="number" min="1" max="100" step="0.5" value="${speedInputValue}" />
                </label>
                ${
                  unit.team === "pc"
                    ? `<label class="command-edit">
                        Command
                        <input data-action="commandWindow" data-id="${unit.id}" type="number" min="1" max="999" step="1" value="${unit.commandWindow || ""}" />
                      </label>`
                    : ""
                }
                <label class="color-edit">
                  Color
                  <input data-action="color" data-id="${unit.id}" type="color" value="${escapeHtml(unit.color || "#39e58f")}" />
                </label>
                <button class="mini delay-button ${delayDisabled ? "delay-blocked" : ""}" data-action="delay" data-id="${unit.id}" title="${delayDisabled ? "Pause Everything before opening Delay" : "Delay"}" aria-disabled="${delayDisabled ? "true" : "false"}"><span class="delay-label-main">Delay</span><span class="delay-label-blocked">Delay</span></button>
                <button class="mini" data-action="nudge" data-id="${unit.id}">+5%</button>
                <button class="mini danger" data-action="remove" data-id="${unit.id}">Remove</button>
              </div>`
            : ""
        }
      </div>
      ${
        command
          ? `<div class="command-bar ${command.expired ? "expired" : ""}">
              <div class="command-bar-fill" style="width:${command.expired ? 0 : commandPercent(command)}%"></div>
              <span>${command.expired ? "Interruption pending" : `${formatSeconds(command.remaining)} Command Window`}</span>
            </div>`
          : setupMissing && gm
            ? `<div class="setup-warning">Awaiting GM-entered Speed${unit.team === "pc" ? " and Command Window" : ""}.</div>`
            : ""
      }
      ${
        delayBarsMarkup(unit)
      }
      ${
        queuedEffectsMarkup(unit, { gm })
      }
      <div class="meter"><div class="fill" style="width:${pct(unit)}%"></div></div>
    </article>
  `;
}

function unitSignature(unit, { gm = false, player = false } = {}) {
  const command = commandFor(unit);
  const setupMissing = !unit.speed || (unit.team === "pc" && !unit.commandWindow);
  return [
    gm ? "gm" : "nogm",
    player ? "player" : "notplayer",
    unit.id,
    unit.playerName,
    unit.characterName,
    unit.speed || "",
    unit.commandWindow || "",
    unit.color || "",
    unit.team,
    state?.hardPaused ? "hardpaused" : "not-hardpaused",
    gm ? (delayConsoleAllowed() ? "delay-open" : "delay-closed") : "delay-na",
    delayTimerFor(unit) ? `timer:${delayTimerFor(unit).remaining}:${delayTimerFor(unit).rate}:${delayTimerFor(unit).resolving ? "resolving" : "waiting"}` : "notimer",
    delayedActionFor(unit) ? `action:${delayedActionFor(unit).label}:${delayedActionFor(unit).remaining}:${delayedActionFor(unit).rate}:${delayedActionFor(unit).resolving ? "resolving" : "waiting"}` : "noaction",
    queuedEffectsFor(unit).map((effect) => `queue:${effect.id}:${effect.label}:${effect.rate}:${effect.impairments}:${effect.resolving ? "resolving" : "filling"}`).join(",") || "noqueue",
    myIconForUnit(unit) ? "icon" : "noicon",
    command ? `command:${command.expired ? "expired" : "active"}` : "nocommand",
    setupMissing ? "setup" : "ready-setup",
  ].join("|");
}

function updateUnitCard(card, unit, { gm = false, player = false } = {}) {
  const delayed = hasAnyDelay(unit);
  const ready = unit.atb >= state.threshold && !delayed;
  const atbPercent = Math.min(100, unit.atb);
  const close = atbPercent >= 75 && !ready && !delayed;
  const hotClass = atbPercent >= 95 && !ready && !delayed ? "charge-critical" : atbPercent >= 90 && !ready && !delayed ? "charge-hot" : close ? "charge-warm" : "";
  const own = player && unit.id === myUnitId;
  card.className = `unit-card ${ready ? "ready" : ""} ${close ? "close-ready" : ""} ${hotClass} ${delayed ? "delayed" : ""} ${own ? "own-unit" : ""} ${myIconForUnit(unit) ? "has-avatar" : ""}`.trim();
  card.setAttribute("style", barStyle(unit));

  const readout = card.querySelector(".unit-readout strong");
  if (readout) readout.textContent = `${Math.floor(atbPercent)}%`;
  const status = card.querySelector(".unit-readout span");
  if (status) status.textContent = delayed ? "Delayed" : player ? (ready ? "Ready" : "Charging") : estimateTurn(unit);

  const fill = card.querySelector(".fill");
  if (fill) fill.style.width = `${pct(unit)}%`;

  if (gm) {
    const delayButtons = card.querySelectorAll('button[data-action="delay"]');
    const delayDisabled = !delayConsoleAllowed();
    delayButtons.forEach((button) => {
      button.classList.toggle("delay-blocked", delayDisabled);
      button.setAttribute("aria-disabled", delayDisabled ? "true" : "false");
      button.title = delayDisabled ? "Pause Everything before opening Delay" : "Delay";
    });
  }

  const command = commandFor(unit);
  const commandBar = card.querySelector(".command-bar");
  if (command && commandBar) {
    commandBar.classList.toggle("expired", command.expired);
    const commandFill = commandBar.querySelector(".command-bar-fill");
    if (commandFill) commandFill.style.width = `${command.expired ? 0 : commandPercent(command)}%`;
    const commandLabel = commandBar.querySelector("span");
    if (commandLabel) commandLabel.textContent = command.expired ? "Interruption pending" : `${formatSeconds(command.remaining)} Command Window`;
  }

  const nextDelayMarkup = delayBarsMarkup(unit);
  const currentDelayBars = card.querySelectorAll(".delay-bar");
  if (currentDelayBars.length !== delayBars(unit).length) {
    const meter = card.querySelector(".meter");
    currentDelayBars.forEach((bar) => bar.remove());
    if (meter && nextDelayMarkup) meter.insertAdjacentHTML("beforebegin", nextDelayMarkup);
  } else {
    delayBars(unit).forEach(({ delay }, index) => {
      const delayBar = currentDelayBars[index];
      const delayFill = delayBar?.querySelector(".delay-bar-fill");
      if (delayFill) delayFill.style.width = `${delayPercent(delay)}%`;
      const delayLabel = delayBar?.querySelector("span");
      if (delayLabel) delayLabel.textContent = `${delayText(delay)} - ${formatSeconds(delaySeconds(delay))}`;
    });
  }

  const nextQueuedMarkup = queuedEffectsMarkup(unit, { gm });
  const currentQueuedBars = card.querySelectorAll(".queued-effect-bar");
  if (currentQueuedBars.length !== queuedEffectsFor(unit).length) {
    currentQueuedBars.forEach((bar) => bar.remove());
    const meter = card.querySelector(".meter");
    if (meter && nextQueuedMarkup) meter.insertAdjacentHTML("beforebegin", nextQueuedMarkup);
  } else {
    queuedEffectsFor(unit).forEach((effect, index) => {
      const effectBar = currentQueuedBars[index];
      effectBar?.classList.toggle("resolving", Boolean(effect.resolving));
      const effectFill = effectBar?.querySelector(".queued-effect-fill");
      if (effectFill) effectFill.style.width = `${queuedEffectPercent(effect)}%`;
      const effectLabel = effectBar?.querySelector("span");
      if (effectLabel) effectLabel.textContent = `${effect.label} - ${Math.floor(queuedEffectPercent(effect))}%${effect.resolving ? " - READY" : ` - ${formatSeconds(queuedEffectSeconds(effect))}`}`;
      const pips = effectBar?.querySelectorAll(".queued-effect-pips i") || [];
      const impairments = Math.max(0, Math.min(3, Number(effect.impairments) || 0));
      pips.forEach((pip, pipIndex) => pip.classList.toggle("active", pipIndex < impairments));
    });
  }
}

function renderUnitList(sorted) {
  const gm = mode === "gm";
  const player = mode === "player";
  const existingCards = [...unitList.querySelectorAll(".unit-card[data-unit-id]")];
  const canUpdateInPlace =
    existingCards.length === sorted.length &&
    existingCards.every((card, index) => {
      const unit = sorted[index];
      return card.dataset.unitId === unit.id && card.dataset.signature === unitSignature(unit, { gm, player });
    });

  if (canUpdateInPlace) {
    existingCards.forEach((card, index) => updateUnitCard(card, sorted[index], { gm, player }));
    return;
  }

  const previousPositions = new Map(
    [...unitList.querySelectorAll(".unit-card[data-unit-id]")].map((card) => [
      card.dataset.unitId,
      card.getBoundingClientRect(),
    ]),
  );
  const previousWidths = new Map(
    [...unitList.querySelectorAll(".unit-card[data-unit-id]")].map((card) => {
      const meter = card.querySelector(".meter");
      const fill = card.querySelector(".fill");
      const meterWidth = meter?.getBoundingClientRect().width || 0;
      const fillWidth = fill?.getBoundingClientRect().width || 0;
      const width = meterWidth > 0 ? `${Math.max(0, Math.min(100, (fillWidth / meterWidth) * 100))}%` : "0%";
      return [card.dataset.unitId, width];
    }),
  );

  unitList.innerHTML = sorted.map((unit) => unitCard(unit, { gm, player })).join("");

  const cards = [...unitList.querySelectorAll(".unit-card[data-unit-id]")];
  for (const card of cards) {
    const fill = card.querySelector(".fill");
    const previousWidth = previousWidths.get(card.dataset.unitId);
    if (fill && previousWidth) {
      const targetWidth = fill.style.width;
      fill.style.transition = "none";
      fill.style.width = previousWidth;
      requestAnimationFrame(() => {
        fill.style.transition = "";
        fill.style.width = targetWidth;
      });
    }

    const previous = previousPositions.get(card.dataset.unitId);
    if (!previous) continue;
    const current = card.getBoundingClientRect();
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaY) < 1) continue;
    card.classList.add("is-moving");
    card.style.transform = `translateY(${deltaY}px)`;
    card.style.transition = "none";
  }

  requestAnimationFrame(() => {
    for (const card of cards) {
      if (!card.classList.contains("is-moving")) continue;
      card.style.transition = "";
      card.style.transform = "";
      card.addEventListener(
        "transitionend",
        () => {
          card.classList.remove("is-moving");
        },
        { once: true },
      );
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function statusText() {
  if (!state) return "Connecting";
  if (state.hardPaused) return "Paused";
  if (state.pausedForTurn) return "Turn Paused";
  return state.running ? "Clock Engaged" : "Waiting for GM";
}

function activeUnit() {
  return state?.units.find((unit) => unit.id === state.activeId) || null;
}

function turnPanelOpen() {
  return !turnDialog.classList.contains("hidden");
}

function showTurnPanel() {
  turnDialog.classList.remove("hidden");
}

function closeTurnPanel() {
  turnDialog.classList.add("hidden");
}

function unitRoleText(unit) {
  if (!unit) return "";
  const side = unit.team === "pc" ? "PC" : "NPC";
  return `${unit.playerName} - ${side} Character`;
}

function renderActivePanel() {
  const active = activeUnit();
  const activeAction = state.activeAction;
  activePanel.classList.toggle("turn-live", Boolean(active || activeAction));
  activePanel.classList.toggle("own-turn", Boolean(active) && active.id === myUnitId);
  activePanel.classList.toggle("other-turn", Boolean(activeAction) || (Boolean(active) && active.id !== myUnitId));
  activePanel.classList.toggle("clock-running", state.running && !state.pausedForTurn && !state.hardPaused);

  if (mode === "player") {
    const mine = state.units.find((unit) => unit.id === myUnitId);
    activeKicker.textContent = "Player Signal";
    if (activeAction) {
      activeTitle.textContent = `${activeAction.kind === "queuedEffect" ? "Resolve Queued Effect" : activeAction.kind === "queued" ? "Resolve Queued Setup" : "Resolve Action"}: ${activeAction.label}`;
      activeMeta.textContent = `${activeAction.characterName} - ${activeAction.playerName}`;
    } else if (active && active.id === myUnitId) {
      activeTitle.textContent = "YOUR TURN";
      activeMeta.textContent = `${active.characterName} - ${unitRoleText(active)}`;
    } else if (active) {
      activeTitle.textContent = `${active.characterName}'s turn`;
      activeMeta.textContent = unitRoleText(active);
    } else if (mine) {
      activeTitle.textContent = state.hardPaused ? "ATB clock paused" : state.running ? "ATB clock engaged" : "Waiting for GM";
      activeMeta.textContent = estimateTurn(mine);
    } else {
      activeTitle.textContent = "Join or reclaim a character";
      activeMeta.textContent = "No character linked";
    }
    return;
  }

  if (activeAction) {
    activeKicker.textContent = activeAction.kind === "queuedEffect" ? "Queued Effect" : activeAction.kind === "queued" ? "Queued Setup" : "Delayed Resolution";
    activeTitle.textContent = `${activeAction.kind === "queuedEffect" ? "Resolve Queued Effect" : activeAction.kind === "queued" ? "Resolve Queued Setup" : "Resolve Action"}: ${activeAction.label}`;
    activeMeta.textContent = `${activeAction.characterName} - ${activeAction.playerName}`;
    return;
  }

  if (active) {
    activeKicker.textContent = "Active Turn";
    activeTitle.textContent = active.characterName;
    const command = commandFor(active);
    activeMeta.textContent = command
      ? `${unitRoleText(active)} - ${command.expired ? "interruption pending" : `${formatSeconds(command.remaining)} Command Window`}`
      : `${unitRoleText(active)} - Speed ${formatSpeed(active.speed)}%/sec`;
    return;
  }

  if (state.hardPaused) {
    activeKicker.textContent = "Clock Status";
    activeTitle.textContent = "All timers paused";
    activeMeta.textContent = "Engage Clock to resume";
    return;
  }

  if (state.running) {
    const next = [...state.units]
      .filter((unit) => !hasAnyDelay(unit) && unit.atb < state.threshold && unit.speed)
      .sort((a, b) => (state.threshold - a.atb) / a.speed - (state.threshold - b.atb) / b.speed)[0];
    activeKicker.textContent = "Clock Engaged";
    activeTitle.textContent = next ? `${next.characterName} is next` : "Awaiting participants";
    activeMeta.textContent = next ? estimateTurn(next) : "Add characters to begin";
    return;
  }

  activeKicker.textContent = "Clock Status";
  activeTitle.textContent = state.units.length ? "Waiting for GM to engage clock" : "Waiting for characters to join";
  activeMeta.textContent = state.units.length ? `${state.units.length} participant(s) standing by` : "No active turn";
}

function renderRejoinOptions() {
  const options = state.units.filter((unit) => unit.controlledBy === "player");
  rejoinBlock.classList.toggle("hidden", mode !== "join" || options.length === 0);
  rejoinSelect.innerHTML = options
    .map((unit) => `<option value="${unit.id}">${escapeHtml(unit.characterName)} - ${escapeHtml(unit.playerName)}</option>`)
    .join("");
}

function notifyTurnIfNeeded() {
  if (!state) return;
  if (state.activeAction) {
    if (mode === "gm") {
      turnDialogKicker.textContent = state.activeAction.kind === "queuedEffect" ? "Queued Effect" : state.activeAction.kind === "queued" ? "Queued Setup" : "Delayed Resolution";
      activeName.textContent = `${state.activeAction.kind === "queuedEffect" ? "Resolve Queued Effect" : state.activeAction.kind === "queued" ? "Resolve Queued Setup" : "Resolve Action"}: ${state.activeAction.label}`;
      activeOwner.textContent = `${state.activeAction.characterName} - ${state.activeAction.playerName}`;
      completeTurn.textContent = "Action Resolved";
      gmDelay.classList.add("hidden");
      if (!turnPanelOpen()) showTurnPanel();
    } else if (turnPanelOpen()) {
      closeTurnPanel();
    }
    lastNotifiedActiveId = "";
    lastCommandWarningKey = "";
    return;
  }
  const active = state.units.find((unit) => unit.id === state.activeId);
  if (!active) {
    if (turnPanelOpen()) closeTurnPanel();
    lastNotifiedActiveId = "";
    lastCommandWarningKey = "";
    return;
  }

  if (mode === "gm") {
    turnDialogKicker.textContent = "Turn Ready";
    activeName.textContent = active.characterName;
    activeOwner.textContent = active.playerName;
    completeTurn.textContent = "Action Resolved";
    gmDelay.classList.remove("hidden");
    gmDelay.disabled = false;
    gmDelay.classList.toggle("delay-button", true);
    gmDelay.classList.toggle("delay-blocked", !delayConsoleAllowed());
    gmDelay.title = delayConsoleAllowed() ? "Open Delay Console" : "Pause Everything before opening Delay";
    gmDelay.innerHTML = `<span class="delay-label-main">Delay</span><span class="delay-label-blocked">Delay</span>`;
    if (!turnPanelOpen()) showTurnPanel();
  }

  if (mode === "player" && active.id === myUnitId && alertsEnabled && lastNotifiedActiveId !== active.id) {
    lastNotifiedActiveId = active.id;
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
    playTurnDing();
  }

  notifyCommandWindowIfNeeded(active);
}

function notifyInterruptionIfNeeded() {
  if (mode !== "player" || !state?.lastInterruptedId) return;
  if (!alertsEnabled) return;
  if (state.lastInterruptedId !== myUnitId) return;
  const key = `${state.lastInterruptedId}:${state.lastInterruptedAt || ""}`;
  if (lastInterruptedNotice === key) return;
  lastInterruptedNotice = key;
  if (navigator.vibrate) navigator.vibrate([280, 90, 280, 90, 420]);
  playInterruptedBuzz();
}

function notifyCommandWindowIfNeeded(active) {
  if (mode !== "player" || active.id !== myUnitId || !alertsEnabled) return;
  const command = commandFor(active);
  if (!command || command.expired) return;
  const remaining = Math.ceil(command.remaining);
  const warningSecond = remaining <= 10 && remaining > 5 ? 10 : remaining <= 5 && remaining >= 1 ? remaining : null;
  if (!warningSecond) return;
  const key = `${active.id}:${warningSecond}`;
  if (lastCommandWarningKey === key) return;
  lastCommandWarningKey = key;
  if (navigator.vibrate) navigator.vibrate(warningSecond <= 5 ? [120, 60, 120, 60, 120] : [220, 100, 220]);
  playWarningDing(warningSecond <= 5);
}

function ensureAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!audioContext) audioContext = new Context();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function tone(frequency, start, duration, gainValue = 0.04, type = "square") {
  const audio = ensureAudio();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audio.currentTime + start);
  gain.gain.setValueAtTime(0, audio.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainValue, audio.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(audio.currentTime + start);
  osc.stop(audio.currentTime + start + duration + 0.02);
}

function playGmSound(name = "tap") {
  if (gmSoundsMuted) return;
  try {
    if (name === "start") {
      tone(220, 0, 0.07, 0.035, "sawtooth");
      tone(440, 0.08, 0.08, 0.04, "square");
      return;
    }
    if (name === "firstStart") {
      const alarm = new Audio("alarm-noise.mp4");
      alarm.volume = 0.72;
      alarm.play().catch(() => {
        tone(180, 0, 0.18, 0.055, "sawtooth");
        tone(360, 0.2, 0.18, 0.052, "sawtooth");
        tone(720, 0.42, 0.2, 0.046, "square");
      });
      return;
    }
    if (name === "engage") {
      tone(340, 0, 0.08, 0.035, "triangle");
      tone(680, 0.07, 0.1, 0.04, "sine");
      tone(1040, 0.16, 0.12, 0.035, "triangle");
      return;
    }
    if (name === "pause") {
      tone(620, 0, 0.07, 0.034, "square");
      tone(360, 0.08, 0.09, 0.032, "square");
      return;
    }
    if (name === "danger") {
      tone(160, 0, 0.12, 0.05, "sawtooth");
      tone(110, 0.12, 0.12, 0.04, "sawtooth");
      return;
    }
    if (name === "resolve") {
      tone(520, 0, 0.06, 0.035, "triangle");
      tone(760, 0.06, 0.08, 0.035, "triangle");
      return;
    }
    tone(680, 0, 0.045, 0.025, "square");
    tone(920, 0.045, 0.045, 0.02, "square");
  } catch {
    // Browsers may block audio until the first tap.
  }
}

function gmClockIsAudiblyActive() {
  return mode === "gm" && state?.running && !state.pausedForTurn && !state.holdPaused && !state.hardPaused && !document.hidden;
}

function playGmClockTick() {
  if (gmSoundsMuted || !gmClockIsAudiblyActive()) return;
  try {
    tone(1180, 0, 0.018, 0.006, "square");
    tone(880, 0.025, 0.012, 0.003, "triangle");
  } catch {
    // Browsers may block audio until the first GM tap.
  }
}

function playTurnDing() {
  try {
    tone(880, 0, 0.22, 0.28, "sine");
    tone(1320, 0.12, 0.28, 0.24, "sine");
    tone(1760, 0.28, 0.2, 0.18, "triangle");
  } catch {
    // The visual turn banner still works if audio is blocked.
  }
}

function playWarningDing(urgent = false) {
  try {
    if (urgent) {
      tone(620, 0, 0.12, 0.28, "square");
      tone(620, 0.18, 0.12, 0.28, "square");
      tone(420, 0.36, 0.16, 0.24, "sawtooth");
      return;
    }
    tone(520, 0, 0.2, 0.24, "triangle");
    tone(780, 0.12, 0.24, 0.24, "triangle");
    tone(1040, 0.28, 0.2, 0.18, "sine");
  } catch {
    // Visual warning remains visible if audio is blocked.
  }
}

function playInterruptedBuzz() {
  try {
    tone(240, 0, 0.2, 0.48, "sawtooth");
    tone(180, 0.18, 0.22, 0.46, "square");
    tone(120, 0.4, 0.36, 0.42, "sawtooth");
  } catch {
    // The visual interruption still appears in the combat log if audio is blocked.
  }
}

function vibrationAvailable() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function playerAlertLabel() {
  const alertType = vibrationAvailable() ? "Sound / Vibration" : "Sound";
  return alertsEnabled ? `Disable ${alertType}` : `Enable ${alertType}`;
}

function enablePlayerAlerts({ testSound = false } = {}) {
  alertsEnabled = true;
  safeLocalStorageSet("sa-atb-alerts", "on");
  ensureAudio();
  if (testSound) playTurnDing();
}

function disablePlayerAlerts() {
  alertsEnabled = false;
  safeLocalStorageSet("sa-atb-alerts", "off");
}

function shouldShowEngageClock() {
  if (!state) return false;
  return !state.running && !state.pausedForTurn;
}

function updateGmClockButton() {
  const active = activeUnit();
  const npcActionLocked = Boolean(active && active.team === "npc" && state?.pausedForTurn);
  const showEngage = shouldShowEngageClock();
  const isPaused = Boolean(state?.hardPaused);
  const clockAction = npcActionLocked ? "npc" : isPaused ? "resume" : showEngage ? "start" : "pause";
  const label = clockAction === "npc" ? "NPC Action" : clockAction === "pause" ? "Pause Everything" : "Engage Clock";
  const footer = state?.pausedForTurn && !state?.hardPaused
    ? active?.team === "npc" ? "NPC turn active" : "Turn is active"
    : state?.pausedForTurn && state?.hardPaused
      ? "Turn remains active"
      : "";
  gmPanicPause.classList.toggle("hidden", mode !== "gm");
  gmPanicPause.classList.toggle("npc-action", npcActionLocked);
  gmPanicPause.classList.toggle("engage", showEngage || isPaused);
  gmPanicPause.classList.toggle("paused", !showEngage && !isPaused);
  gmPanicPause.disabled = npcActionLocked;
  if (gmPanicPause.dataset.clockAction !== clockAction || gmPanicPause.dataset.footer !== footer) {
    gmPanicPause.dataset.clockAction = clockAction;
    gmPanicPause.dataset.footer = footer;
    gmPanicPause.innerHTML = `<span>${label}</span>${footer ? `<small>${footer}</small>` : ""}`;
    gmPanicPause.setAttribute("aria-label", label);
  }
}

function render() {
  if (!currentRoomCode && mode !== "welcome" && mode !== "roomJoin") {
    mode = "welcome";
    safeLocalStorageSet("sa-atb-mode", mode);
  }

  welcomePanel.classList.toggle("hidden", mode !== "welcome");
  roomJoinPanel.classList.toggle("hidden", mode !== "roomJoin");
  joinPanel.classList.toggle("hidden", mode !== "join");
  gmPanel.classList.toggle("hidden", mode !== "gm");
  playerPanel.classList.toggle("hidden", mode !== "player");
  gmTopControls.classList.toggle("hidden", mode !== "gm");
  playerTopControls.classList.toggle("hidden", mode !== "player");
  topbar.classList.toggle("hidden", mode === "welcome");
  connectionStatus.classList.toggle("hidden", mode === "welcome");
  initiativePanel.classList.toggle("hidden", mode === "welcome" || mode === "roomJoin" || mode === "join");
  logPanel.classList.toggle("hidden", mode === "welcome" || mode === "roomJoin" || mode === "join");
  document.body.classList.toggle("welcome-mode", mode === "welcome");
  document.body.classList.toggle("player-mode", mode === "player");
  document.body.classList.toggle("ring-view-mode", visualMode === "ring");
  document.body.classList.toggle("clock-active", Boolean(state?.running) && !state?.pausedForTurn && !state?.holdPaused && !state?.hardPaused);
  document.body.classList.toggle("hard-paused", Boolean(state?.hardPaused));
  renderPcBuilder();

  if (!state) {
    delayModalState = null;
    queuedEffectModalState = null;
    renderDelayDialog();
    renderQueuedEffectDialog();
    roomCode.textContent = currentRoomCode || "----";
    playerRoomCode.textContent = currentRoomCode || "----";
    activePanel.classList.add("hidden");
    unitList.innerHTML = "";
    logList.innerHTML = "";
    gmPanicPause.classList.add("hidden");
    gmMuteSound.classList.add("hidden");
    gmTopControls.classList.add("hidden");
    playerTopControls.classList.add("hidden");
    visualModeToggle.classList.add("hidden");
    return;
  }

  roomCode.textContent = state.roomCode;
  playerRoomCode.textContent = state.roomCode;
  activePanel.classList.toggle("hidden", mode === "welcome" || mode === "roomJoin" || mode === "join");

  const ready = state.units.filter((unit) => unit.atb >= state.threshold && !hasAnyDelay(unit));
  readyCount.textContent = `${ready.length} Ready`;
  clockState.textContent = statusText();
  if (playerClock) playerClock.textContent = statusText();
  updateGmClockButton();
  enableAlerts.textContent = playerAlertLabel();
  gmMuteSound.classList.toggle("hidden", mode !== "gm");
  gmMuteSound.classList.toggle("muted", gmSoundsMuted);
  gmMuteSound.title = gmSoundsMuted ? "Unmute sounds" : "Mute sounds";
  visualModeToggle.classList.toggle("hidden", mode !== "gm" && mode !== "player");
  visualModeToggle.textContent = visualMode === "ring" ? "ATB Bars" : "Tactical Ring";
  visualModeToggle.classList.toggle("ring-active", visualMode === "ring");
  undoLastTiming.disabled = !state.undoAvailable;
  undoLastTiming.title = state.undoAvailable ? "Undo the last timing/control change" : "No timing change to undo";
  playerActionLogToggle.checked = playerActionLogEnabled;
  playerActionLogToggle.closest(".combat-log-toggle")?.classList.toggle("hidden", mode !== "player");
  renderDelayDialog();
  renderQueuedEffectDialog();
  renderActivePanel();
  renderRejoinOptions();
  const active = activeUnit();
  const mine = state.units.find((unit) => unit.id === myUnitId);
  const showMineOverlay = mode === "player" && Boolean(mine) && (active?.id === myUnitId || (hasAnyDelay(mine) && !state.activeAction));
  playerPanel.classList.toggle("idle-player-panel", mode === "player" && !showMineOverlay);
  document.body.classList.toggle("own-turn-active", showMineOverlay);
  document.body.classList.toggle("other-turn-active", mode === "player" && (Boolean(state.activeAction) || (Boolean(active) && active.id !== myUnitId)));

  const sorted =
    mode === "player"
      ? [...state.units].sort((a, b) => b.atb - a.atb || (b.speed || 0) - (a.speed || 0))
      : [...state.units].sort((a, b) => b.atb - a.atb || (b.speed || 0) - (a.speed || 0));
  if (visualMode === "ring") {
    unitList.innerHTML = tacticalRingMarkup(state.units);
  } else {
    renderUnitList(sorted);
  }
  syncGmCommandWindowVisibility();

  if (mine) {
    if (myCharacter) myCharacter.textContent = mine.characterName;
    myUnitCard.innerHTML = "";
    myTurnBanner.classList.toggle("hidden", !showMineOverlay);
    renderPlayerCommand(mine);
  } else if (mode === "player") {
    if (myCharacter) myCharacter.textContent = "Not Connected";
    myUnitCard.innerHTML = "";
    myTurnBanner.classList.add("hidden");
    renderPlayerCommand(null);
  }

  logList.innerHTML = state.log
    .slice()
    .reverse()
    .map((entry) => `<div><strong>${escapeHtml(entry.at)}</strong> ${escapeHtml(entry.text)}</div>`)
    .join("");

  if (!state.pausedForTurn && turnPanelOpen()) closeTurnPanel();
  notifyTurnIfNeeded();
  notifyInterruptionIfNeeded();
  queueGmDelayRequestPrompt();
}

function renderPlayerCommand(mine) {
  const command = commandFor(mine);
  const isMyTurn = mine && state.activeId === mine.id;
  const delay = activeDelayFor(mine);
  const hasPendingDelayRequest = Boolean(state.delayRequest && state.delayRequest.unitId === mine?.id);
  playerTurnTitle.textContent = delay && !isMyTurn ? "DELAY TIME" : "YOUR TURN";
  playerTurnActions.classList.toggle("hidden", Boolean(delay) && !isMyTurn);
  playerDelay.disabled = hasPendingDelayRequest;
  playerDelay.title = "Request Delay";
  playerEndTurn.disabled = hasPendingDelayRequest;

  if (delay && !isMyTurn) {
    playerCommandDial.classList.remove("hidden");
    playerCommandDial.style.setProperty("--command-percent", `${delayPercent(delay)}%`);
    playerCommandTime.textContent = formatSeconds(delaySeconds(delay));
    playerCommandStatus.textContent = delayText(delay);
    return;
  }

  playerCommandDial.classList.toggle("hidden", !isMyTurn || !command);
  if (!isMyTurn) {
    playerCommandStatus.textContent = "Resolve your action, then end your turn.";
    return;
  }
  if (hasPendingDelayRequest) {
    playerCommandStatus.textContent = "Waiting for GM to set the delay.";
    return;
  }
  if (!command) {
    playerCommandStatus.textContent = state.activeSource === "step"
      ? "Manual step turn. No Command Window limit."
      : "Resolve your action, then end your turn.";
    return;
  }
  const percent = command.expired ? 0 : commandPercent(command);
  playerCommandDial.style.setProperty("--command-percent", `${percent}%`);
  playerCommandTime.textContent = formatSeconds(command.remaining);
  playerCommandStatus.textContent = command.expired
    ? "Your action is about to be interrupted!"
    : command.remaining <= 10
      ? "Time is almost up!"
      : "Resolve your action before your Command Window closes.";
}

function syncGmCommandWindowVisibility() {
  gmCommandWindowWrap.classList.toggle("hidden", gmTeam.value !== "pc");
}

function queueGmDelayRequestPrompt() {
  if (mode !== "gm" || !state?.delayRequest) return;
  if (lastHandledDelayRequest === state.delayRequest.id) return;
  lastHandledDelayRequest = state.delayRequest.id;
  setTimeout(() => {
    if (mode !== "gm" || !state?.delayRequest || lastHandledDelayRequest !== state.delayRequest.id) return;
    const request = state.delayRequest;
    openDelayDialog(request.unitId, request.kind, request.id);
  }, 0);
}

function renderActionChoices() {
  playerActionChoices.innerHTML = actionLogChoices
    .map(([label, value]) => `<button type="button" data-action-log="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
    .join("");
}

function hideActionSheet() {
  playerActionSheet.classList.add("hidden");
  if (actionLogTimeout) {
    clearTimeout(actionLogTimeout);
    actionLogTimeout = null;
  }
}

async function submitPlayerActionLog(label = "has taken an action") {
  if (!pendingActionLog) return;
  const pending = pendingActionLog;
  pendingActionLog = null;
  hideActionSheet();
  await action({ action: "logPlayerAction", id: pending.unitId, label }, "tap");
}

function queuePlayerActionLog(unit) {
  if (!playerActionLogEnabled || !unit) return;
  pendingActionLog = {
    unitId: unit.id,
    characterName: unit.characterName,
  };
  setTimeout(() => {
    if (!pendingActionLog || pendingActionLog.unitId !== unit.id || mode !== "player") return;
    playerActionSheet.classList.remove("hidden");
    if (actionLogTimeout) clearTimeout(actionLogTimeout);
    actionLogTimeout = setTimeout(() => {
      submitPlayerActionLog("has taken an action");
    }, ACTION_LOG_TIMEOUT_MS);
  }, 1000);
}

function ringIndexFromPointer(event) {
  const svg = unitList.querySelector(".tactical-ring-svg");
  if (!svg || !state?.units?.length) return -1;
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 320;
  const y = ((event.clientY - rect.top) / rect.height) * 320;
  const degrees = (Math.atan2(y - 160, x - 160) * 180) / Math.PI + 90;
  const angle = (degrees + 360) % 360;
  const units = ringOrderedUnits(state.units);
  return Math.max(0, Math.min(units.length - 1, Math.floor(angle / (360 / units.length))));
}

function moveRingUnit(id, targetIndex) {
  const units = ringOrderedUnits(state.units);
  const fromIndex = units.findIndex((unit) => unit.id === id);
  if (fromIndex < 0 || targetIndex < 0 || targetIndex === fromIndex) return;
  const [unit] = units.splice(fromIndex, 1);
  units.splice(targetIndex, 0, unit);
  setRingOrderFromUnits(units);
  ringMovedId = id;
  if (ringMovedTimeout) clearTimeout(ringMovedTimeout);
  ringMovedTimeout = setTimeout(() => {
    ringMovedId = "";
    if (visualMode === "ring") render();
  }, 1000);
  unitList.innerHTML = tacticalRingMarkup(state.units);
}

function clearRingDrag() {
  if (ringDrag?.timer) clearTimeout(ringDrag.timer);
  ringDrag = null;
  document.body.classList.remove("ring-dragging");
}

joinPlayer.addEventListener("click", async () => {
  enablePlayerAlerts();
  const pcStats = calculatedPcStats();
  const next = await action({
    action: "join",
    playerName: playerName.value || "Player",
    characterName: characterName.value || "Character",
    speed: pcStats.speed,
    commandWindow: pcStats.commandWindow,
    color: playerColor.value,
    controlledBy: "player",
    team: "pc",
    actorType: "character",
  });
  if (!next) return;
  const unit = next.units[next.units.length - 1];
  myUnitId = unit.id;
  safeLocalStorageSet("sa-atb-unit-id", myUnitId);
  visualMode = "bars";
  setMode("player");
  if (selectedCharacterIcon) saveIconForCharacter(unit.characterName, selectedCharacterIcon);
});

createRoom.addEventListener("click", async () => {
  let response;
  try {
    response = await fetch("/api/create-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    setConnected(false, "Cannot reach the ATB room server. Try again in a moment.");
    return;
  }
  if (!response.ok) {
    setConnected(false, "Could not create a room. Try again in a moment.");
    return;
  }
  setRoom(await response.json());
  myUnitId = "";
  localStorage.removeItem("sa-atb-unit-id");
  visualMode = "bars";
  setMode("gm");
});

showJoinRoom.addEventListener("click", () => setMode("roomJoin"));
backToWelcome.addEventListener("click", () => setMode("welcome"));
joinRoomCode.addEventListener("input", () => {
  joinRoomCode.value = joinRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});
confirmJoinRoom.addEventListener("click", async () => {
  const code = joinRoomCode.value.trim().toUpperCase();
  if (!code) return;
  let response;
  try {
    response = await fetch(`/api/state?room=${encodeURIComponent(code)}`);
  } catch {
    setConnected(false, "Cannot reach the ATB room server. Check the room code or try again.");
    return;
  }
  if (!response.ok) {
    setConnected(false, "Room not found. Check the four-character room code.");
    return;
  }
  setRoom(await response.json());
  visualMode = "bars";
  setMode("join");
});
openGm.addEventListener("click", () => setMode("welcome"));
rejoinPlayer.addEventListener("click", () => {
  enablePlayerAlerts();
  myUnitId = rejoinSelect.value;
  safeLocalStorageSet("sa-atb-unit-id", myUnitId);
  visualMode = "bars";
  setMode("player");
});

function pressGmClockButton(event) {
  if (!state) return;
  event?.preventDefault();
  event?.stopPropagation();
  const now = Date.now();
  if (now - lastGmClockClickAt < 650) return;
  lastGmClockClickAt = now;
  const clockAction = gmPanicPause.dataset.clockAction || (state.hardPaused ? "resume" : shouldShowEngageClock() ? "start" : "pause");
  if (clockAction === "npc") return;
  if (clockAction === "pause") {
    action({ action: "setHardPaused", paused: true }, "pause");
    return;
  }
  if (clockAction === "resume") {
    action({ action: "setHardPaused", paused: false }, "engage");
    return;
  }
  action({ action: "setRunning", running: true }, state.hasEngagedClock ? "engage" : "firstStart");
}

gmPanicPause.addEventListener("pointerdown", pressGmClockButton);
gmPanicPause.addEventListener("click", pressGmClockButton);
visualModeToggle.addEventListener("click", () => {
  setVisualMode(visualMode === "ring" ? "bars" : "ring");
});
stepTick.addEventListener("click", () => action({ action: "step" }, "tap"));
resetAll.addEventListener("click", () => action({ action: "reset" }, "danger"));
gmMuteSound.addEventListener("click", () => {
  gmSoundsMuted = !gmSoundsMuted;
  safeLocalStorageSet("sa-atb-gm-muted", gmSoundsMuted ? "on" : "off");
  playGmSound("tap");
  render();
});
undoLastTiming.addEventListener("click", () => {
  if (!state?.undoAvailable) return;
  action({ action: "undoLastTiming" }, "resolve");
});
clearEncounter.addEventListener("click", () => {
  if (confirm("Clear every character from this encounter?")) action({ action: "clearEncounter" }, "danger");
});
exitCombat.addEventListener("click", () => {
  if (confirm("Exit this combat room and return to the main screen?")) returnToWelcome("Exited combat. Create or join a room when ready.");
});
completeTurn.addEventListener("click", () => action({ action: "completeTurn" }, "resolve"));
gmDelay.addEventListener("click", () => {
  const active = activeUnit();
  if (active) openDelayForUnit(active.id, "timer");
});
playerEndTurn.addEventListener("click", () => {
  if (state && state.activeId === myUnitId) {
    const unit = state.units.find((entry) => entry.id === myUnitId);
    action({ action: "completeTurn", id: myUnitId }).then(() => queuePlayerActionLog(unit));
  }
});
playerDelay.addEventListener("click", () => {
  if (state && state.activeId === myUnitId) action({ action: "requestDelay", id: myUnitId, kind: "action" }, "tap");
});
cancelDelayDialog.addEventListener("click", () => closeDelayDialog({ cancelRequest: true }));
confirmDelayDialog.addEventListener("click", confirmDelayDialogAction);
cancelQueuedEffectDialog.addEventListener("click", closeQueuedEffectDialog);
confirmQueuedEffectDialog.addEventListener("click", confirmQueuedEffectDialogAction);
delayDialog.addEventListener("click", (event) => {
  const kindButton = event.target.closest("[data-delay-kind]");
  if (kindButton && delayModalState) {
    delayModalState.kind = kindButton.dataset.delayKind === "queued" ? "queued" : kindButton.dataset.delayKind === "action" ? "action" : "timer";
    if (delayModalState.kind === "action" && !delayModalState.label) delayModalState.label = "Delayed Resolution";
    if (delayModalState.kind === "queued" && !delayModalState.label) delayModalState.label = "Launch Queued Effect";
    renderDelayDialog();
    return;
  }
  handleC4DialogClick(event, delayModalState, renderDelayDialog, "delay");
});
delayActionName.addEventListener("input", () => {
  if (!delayModalState) return;
  delayModalState.label = delayActionName.value;
});
queuedEffectDialog.addEventListener("click", (event) => {
  handleC4DialogClick(event, queuedEffectModalState, renderQueuedEffectDialog, "queued");
});
queuedEffectName.addEventListener("input", () => {
  if (!queuedEffectModalState) return;
  queuedEffectModalState.label = queuedEffectName.value;
});
enableAlerts.addEventListener("click", () => {
  if (alertsEnabled) {
    disablePlayerAlerts();
  } else {
    enablePlayerAlerts({ testSound: true });
  }
  render();
});
leaveRoom.addEventListener("click", () => {
  returnToWelcome("Left the room. Create or join a room when ready.");
});
playerActionLogToggle.addEventListener("change", () => setActionLogEnabled(playerActionLogToggle.checked));
characterIcon.addEventListener("change", async () => {
  const file = characterIcon.files?.[0];
  if (!file) return;
  const iconDataUrl = await imageFileToIconDataUrl(file);
  if (!iconDataUrl) {
    selectedCharacterIcon = "";
    setConnected(false, "That portrait could not be prepared. Try a smaller JPG or PNG.");
    render();
    return;
  }
  selectedCharacterIcon = iconDataUrl;
  saveIconForCharacter(characterName.value, selectedCharacterIcon);
  render();
});
characterName.addEventListener("input", () => {
  selectedCharacterIcon = iconForCharacter(characterName.value) || selectedCharacterIcon;
});
dismissActionSheet.addEventListener("click", hideActionSheet);
playerActionChoices.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action-log]");
  if (!button) return;
  const value = button.dataset.actionLog;
  if (value === "other") {
    const text = prompt("What did you do?", "took a special action");
    if (text === null) return;
    submitPlayerActionLog(text);
    return;
  }
  submitPlayerActionLog(value);
});

joinPanel.addEventListener("click", (event) => {
  const button = event.target.closest(".die-cell");
  if (!button) return;
  const stat = button.dataset.stat;
  const row = Number(button.dataset.row);
  const count = Number(button.dataset.count);
  if (!pcBuild[stat] || !Number.isInteger(row)) return;
  pcBuild[stat][row] = pcBuild[stat][row] === count ? 0 : count;
  renderPcBuilder();
});

awarenessSkill.addEventListener("input", renderPcBuilder);
initiativeSkill.addEventListener("input", renderPcBuilder);

gmAddUnit.addEventListener("click", () => {
  const usingNpcDefault = gmTeam.value === "npc";
  if (usingNpcDefault) applyNpcDefaultPreview();
  action({
    action: "addUnit",
    playerName: gmPlayerName.value || "GM",
    characterName: gmCharacterName.value || "NPC",
    speed: gmSpeedRating.value || 5,
    commandWindow: gmTeam.value === "pc" ? gmCommandWindow.value || 30 : null,
    color: gmColor.value,
    controlledBy: "gm",
    team: gmTeam.value,
    actorType: "character",
  });
  if (usingNpcDefault) {
    nextNpcDefault();
    applyNpcDefaultPreview({ force: true });
  } else {
    gmCharacterName.value = "";
  }
});

gmTeam.addEventListener("change", () => {
  syncGmCommandWindowVisibility();
  applyNpcDefaultPreview();
});

function handleUnitActionButton(button, event = null) {
  if (!button || mode !== "gm") return;
  if (button.disabled) return;
  event?.preventDefault();
  event?.stopPropagation();
  const id = button.dataset.id;
  if (button.dataset.action === "remove") action({ action: "removeUnit", id }, "danger");
  if (button.dataset.action === "nudge") action({ action: "nudge", id, amount: 5 }, "tap");
  if (button.dataset.action === "delay") openDelayForUnit(id, "timer");
  if (button.dataset.action === "impairQueuedEffect") action({ action: "impairQueuedEffect", id, effectId: button.dataset.effectId }, "danger");
  if (button.dataset.action === "removeQueuedEffect") action({ action: "removeQueuedEffect", id, effectId: button.dataset.effectId }, "danger");
}

unitList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || mode !== "gm") return;
  if (button.classList.contains("ring-action-btn") && Date.now() - lastRingActionPressAt < 650) return;
  handleUnitActionButton(button, event);
});

unitList.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-action]");
  if (!input) return;
  if (mode === "player" && input.dataset.action === "playerColor" && input.dataset.id === myUnitId) {
    action({ action: "setColor", id: myUnitId, color: input.value }, "tap");
    return;
  }
  if (mode !== "gm") return;
  if (input.dataset.action === "speed") action({ action: "setSpeed", id: input.dataset.id, speed: input.value }, "tap");
  if (input.dataset.action === "commandWindow") action({ action: "setCommandWindow", id: input.dataset.id, commandWindow: input.value }, "tap");
  if (input.dataset.action === "name") action({ action: "setName", id: input.dataset.id, characterName: input.value }, "tap");
  if (input.dataset.action === "color") action({ action: "setColor", id: input.dataset.id, color: input.value }, "tap");
});

unitList.addEventListener("pointerdown", (event) => {
  if (visualMode !== "ring" || !state) return;
  const ringButton = event.target.closest(".ring-action-btn");
  if (ringButton) {
    lastRingActionPressAt = Date.now();
    handleUnitActionButton(ringButton, event);
    return;
  }
  const control = event.target.closest(".ring-slice-control.draggable");
  if (!control) return;
  const id = control.dataset.unitId;
  const unit = state.units.find((entry) => entry.id === id);
  if (!unit) return;
  clearRingDrag();
  ringDrag = {
    id,
    pointerId: event.pointerId,
    timer: setTimeout(() => {
      ringDrag = { id, pointerId: event.pointerId, active: true };
      document.body.classList.add("ring-dragging");
      unitList.innerHTML = tacticalRingMarkup(state.units);
    }, 460),
  };
  control.setPointerCapture?.(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (!ringDrag?.active || visualMode !== "ring") return;
  event.preventDefault();
  const targetIndex = ringIndexFromPointer(event);
  if (targetIndex >= 0) moveRingUnit(ringDrag.id, targetIndex);
});

document.addEventListener("pointerup", clearRingDrag);
document.addEventListener("pointercancel", clearRingDrag);

applyNpcDefaultPreview({ force: true });
renderActionChoices();
setActionLogEnabled(playerActionLogEnabled);
setInterval(playGmClockTick, 1000);
setInterval(keepRoomAwake, KEEP_ALIVE_MS);

if (currentRoomCode && mode !== "welcome" && mode !== "roomJoin") {
  fetch(`/api/state?room=${encodeURIComponent(currentRoomCode)}`)
    .then((response) => {
      if (response.status === 404) return { expired: true };
      return response.ok ? response.json() : null;
    })
    .then((nextState) => {
      if (nextState?.expired) {
        returnToWelcome("That room expired. Create or join a new room.");
        return;
      }
      if (!nextState) {
        returnToWelcome("Could not reconnect to the old room. Create or join a new room.");
        return;
      }
      setRoom(nextState);
      render();
    })
    .catch(() => returnToWelcome("Could not reconnect to the old room. Create or join a new room."));
} else {
  render();
}
