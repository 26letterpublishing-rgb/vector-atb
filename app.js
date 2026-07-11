let state = null;
let mode = localStorage.getItem("vector-atb-mode") || "welcome";
let currentRoomCode = (localStorage.getItem("vector-atb-room-code") || "").trim().toUpperCase();
let myUnitId = localStorage.getItem("vector-atb-unit-id") || "";
let alertsEnabled = localStorage.getItem("vector-atb-alerts") === "on";
let gmSoundsMuted = localStorage.getItem("vector-atb-gm-muted") === "on";
let events = null;
let audioContext = null;
let lastNotifiedActiveId = "";
let lastCommandWarningKey = "";
let lastInterruptedNotice = "";
let lastGmClockClickAt = 0;

const DEFAULT_BASELINE = 7;
const DEFAULT_COMMAND_WINDOW = 20;
const KEEP_ALIVE_MS = 30000;

const actionFallbacks = [
  {
    id: "move",
    label: "Moving Position",
    speed: { preparation: 1, execution: 2, recovery: 1 },
    risk: { preparation: 0, execution: 1, recovery: 0 },
    hitBonus: null,
    damage: "",
    critical: "",
    damageType: "",
    hasResolution: false,
    notes: "Change position when execution completes.",
  },
  {
    id: "use_item",
    label: "Using Item",
    speed: { preparation: 0, execution: 0, recovery: 1 },
    risk: { preparation: 1, execution: 2, recovery: 1 },
    hitBonus: null,
    damage: "",
    critical: "",
    damageType: "",
    hasResolution: true,
    notes: "Resolve item effect at execution completion.",
  },
  {
    id: "defense",
    label: "Defense",
    speed: { preparation: 1, execution: 0, recovery: 1 },
    risk: { preparation: -3, execution: -5, recovery: -3 },
    hitBonus: null,
    damage: "",
    critical: "",
    damageType: "",
    hasResolution: false,
    notes: "Negative risk improves defense.",
  },
  {
    id: "melee_attack",
    label: "Melee Attack",
    speed: { preparation: 0, execution: 2, recovery: -1 },
    risk: { preparation: 1, execution: 3, recovery: 2 },
    hitBonus: 3,
    damage: "4d8",
    critical: "x1.5",
    damageType: "cutting",
    hasResolution: true,
    notes: "Resolve to-hit and damage at execution completion.",
  },
  {
    id: "fire_gun",
    label: "Firing Gun",
    speed: { preparation: 1, execution: 2, recovery: 0 },
    risk: { preparation: 0, execution: 2, recovery: 1 },
    hitBonus: 2,
    damage: "2d8",
    critical: "x1.5",
    damageType: "ballistic",
    hasResolution: true,
    notes: "Ammo tracking comes later.",
  },
  {
    id: "close_quarter",
    label: "Close Quarter Action",
    speed: { preparation: -1, execution: 0, recovery: -1 },
    risk: { preparation: 2, execution: 3, recovery: 3 },
    hitBonus: 1,
    damage: "2d6 / effect",
    critical: "GM call",
    damageType: "blunt/control",
    hasResolution: true,
    notes: "Wrestle, tackle, disarm, restrain, or restrain.",
  },
  {
    id: "reload_ready",
    label: "Reloading / Readying Weapon",
    speed: { preparation: 0, execution: 0, recovery: 1 },
    risk: { preparation: 1, execution: 2, recovery: 1 },
    hitBonus: null,
    damage: "",
    critical: "",
    damageType: "",
    hasResolution: false,
    notes: "Reload, draw, ready, clear jam, or swap weapon.",
  },
  {
    id: "improvised",
    label: "Improvised Action",
    speed: { preparation: 0, execution: 0, recovery: 0 },
    risk: { preparation: 0, execution: 0, recovery: 0 },
    hitBonus: null,
    damage: "GM call",
    critical: "GM call",
    damageType: "GM call",
    hasResolution: true,
    notes: "Fallback action. GM may override values.",
  },
];

function $(selector) {
  return document.querySelector(selector);
}

const roomCode = $("#roomCode");
const connectionStatus = $("#connectionStatus");
const welcomePanel = $("#welcomePanel");
const createRoom = $("#createRoom");
const showJoinRoom = $("#showJoinRoom");
const roomJoinPanel = $("#roomJoinPanel");
const joinRoomCode = $("#joinRoomCode");
const confirmJoinRoom = $("#confirmJoinRoom");
const backToWelcome = $("#backToWelcome");
const topbar = $("#topbar");
const joinPanel = $("#joinPanel");
const gmPanel = $("#gmPanel");
const gmTopControls = $("#gmTopControls");
const playerTopControls = $("#playerTopControls");
const playerPanel = $("#playerPanel");
const playerName = $("#playerName");
const characterName = $("#characterName");
const playerColor = $("#playerColor");
const calculatedSpeed = $("#calculatedSpeed");
const calculatedCommand = $("#calculatedCommand");
const joinPlayer = $("#joinPlayer");
const openGm = $("#openGm");
const rejoinBlock = $("#rejoinBlock");
const rejoinSelect = $("#rejoinSelect");
const rejoinPlayer = $("#rejoinPlayer");
const stepTick = $("#stepTick");
const resetAll = $("#resetAll");
const clearEncounter = $("#clearEncounter");
const undoLastTiming = $("#undoLastTiming");
const exitCombat = $("#exitCombat");
const gmMuteSound = $("#gmMuteSound");
const gmAddUnit = $("#gmAddUnit");
const gmPlayerName = $("#gmPlayerName");
const gmCharacterName = $("#gmCharacterName");
const gmSpeedRating = $("#gmSpeedRating");
const gmCommandWindow = $("#gmCommandWindow");
const gmCommandWindowWrap = $("#gmCommandWindowWrap");
const gmColor = $("#gmColor");
const gmTeam = $("#gmTeam");
const unitList = $("#unitList");
const initiativePanel = $("#initiativePanel");
const logPanel = $("#logPanel");
const readyCount = $("#readyCount");
const clockState = $("#clockState");
const myTurnBanner = $("#myTurnBanner");
const playerTurnTitle = $("#playerTurnTitle");
const playerTurnActions = $("#playerTurnActions");
const playerRoomCode = $("#playerRoomCode");
const playerCommandDial = $("#playerCommandDial");
const playerCommandTime = $("#playerCommandTime");
const playerCommandStatus = $("#playerCommandStatus");
const enableAlerts = $("#enableAlerts");
const leaveRoom = $("#leaveRoom");
const myUnitCard = $("#myUnitCard");
const activePanel = $("#activePanel");
const activeKicker = $("#activeKicker");
const activeTitle = $("#activeTitle");
const activeMeta = $("#activeMeta");
const logList = $("#logList");
const turnDialog = $("#turnDialog");
const turnDialogKicker = $("#turnDialogKicker");
const activeName = $("#activeName");
const activeOwner = $("#activeOwner");
const completeTurn = $("#completeTurn");
const gmDelay = $("#gmDelay");
const delayDialog = $("#delayDialog");
const queuedEffectDialog = $("#queuedEffectDialog");
const gmPanicPause = $("#gmPanicPause");
const visualModeToggle = $("#visualModeToggle");
const playerActionSheet = $("#playerActionSheet");

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can fail in private browsing; the app still works for the current tab.
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function actions() {
  return Array.isArray(state?.actions) && state.actions.length ? state.actions : actionFallbacks;
}

function actionById(actionId) {
  return actions().find((entry) => entry.id === actionId) || actionFallbacks[actionFallbacks.length - 1];
}

function mark(value) {
  const step = Math.round(Number(value) || 0);
  if (step === 0) return "0";
  const char = step > 0 ? "+" : "-";
  return char.repeat(Math.abs(step));
}

function signedNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : ""}${number}`;
}

function pct(unit) {
  return `${Math.max(0, Math.min(100, Number(unit?.phaseProgress) || 0))}%`;
}

function formatRate(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function commandFor(unit) {
  return state?.command?.unitId === unit?.id ? state.command : null;
}

function commandPercent(command) {
  if (!command || !command.total) return 0;
  return Math.max(0, Math.min(100, (command.remaining / command.total) * 100));
}

function phaseLabel(unit) {
  const phase = unit?.phase || "decision";
  if (phase === "decision") return "DECISION";
  if (phase === "preparation") return "PREPARATION";
  if (phase === "execution") return state?.activeAction?.unitId === unit?.id ? "RESOLUTION WINDOW" : "EXECUTION";
  if (phase === "recovery") return "RECOVERY";
  if (phase === "dumbfounded") return "DUMBFOUNDED!";
  return phase.toUpperCase();
}

function actionLabel(unit) {
  if (state?.activeId === unit?.id) return "Choose Action";
  if (state?.activeAction?.unitId === unit?.id) return state.activeAction.label;
  return unit?.currentAction?.label || "Reading Battlefield";
}

function phaseVerb(unit) {
  if (state?.activeId === unit?.id) return "Decision frozen";
  if (state?.activeAction?.unitId === unit?.id) return "Waiting for resolution";
  if (unit?.phase === "decision") return unit.decisionBoost ? "Boosted decision" : "Building decision";
  if (unit?.phase === "preparation") return "Preparing";
  if (unit?.phase === "execution") return "Executing";
  if (unit?.phase === "recovery") return "Recovering";
  if (unit?.phase === "dumbfounded") return "Losing time";
  return "Standing by";
}

function currentRiskText(unit) {
  const risk = Number(unit?.currentRisk) || 0;
  return mark(risk);
}

function currentRiskLabel(unit) {
  const risk = Number(unit?.currentRisk) || 0;
  if (risk === 0) return "Risk 0";
  if (risk < 0) return `Risk ${mark(risk)} / Defense bonus`;
  return `Risk ${mark(risk)} / Defense penalty`;
}

function estimatePhase(unit) {
  if (!unit) return "";
  if (state?.activeId === unit.id) {
    const command = commandFor(unit);
    return command ? `${formatSeconds(command.remaining)} Command Window` : "Choose action";
  }
  if (state?.activeAction?.unitId === unit.id) return "Resolution paused";
  const rate = Number(unit.phaseRate) || 0;
  if (!rate) return "Paused";
  const progress = Number(unit.phaseProgress) || 0;
  const direction = unit.phaseDirection;
  const remaining = direction === "down" ? progress : 100 - progress;
  return `${formatSeconds(remaining / rate)} at ${formatRate(rate)}/sec`;
}

function actionSummary(action) {
  const hit = action.hitBonus === null || action.hitBonus === undefined ? "" : ` Hit ${signedNumber(action.hitBonus)}`;
  const damage = action.damage ? ` ${action.damage}${action.damageType ? ` ${action.damageType}` : ""}` : "";
  return `SPD P${mark(action.speed.preparation)} E${mark(action.speed.execution)} R${mark(action.speed.recovery)} | RISK P${mark(action.risk.preparation)} E${mark(action.risk.execution)} R${mark(action.risk.recovery)}${hit}${damage}`;
}

function actionButtonsMarkup(unit, { compact = false } = {}) {
  if (!unit || state?.activeId !== unit.id || state?.activeAction) return "";
  return `
    <div class="vector-action-grid ${compact ? "compact" : ""}" data-action-unit="${escapeHtml(unit.id)}">
      ${actions().map((action) => `
        <button type="button" class="vector-action-button" data-action-id="${escapeHtml(action.id)}" title="${escapeHtml(action.notes || "")}">
          <strong>${escapeHtml(action.id === "reload_ready" ? "Reload / Ready" : action.label)}</strong>
          <small>${escapeHtml(actionSummary(action))}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function maybeImprovisedAction(actionId) {
  if (actionId !== "improvised" || mode !== "gm") return null;
  const base = actionById("improvised");
  const label = prompt("Improvised action name", base.label);
  if (label === null) return false;
  const prepSpeed = prompt("Preparation speed modifier (-4 to +4)", "0");
  if (prepSpeed === null) return false;
  const execSpeed = prompt("Execution speed modifier (-4 to +4)", "0");
  if (execSpeed === null) return false;
  const recoverySpeed = prompt("Recovery speed modifier (-4 to +4)", "0");
  if (recoverySpeed === null) return false;
  const prepRisk = prompt("Preparation risk (-5 to +5)", "0");
  if (prepRisk === null) return false;
  const execRisk = prompt("Execution risk (-5 to +5)", "0");
  if (execRisk === null) return false;
  const recoveryRisk = prompt("Recovery risk (-5 to +5)", "0");
  if (recoveryRisk === null) return false;
  const hasResolution = confirm("Should this action pause at Execution completion for resolution?");
  const hitBonus = prompt("To-Hit bonus, blank for none", "");
  if (hitBonus === null) return false;
  const damage = prompt("Damage / effect text", "GM call");
  if (damage === null) return false;
  return {
    ...base,
    label,
    speed: {
      preparation: clamp(Math.round(Number(prepSpeed) || 0), -4, 4),
      execution: clamp(Math.round(Number(execSpeed) || 0), -4, 4),
      recovery: clamp(Math.round(Number(recoverySpeed) || 0), -4, 4),
    },
    risk: {
      preparation: clamp(Math.round(Number(prepRisk) || 0), -5, 5),
      execution: clamp(Math.round(Number(execRisk) || 0), -5, 5),
      recovery: clamp(Math.round(Number(recoveryRisk) || 0), -5, 5),
    },
    hitBonus: hitBonus.trim() === "" ? null : clamp(Math.round(Number(hitBonus) || 0), -99, 99),
    damage,
    hasResolution,
    notes: "GM improvised action.",
  };
}

async function chooseAction(unitId, actionId) {
  const customAction = maybeImprovisedAction(actionId);
  if (customAction === false) return;
  await action({
    action: "chooseAction",
    id: unitId,
    actionId,
    customAction,
  }, "start");
}

function barStyle(unit) {
  const color = unit?.color || "#39e58f";
  const rgb = hexToRgb(color);
  return `--bar:${color};--bar-rgb:${rgb.r},${rgb.g},${rgb.b};`;
}

function hexToRgb(hex) {
  const clean = String(hex || "#39e58f").replace("#", "");
  const number = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function unitSignature(unit, { gm = false, player = false } = {}) {
  return [
    gm ? "gm" : "nogm",
    player ? "player" : "notplayer",
    unit.id,
    unit.playerName,
    unit.characterName,
    unit.baseline,
    unit.commandWindow || "",
    unit.color || "",
    unit.team,
    unit.phase,
    Math.round(Number(unit.phaseProgress) || 0),
    unit.currentAction?.label || "",
    unit.phaseRate || "",
    unit.currentRisk || "",
    unit.decisionBoost ? "boost" : "noboost",
    state?.activeId === unit.id ? "active" : "inactive",
    state?.activeAction?.unitId === unit.id ? "resolving" : "notresolving",
    commandFor(unit) ? "command" : "nocommand",
    state?.hardPaused ? "paused" : "notpaused",
  ].join("|");
}

function unitCard(unit, { gm = false, player = false } = {}) {
  const active = state?.activeId === unit.id;
  const resolving = state?.activeAction?.unitId === unit.id;
  const own = player && unit.id === myUnitId;
  const phase = phaseLabel(unit);
  const side = unit.team === "pc" ? "PC" : "NPC";
  const command = commandFor(unit);
  const commandBar = command
    ? `<div class="command-bar ${command.expired ? "expired" : ""}">
        <div class="command-bar-fill" style="width:${command.expired ? 0 : commandPercent(command)}%"></div>
        <span>${command.expired ? "Interruption pending" : `${formatSeconds(command.remaining)} Command Window`}</span>
      </div>`
    : "";
  return `
    <article class="unit-card vector-unit-card phase-${escapeHtml(unit.phase)} ${active ? "ready" : ""} ${resolving ? "resolving" : ""} ${own ? "own-unit" : ""}" data-unit-id="${escapeHtml(unit.id)}" data-signature="${escapeHtml(unitSignature(unit, { gm, player }))}" style="${barStyle(unit)}">
      <div class="unit-top vector-unit-top">
        <div class="vector-card-main">
          <div class="unit-name">${escapeHtml(unit.characterName)}</div>
          <div class="unit-owner">${escapeHtml(unit.playerName)} - ${side} - Base ${formatRate(unit.baseline)}${unit.commandWindow ? ` - ${unit.commandWindow} sec Command` : ""}</div>
        </div>
        ${
          player && own
            ? `<label class="player-color-inline" title="Change your ATB color">
                <span>Color</span>
                <input data-action="playerColor" data-id="${escapeHtml(unit.id)}" type="color" value="${escapeHtml(unit.color || "#39e58f")}" />
              </label>`
            : ""
        }
        <div class="unit-readout">
          <strong>${Math.floor(Number(unit.phaseProgress) || 0)}%</strong>
          <span>${escapeHtml(estimatePhase(unit))}</span>
        </div>
        ${
          gm
            ? `<div class="unit-actions">
                <label class="name-edit">
                  Name
                  <input data-action="name" data-id="${escapeHtml(unit.id)}" value="${escapeHtml(unit.characterName)}" />
                </label>
                <label class="speed-edit">
                  Base
                  <input data-action="speed" data-id="${escapeHtml(unit.id)}" type="number" min="1" max="30" step="1" value="${escapeHtml(unit.baseline)}" />
                </label>
                ${
                  unit.team === "pc"
                    ? `<label class="command-edit">
                        Command
                        <input data-action="commandWindow" data-id="${escapeHtml(unit.id)}" type="number" min="1" max="999" step="1" value="${escapeHtml(unit.commandWindow || DEFAULT_COMMAND_WINDOW)}" />
                      </label>`
                    : ""
                }
                <label class="color-edit">
                  Color
                  <input data-action="color" data-id="${escapeHtml(unit.id)}" type="color" value="${escapeHtml(unit.color || "#39e58f")}" />
                </label>
                <button class="mini" data-action="nudge" data-id="${escapeHtml(unit.id)}">+5%</button>
                <button class="mini danger" data-action="remove" data-id="${escapeHtml(unit.id)}">Remove</button>
              </div>`
            : ""
        }
      </div>
      <div class="vector-phase-line">
        <div>
          <strong>${escapeHtml(phase)}</strong>
          <span>${escapeHtml(actionLabel(unit))}</span>
        </div>
        <div class="vector-risk ${Number(unit.currentRisk) < 0 ? "risk-good" : Number(unit.currentRisk) > 0 ? "risk-bad" : ""}">
          ${escapeHtml(currentRiskLabel(unit))}
        </div>
      </div>
      ${commandBar}
      <div class="meter vector-phase-meter ${unit.phaseDirection === "down" ? "draining" : ""}">
        <div class="fill" style="width:${pct(unit)}"></div>
      </div>
      <div class="vector-phase-foot">
        <span>${escapeHtml(phaseVerb(unit))}</span>
        <span>Rate ${formatRate(unit.phaseRate || 0)}/sec</span>
      </div>
      ${gm || own ? actionButtonsMarkup(unit, { compact: player }) : ""}
    </article>
  `;
}

function renderUnitList(sorted) {
  const gm = mode === "gm";
  const player = mode === "player";
  unitList.innerHTML = sorted.map((unit) => unitCard(unit, { gm, player })).join("");
}

function activeUnit() {
  return state?.units.find((unit) => unit.id === state.activeId) || null;
}

function myUnit() {
  return state?.units.find((unit) => unit.id === myUnitId) || null;
}

function statusText() {
  if (!state) return "Connecting";
  if (state.hardPaused) return "Paused";
  if (state.pausedForResolution) return "Resolution";
  if (state.pausedForTurn) return "Decision";
  return state.running ? "Clock Engaged" : "Waiting for GM";
}

function renderActivePanel() {
  if (!state) return;
  const active = activeUnit();
  const activeAction = state.activeAction;
  activePanel.classList.toggle("turn-live", Boolean(active || activeAction));
  activePanel.classList.toggle("own-turn", Boolean(active) && active.id === myUnitId);
  activePanel.classList.toggle("other-turn", Boolean(activeAction) || (Boolean(active) && active.id !== myUnitId));
  activePanel.classList.toggle("clock-running", state.running && !state.pausedForTurn && !state.pausedForResolution && !state.hardPaused);

  if (activeAction) {
    activeKicker.textContent = "Resolution Window";
    activeTitle.textContent = `RESOLVE: ${activeAction.label}`;
    const attack = activeAction.action || {};
    const hit = attack.hitBonus === null || attack.hitBonus === undefined ? "No To-Hit" : `To-Hit ${signedNumber(attack.hitBonus)}`;
    const damage = attack.damage ? `Damage ${attack.damage}${attack.damageType ? ` ${attack.damageType}` : ""}` : "No damage";
    activeMeta.textContent = `${activeAction.characterName} - ${hit} - ${damage}`;
    return;
  }

  if (active) {
    activeKicker.textContent = "Decision Window";
    activeTitle.textContent = `${active.characterName}: choose action`;
    const command = commandFor(active);
    activeMeta.textContent = command ? `${formatSeconds(command.remaining)} Command Window` : "NPC decision paused";
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
      .filter((unit) => unit.phase === "decision" && unit.phaseProgress < state.threshold)
      .sort((a, b) => (state.threshold - a.phaseProgress) / (a.phaseRate || 1) - (state.threshold - b.phaseProgress) / (b.phaseRate || 1))[0];
    activeKicker.textContent = "Clock Engaged";
    activeTitle.textContent = next ? `${next.characterName} is building DECISION` : "Action phases in motion";
    activeMeta.textContent = next ? estimatePhase(next) : `${state.units.length} participant(s) moving`;
    return;
  }

  activeKicker.textContent = "Clock Status";
  activeTitle.textContent = state.units.length ? "Waiting for GM to engage clock" : "Waiting for characters to join";
  activeMeta.textContent = state.units.length ? `${state.units.length} participant(s) standing by` : "No active turn";
}

function renderRejoinOptions() {
  const options = state?.units.filter((unit) => unit.controlledBy === "player") || [];
  rejoinBlock.classList.toggle("hidden", mode !== "join" || options.length === 0);
  rejoinSelect.innerHTML = options
    .map((unit) => `<option value="${escapeHtml(unit.id)}">${escapeHtml(unit.characterName)} - ${escapeHtml(unit.playerName)}</option>`)
    .join("");
}

function renderPlayerCommand(mine) {
  const command = commandFor(mine);
  const isMyDecision = mine && state?.activeId === mine.id;
  const isMyResolution = mine && state?.activeAction?.unitId === mine.id;
  myTurnBanner.classList.toggle("hidden", !isMyDecision && !isMyResolution);
  if (!mine) {
    playerCommandDial.classList.add("hidden");
    playerTurnActions.innerHTML = "";
    return;
  }
  if (isMyResolution) {
    playerTurnTitle.textContent = "RESOLUTION";
    playerCommandDial.classList.add("hidden");
    playerCommandStatus.textContent = "GM is resolving your action.";
    playerTurnActions.innerHTML = "";
    return;
  }
  if (!isMyDecision) {
    playerCommandDial.classList.add("hidden");
    playerCommandStatus.textContent = "Watch the ATB flow.";
    playerTurnActions.innerHTML = "";
    return;
  }
  playerTurnTitle.textContent = "DECISION";
  playerCommandDial.classList.toggle("hidden", !command);
  if (command) {
    playerCommandDial.style.setProperty("--command-percent", `${command.expired ? 0 : commandPercent(command)}%`);
    playerCommandTime.textContent = formatSeconds(command.remaining);
    playerCommandStatus.textContent = command.expired
      ? "Your action is about to be interrupted!"
      : command.remaining <= 10
        ? "Choose fast!"
        : "Choose one action.";
  } else {
    playerCommandStatus.textContent = "Choose one action.";
  }
  playerTurnActions.innerHTML = actionButtonsMarkup(mine, { compact: true });
}

function renderResolutionDialog() {
  if (mode === "gm" && state?.activeAction) {
    turnDialogKicker.textContent = "Resolution Window";
    activeName.textContent = `RESOLVE: ${state.activeAction.label}`;
    activeOwner.textContent = `${state.activeAction.characterName} - ${state.activeAction.playerName}`;
    completeTurn.textContent = "Action Resolved";
    gmDelay.classList.add("hidden");
    turnDialog.classList.remove("hidden");
    return;
  }
  turnDialog.classList.add("hidden");
}

function updateGmClockButton() {
  if (!state) {
    gmPanicPause.classList.add("hidden");
    return;
  }
  const show = mode === "gm";
  gmPanicPause.classList.toggle("hidden", !show);
  if (!show) return;
  const isPaused = Boolean(state.hardPaused);
  const waiting = !state.running && !state.pausedForTurn && !state.pausedForResolution;
  const clockAction = isPaused ? "resume" : waiting ? "start" : "pause";
  const label = clockAction === "pause" ? "Pause Everything" : "Engage Clock";
  const footer = state.pausedForTurn ? "Decision active" : state.pausedForResolution ? "Resolution active" : "";
  gmPanicPause.dataset.clockAction = clockAction;
  gmPanicPause.classList.toggle("engage", clockAction !== "pause");
  gmPanicPause.classList.toggle("paused", clockAction === "pause");
  gmPanicPause.disabled = false;
  gmPanicPause.innerHTML = `<span>${label}</span>${footer ? `<small>${footer}</small>` : ""}`;
}

function render() {
  if (!currentRoomCode && mode !== "welcome" && mode !== "roomJoin") {
    mode = "welcome";
    safeLocalStorageSet("vector-atb-mode", mode);
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
  document.body.classList.toggle("clock-active", Boolean(state?.running) && !state?.pausedForTurn && !state?.pausedForResolution && !state?.hardPaused);
  document.body.classList.toggle("hard-paused", Boolean(state?.hardPaused));
  delayDialog?.classList.add("hidden");
  queuedEffectDialog?.classList.add("hidden");
  visualModeToggle?.classList.add("hidden");
  playerActionSheet?.classList.add("hidden");
  calculatedSpeed.textContent = String(DEFAULT_BASELINE);
  calculatedCommand.textContent = `${DEFAULT_COMMAND_WINDOW} sec`;
  gmCommandWindowWrap.classList.toggle("hidden", gmTeam.value !== "pc");

  if (!state) {
    roomCode.textContent = currentRoomCode || "----";
    playerRoomCode.textContent = currentRoomCode || "----";
    activePanel.classList.add("hidden");
    unitList.innerHTML = "";
    logList.innerHTML = "";
    gmPanicPause.classList.add("hidden");
    gmMuteSound.classList.add("hidden");
    visualModeToggle.classList.add("hidden");
    return;
  }

  roomCode.textContent = state.roomCode;
  playerRoomCode.textContent = state.roomCode;
  activePanel.classList.toggle("hidden", mode === "welcome" || mode === "roomJoin" || mode === "join");
  readyCount.textContent = `${state.units.filter((unit) => state.activeId === unit.id || state.activeAction?.unitId === unit.id).length} Active`;
  clockState.textContent = statusText();
  enableAlerts.textContent = playerAlertLabel();
  gmMuteSound.classList.toggle("hidden", mode !== "gm");
  gmMuteSound.classList.toggle("muted", gmSoundsMuted);
  undoLastTiming.disabled = !state.undoAvailable;
  undoLastTiming.title = state.undoAvailable ? "Undo the last timing/control change" : "No timing change to undo";
  updateGmClockButton();
  renderActivePanel();
  renderRejoinOptions();
  renderResolutionDialog();

  const sorted = [...state.units].sort((a, b) => {
    if (state.activeId === a.id) return -1;
    if (state.activeId === b.id) return 1;
    if (state.activeAction?.unitId === a.id) return -1;
    if (state.activeAction?.unitId === b.id) return 1;
    return (b.phaseProgress || 0) - (a.phaseProgress || 0);
  });
  renderUnitList(sorted);

  const mine = myUnit();
  myUnitCard.innerHTML = "";
  renderPlayerCommand(mine);

  logList.innerHTML = state.log
    .slice()
    .reverse()
    .map((entry) => `<div><strong>${escapeHtml(entry.at)}</strong> ${escapeHtml(entry.text)}</div>`)
    .join("");

  notifyTurnIfNeeded();
  notifyInterruptionIfNeeded();
}

function setConnected(isConnected, message = "") {
  connectionStatus.classList.toggle("offline", !isConnected);
  connectionStatus.textContent = message || (isConnected ? "Connected to the Vector ATB room server." : "Connection interrupted.");
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
    setConnected(false, "Cannot reach the Vector ATB room server. Check the connection, then try again.");
    return state;
  }
  if (!response.ok) {
    if (response.status === 404) returnToWelcome("That room expired. Create or join a new room.");
    else setConnected(false, "The Vector ATB room server rejected that action. Try again.");
    return state;
  }
  try {
    const nextState = await response.json();
    receiveState(nextState, { force: true });
  } catch {
    setConnected(false, "The Vector ATB room server sent an unreadable response. Try again.");
    return state;
  }
  if (mode === "gm") playGmSound(soundName);
  return state;
}

function setMode(next) {
  mode = next;
  safeLocalStorageSet("vector-atb-mode", mode);
  render();
}

function setRoom(nextState) {
  state = nextState;
  currentRoomCode = state.roomCode;
  safeLocalStorageSet("vector-atb-room-code", currentRoomCode);
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
    setConnected(false, "Cannot reach this Vector ATB room. It may have expired or the server may be waking up.");
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
    // Keep the current screen during brief network wake-ups.
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
      setConnected(false, "Trying to keep the Vector ATB room awake...");
      return;
    }
    receiveState(await response.json());
    setConnected(true);
  } catch {
    setConnected(false, "Trying to keep the Vector ATB room awake...");
  }
}

function returnToWelcome(message = "") {
  if (events) {
    events.close();
    events = null;
  }
  state = null;
  currentRoomCode = "";
  myUnitId = "";
  localStorage.removeItem("vector-atb-room-code");
  localStorage.removeItem("vector-atb-unit-id");
  setConnected(false, message || "Disconnected.");
  setMode("welcome");
}

function notifyTurnIfNeeded() {
  if (!state) return;
  const active = activeUnit();
  if (!active) {
    lastNotifiedActiveId = "";
    lastCommandWarningKey = "";
    return;
  }
  if (mode === "player" && active.id === myUnitId && alertsEnabled && lastNotifiedActiveId !== active.id) {
    lastNotifiedActiveId = active.id;
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
    playTurnDing();
  }
  notifyCommandWindowIfNeeded(active);
}

function notifyInterruptionIfNeeded() {
  if (mode !== "player" || !state?.lastInterruptedId || !alertsEnabled) return;
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
      alarm.play().catch(() => tone(180, 0, 0.18, 0.055, "sawtooth"));
      return;
    }
    if (name === "pause") {
      tone(620, 0, 0.07, 0.034, "square");
      tone(360, 0.08, 0.09, 0.032, "square");
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

function playTurnDing() {
  try {
    tone(880, 0, 0.22, 0.28, "sine");
    tone(1320, 0.12, 0.28, 0.24, "sine");
  } catch {
    // Visual signal still works.
  }
}

function playWarningDing(urgent = false) {
  try {
    if (urgent) {
      tone(620, 0, 0.12, 0.28, "square");
      tone(420, 0.24, 0.16, 0.24, "sawtooth");
      return;
    }
    tone(520, 0, 0.2, 0.24, "triangle");
  } catch {
    // Visual warning remains visible.
  }
}

function playInterruptedBuzz() {
  try {
    tone(240, 0, 0.2, 0.48, "sawtooth");
    tone(120, 0.24, 0.36, 0.42, "sawtooth");
  } catch {
    // The combat log still shows the interruption.
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
  safeLocalStorageSet("vector-atb-alerts", "on");
  ensureAudio();
  if (testSound) playTurnDing();
}

function disablePlayerAlerts() {
  alertsEnabled = false;
  safeLocalStorageSet("vector-atb-alerts", "off");
}

createRoom.addEventListener("click", async () => {
  let response;
  try {
    response = await fetch("/api/create-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    setConnected(false, "Cannot reach the Vector ATB room server. Try again in a moment.");
    return;
  }
  if (!response.ok) {
    setConnected(false, "Could not create a room. Try again in a moment.");
    return;
  }
  setRoom(await response.json());
  myUnitId = "";
  localStorage.removeItem("vector-atb-unit-id");
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
    setConnected(false, "Cannot reach the Vector ATB room server. Check the room code or try again.");
    return;
  }
  if (!response.ok) {
    setConnected(false, "Room not found. Check the four-character room code.");
    return;
  }
  setRoom(await response.json());
  setMode("join");
});

joinPlayer.addEventListener("click", async () => {
  enablePlayerAlerts();
  const next = await action({
    action: "join",
    playerName: playerName.value || "Player",
    characterName: characterName.value || "Character",
    baseline: DEFAULT_BASELINE,
    commandWindow: DEFAULT_COMMAND_WINDOW,
    color: playerColor.value,
    controlledBy: "player",
    team: "pc",
    actorType: "character",
  });
  if (!next) return;
  const unit = next.units[next.units.length - 1];
  myUnitId = unit.id;
  safeLocalStorageSet("vector-atb-unit-id", myUnitId);
  setMode("player");
});

openGm.addEventListener("click", () => setMode("welcome"));

rejoinPlayer.addEventListener("click", () => {
  enablePlayerAlerts();
  myUnitId = rejoinSelect.value;
  safeLocalStorageSet("vector-atb-unit-id", myUnitId);
  setMode("player");
});

function pressGmClockButton(event) {
  if (!state) return;
  event?.preventDefault();
  event?.stopPropagation();
  const now = Date.now();
  if (now - lastGmClockClickAt < 650) return;
  lastGmClockClickAt = now;
  const clockAction = gmPanicPause.dataset.clockAction || (state.hardPaused ? "resume" : !state.running ? "start" : "pause");
  if (clockAction === "pause") {
    action({ action: "setHardPaused", paused: true }, "pause");
    return;
  }
  if (clockAction === "resume") {
    action({ action: "setHardPaused", paused: false }, "start");
    return;
  }
  action({ action: "setRunning", running: true }, state.hasEngagedClock ? "start" : "firstStart");
}

gmPanicPause.addEventListener("pointerdown", pressGmClockButton);
gmPanicPause.addEventListener("click", pressGmClockButton);
stepTick.addEventListener("click", () => action({ action: "step" }, "tap"));
resetAll.addEventListener("click", () => action({ action: "reset" }, "danger"));
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
gmMuteSound.addEventListener("click", () => {
  gmSoundsMuted = !gmSoundsMuted;
  safeLocalStorageSet("vector-atb-gm-muted", gmSoundsMuted ? "on" : "off");
  playGmSound("tap");
  render();
});
completeTurn.addEventListener("click", () => action({ action: "completeResolution" }, "resolve"));
gmDelay.addEventListener("click", () => {});

enableAlerts.addEventListener("click", () => {
  if (alertsEnabled) disablePlayerAlerts();
  else enablePlayerAlerts({ testSound: true });
  render();
});

leaveRoom.addEventListener("click", () => returnToWelcome("Left the room. Create or join a room when ready."));

gmAddUnit.addEventListener("click", () => {
  action({
    action: "addUnit",
    playerName: gmPlayerName.value || "GM",
    characterName: gmCharacterName.value || "NPC",
    baseline: gmSpeedRating.value || DEFAULT_BASELINE,
    commandWindow: gmTeam.value === "pc" ? gmCommandWindow.value || DEFAULT_COMMAND_WINDOW : null,
    color: gmColor.value,
    controlledBy: "gm",
    team: gmTeam.value,
    actorType: "character",
  });
  gmCharacterName.value = "";
});

gmTeam.addEventListener("change", () => {
  gmCommandWindowWrap.classList.toggle("hidden", gmTeam.value !== "pc");
});

unitList.addEventListener("click", (event) => {
  const actionButton = event.target.closest(".vector-action-button");
  if (actionButton) {
    const unitId = actionButton.closest("[data-action-unit]")?.dataset.actionUnit;
    if (unitId) chooseAction(unitId, actionButton.dataset.actionId);
    return;
  }
  const button = event.target.closest("button");
  if (!button || mode !== "gm") return;
  const id = button.dataset.id;
  if (button.dataset.action === "remove") action({ action: "removeUnit", id }, "danger");
  if (button.dataset.action === "nudge") action({ action: "nudge", id, amount: 5 }, "tap");
});

playerTurnActions.addEventListener("click", (event) => {
  const button = event.target.closest(".vector-action-button");
  if (!button) return;
  const unitId = button.closest("[data-action-unit]")?.dataset.actionUnit || myUnitId;
  chooseAction(unitId, button.dataset.actionId);
});

unitList.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-action]");
  if (!input) return;
  if (mode === "player" && input.dataset.action === "playerColor" && input.dataset.id === myUnitId) {
    action({ action: "setColor", id: myUnitId, color: input.value }, "tap");
    return;
  }
  if (mode !== "gm") return;
  if (input.dataset.action === "speed") action({ action: "setSpeed", id: input.dataset.id, baseline: input.value }, "tap");
  if (input.dataset.action === "commandWindow") action({ action: "setCommandWindow", id: input.dataset.id, commandWindow: input.value }, "tap");
  if (input.dataset.action === "name") action({ action: "setName", id: input.dataset.id, characterName: input.value }, "tap");
  if (input.dataset.action === "color") action({ action: "setColor", id: input.dataset.id, color: input.value }, "tap");
});

setInterval(keepRoomAwake, KEEP_ALIVE_MS);
setInterval(() => {
  if (mode === "gm" && state?.running && !state.pausedForTurn && !state.pausedForResolution && !state.hardPaused && !gmSoundsMuted && !document.hidden) {
    try {
      tone(1180, 0, 0.018, 0.006, "square");
    } catch {
      // Audio may be blocked until first tap.
    }
  }
}, 1000);

if (currentRoomCode && mode !== "welcome" && mode !== "roomJoin") {
  fetch(`/api/state?room=${encodeURIComponent(currentRoomCode)}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((nextState) => {
      if (!nextState) {
        returnToWelcome("That room expired. Create or join a new room.");
        return;
      }
      setRoom(nextState);
      render();
    })
    .catch(() => {
      setConnected(false, "Cannot reconnect to the saved room.");
      render();
    });
} else {
  render();
}
