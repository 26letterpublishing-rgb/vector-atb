let state = null;
let mode = localStorage.getItem("vector-atb-mode") || "welcome";
let currentRoomCode = (localStorage.getItem("vector-atb-room-code") || "").trim().toUpperCase();
let myUnitId = localStorage.getItem("vector-atb-unit-id") || "";
let alertsEnabled = localStorage.getItem("vector-atb-alerts") === "on";
let gmSoundsMuted = localStorage.getItem("vector-atb-gm-muted") === "on";
let events = null;
let audioContext = null;
let lastNotifiedActiveId = "";
let lastInterruptedNotice = "";
let lastGmClockClickAt = 0;
let playerFocusWasActive = false;
let playerActionRequestPending = false;
let actionConfigContext = null;
let staggerTargetId = "";
let poiseTargetId = "";

const DEFAULT_COMMAND_WINDOW = 20;
const KEEP_ALIVE_MS = 30000;
const combatStartAudio = new Audio("vector-combat-intro.mp4");
combatStartAudio.preload = "auto";

const actionFallbacks = [
  { id: "move", label: "Move", kind: "move", targetMode: "none" },
  { id: "use_item", label: "Use Item", kind: "item", targetMode: "optional" },
  { id: "defense", label: "Defense", kind: "standard", targetMode: "none" },
  { id: "melee_attack", label: "Melee Attack", kind: "attack", targetMode: "required" },
  { id: "fire_gun", label: "Fire Gun", kind: "attack", targetMode: "required" },
  { id: "close_quarter", label: "Close Quarter Action", kind: "attack", targetMode: "required" },
  { id: "reload_ready", label: "Reload / Ready", kind: "standard", targetMode: "none" },
  { id: "improvised", label: "Improvised Action", kind: "improvised", targetMode: "optional" },
];

const npcDefaults = [
  { characterName: "Security Guard", color: "#39e58f", stats: [7, 7, 7, 7, 3, 7, 6, 6] },
  { characterName: "Street Tough", color: "#f07a4a", stats: [5, 8, 5, 6, 4, 3, 8, 5] },
  { characterName: "Corporate Agent", color: "#35b7ff", stats: [9, 8, 10, 9, 5, 8, 5, 7] },
  { characterName: "Civilian", color: "#f2d16b", stats: [5, 5, 5, 4, 1, 2, 2, 3] },
  { characterName: "Drone Handler", color: "#20f5d0", stats: [9, 6, 9, 8, 4, 8, 3, 5] },
  { characterName: "Police Exo", color: "#ff5fa2", stats: [7, 10, 8, 8, 6, 9, 8, 8] },
  { characterName: "Fast Operative", color: "#a65cff", stats: [8, 13, 10, 10, 6, 10, 9, 11] },
  { characterName: "Heavy Enforcer", color: "#ff3d55", stats: [5, 6, 6, 5, 7, 8, 9, 5] },
  { characterName: "Vector Anomaly", color: "#8bd7ff", stats: [12, 11, 13, 12, 8, 10, 10, 10] },
];
let npcDefaultBag = [];
let currentNpcDefault = null;

function $(selector) { return document.querySelector(selector); }
function $all(selector) { return [...document.querySelectorAll(selector)]; }

const elements = Object.fromEntries(
  "roomCode connectionStatus welcomePanel createRoom showJoinRoom roomJoinPanel joinRoomCode confirmJoinRoom backToWelcome topbar joinPanel gmPanel gmTopControls playerTopControls playerPanel playerName characterName playerColor joinPlayer openGm rejoinBlock rejoinSelect rejoinPlayer stepTick resetAll clearEncounter undoLastTiming exitCombat gmMuteSound gmAddUnit gmPlayerName gmCharacterName gmCommandWindow gmCommandWindowWrap gmColor gmTeam unitList initiativePanel logPanel readyCount clockState myTurnBanner playerTurnActions playerRoomCode enableAlerts playerLogButton leaveRoom playerFocusScreen playerFocusEyebrow playerFocusCharacter playerFocusLogButton playerFocusRoomCode playerDecisionView playerFocusTimer playerFocusCommandTime playerFocusPrompt playerCommandTrackFill playerFocusActions playerResolutionView playerResolutionAction playerResolutionStatus playerLogDrawer playerLogCommand playerLogCommandTime playerLogList closePlayerLog activePanel activeKicker activeTitle activeMeta logList turnDialog turnDialogKicker activeName activeOwner completeTurn gmDelay gmPanicPause playerPoiseButton playerPoiseCount playerQueueButton playerQueueCount staggerDialog staggerDialogTarget staggerDuration cancelStagger confirmStagger poiseDialog poiseDialogTarget poiseChoiceList cancelPoise staggerResponseDialog staggerResponseTitle staggerResponseText continueStagger ignoreStagger actionConfigDialog actionConfigEyebrow actionConfigTitle actionTargetWrap actionTarget actionOtherTargetWrap actionOtherTarget actionDistanceWrap actionDistance improvisedFields improvisedName improvisedPreparation improvisedPreparationRisk improvisedExecution improvisedExecutionRisk improvisedRecovery improvisedRecoveryRisk cancelActionConfig confirmActionConfig queueDialog queuedActionList queueActionChoices closeQueueDialog".split(" ").map((id) => [id, $(`#${id}`)])
);

const pcFields = {
  stats: { intellect: "pcIntellect", dexterity: "pcDexterity", perception: "pcPerception", initiative: "pcInitiative", composure: "pcComposure", firearms: "pcFirearms", melee: "pcMelee", dodge: "pcDodge" },
  weapon: { preparation: "pcWeaponPreparation", execution: "pcWeaponExecution", recovery: "pcWeaponRecovery", preparationRisk: "pcPreparationRisk", executionRisk: "pcExecutionRisk", recoveryRisk: "pcRecoveryRisk" },
};
const gmFields = {
  stats: { intellect: "gmIntellect", dexterity: "gmDexterity", perception: "gmPerception", initiative: "gmInitiative", composure: "gmComposure", firearms: "gmFirearms", melee: "gmMelee", dodge: "gmDodge" },
  weapon: { preparation: "gmWeaponPreparation", execution: "gmWeaponExecution", recovery: "gmWeaponRecovery", preparationRisk: "gmPreparationRisk", executionRisk: "gmExecutionRisk", recoveryRisk: "gmRecoveryRisk" },
};

function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The current tab still works. */ }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function numberValue(id, fallback = 0) { const value = Number($(`#${id}`)?.value); return Number.isFinite(value) ? value : fallback; }
function mark(value) { const count = clamp(Math.round(Number(value) || 0), 0, 3); return count ? "+".repeat(count) : "0"; }
function pct(unit) { return clamp(Number(unit?.phaseProgress) || 0, 0, 100); }
function formatRate(value) { const number = Number(value) || 0; return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); }
function formatSecondsValue(seconds) { if (!Number.isFinite(seconds)) return "--"; if (seconds < 10) return `${Math.max(0, seconds).toFixed(2)}s`; return `${Math.max(0, seconds).toFixed(1)}s`; }
function formatClock(seconds) { const total = Math.max(0, Math.ceil(Number(seconds) || 0)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

function actions() { return Array.isArray(state?.actions) && state.actions.length ? state.actions : actionFallbacks; }
function actionById(actionId) { return actions().find((entry) => entry.id === actionId) || actionFallbacks.at(-1); }
function myUnit() { return state?.units.find((unit) => unit.id === myUnitId) || null; }
function activeUnit() { return state?.units.find((unit) => unit.id === state?.activeId) || null; }
function commandFor(unit) { return state?.command?.unitId === unit?.id ? state.command : null; }
function playerVisibleActions() { return actions().filter((entry) => entry.id !== "improvised"); }

function collectEntryData(fields) {
  const stats = Object.fromEntries(Object.entries(fields.stats).map(([key, id]) => [key, numberValue(id, key === "composure" ? 3 : 7)]));
  const weapon = {
    preparation: numberValue(fields.weapon.preparation, 10),
    execution: numberValue(fields.weapon.execution, 20),
    recovery: numberValue(fields.weapon.recovery, 15),
    risk: {
      preparation: numberValue(fields.weapon.preparationRisk, 1),
      execution: numberValue(fields.weapon.executionRisk, 3),
      recovery: numberValue(fields.weapon.recoveryRisk, 2),
    },
  };
  return { stats, weapon };
}

function setEntryData(fields, stats) {
  const keys = Object.keys(fields.stats);
  keys.forEach((key, index) => { const input = $(`#${fields.stats[key]}`); if (input) input.value = stats[index]; });
}

function shuffleNpcDefaultBag() {
  npcDefaultBag = [...npcDefaults];
  for (let i = npcDefaultBag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [npcDefaultBag[i], npcDefaultBag[j]] = [npcDefaultBag[j], npcDefaultBag[i]];
  }
}

function nextNpcDefault() {
  if (!npcDefaultBag.length) shuffleNpcDefaultBag();
  currentNpcDefault = npcDefaultBag.pop() || npcDefaults[0];
  return currentNpcDefault;
}

function applyNpcDefaultPreview({ force = false } = {}) {
  if (elements.gmTeam?.value !== "npc") return;
  const preview = currentNpcDefault || nextNpcDefault();
  if (force || !elements.gmCharacterName.value.trim()) elements.gmCharacterName.value = preview.characterName;
  if (force || !elements.gmColor.value) elements.gmColor.value = preview.color;
  if (force) setEntryData(gmFields, preview.stats);
}

function setConnected(connected, text = "") {
  elements.connectionStatus.classList.toggle("ok", connected);
  elements.connectionStatus.textContent = text || (connected ? `Connected to room ${currentRoomCode}.` : "Connecting to the ATB room server...");
}

function setMode(nextMode) {
  mode = nextMode;
  safeLocalStorageSet("vector-atb-mode", mode);
  document.body.classList.toggle("gm-mode", mode === "gm");
  document.body.classList.toggle("player-mode", mode === "player");
  render();
}

function setRoom(nextState) {
  state = nextState;
  currentRoomCode = state.roomCode;
  safeLocalStorageSet("vector-atb-room-code", currentRoomCode);
  elements.roomCode.textContent = currentRoomCode;
  connectEvents();
  setConnected(true);
  render();
}

function receiveState(nextState) {
  if (!nextState || (state && nextState.revision < state.revision)) return;
  const previousEngaged = Boolean(state?.hasEngagedClock);
  state = nextState;
  if (mode === "gm" && !previousEngaged && state.hasEngagedClock) playCombatStartSting();
  notifyTurnIfNeeded();
  notifyInterruptionIfNeeded();
  render();
}

async function action(payload, sound = "tap") {
  if (!currentRoomCode) return null;
  try {
    const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomCode: currentRoomCode, ...payload }) });
    if (!response.ok) return null;
    const next = await response.json();
    receiveState(next);
    if (mode === "gm") playGmSound(sound);
    return next;
  } catch {
    setConnected(false, "Connection interrupted. Retrying...");
    return null;
  }
}

function connectEvents() {
  if (!currentRoomCode) return;
  if (events) events.close();
  events = new EventSource(`/events?room=${encodeURIComponent(currentRoomCode)}`);
  events.addEventListener("state", (event) => { try { receiveState(JSON.parse(event.data)); setConnected(true); } catch { /* Ignore partial events. */ } });
  events.onerror = () => setConnected(false, "Reconnecting to the room...");
}

function phaseLabel(unit) {
  return ({ decision: "DECISION", preparation: "PREPARATION", execution: "EXECUTION", recovery: "RECOVERY", stagger: "STAGGER", dumbfounded: "DUMBFOUNDED!" })[unit?.phase] || String(unit?.phase || "").toUpperCase();
}

function actionLabel(unit) {
  if (state?.activeId === unit?.id) return "Choose Action";
  if (state?.activeAction?.unitId === unit?.id) return state.activeAction.label;
  if (unit?.phase === "stagger") return "Action Voided";
  if (unit?.phase === "execution" && unit.currentAction?.kind === "move") return `Move - ${formatRate(unit.movementUnits)} / ${formatRate(unit.currentAction.movement.distance)} units`;
  return unit?.currentAction?.label || "Read Battlefield";
}

function currentRiskLabel(unit) {
  const risk = Number(unit?.currentRisk) || 0;
  if (unit?.phase === "execution" && unit.currentAction?.kind === "move") return "Risk + vs melee";
  return risk ? `Risk ${mark(risk)} (-${risk} DEX ${risk === 1 ? "die" : "dice"})` : "Risk 0";
}

function estimatePhase(unit) {
  if (state?.activeId === unit?.id) return commandFor(unit) ? `${formatClock(commandFor(unit).remaining)} Command` : "Choose action";
  if (state?.activeAction?.unitId === unit?.id) return "Resolution paused";
  const rate = Number(unit?.phaseRate) || 0;
  if (!rate) return "Paused";
  const remaining = unit.phaseDirection === "down" ? pct(unit) : 100 - pct(unit);
  return `${formatSecondsValue(remaining / rate)} at Rate ${formatRate(rate)}`;
}

function unitStructureSignature(unit, gm, player) {
  return [unit.id, gm, player, unit.characterName, unit.playerName, unit.team, unit.phase, unit.currentAction?.label, unit.currentAction?.kind, unit.currentRisk, formatRate(unit.phaseRate), unit.poiseRemaining, unit.poiseMax, unit.staggerImmunity, unit.poiseLocked, unit.actionQueue?.length, state?.activeId === unit.id, state?.activeAction?.unitId === unit.id, state?.hardPaused].join("|");
}

function actionButtonsMarkup(unit) {
  if (state?.activeId !== unit.id || state?.activeAction) return "";
  return `<div class="vector-action-grid" data-action-unit="${escapeHtml(unit.id)}">${actions().map((entry) => `<button type="button" class="vector-action-button action-${escapeHtml(entry.id)}" data-action-id="${escapeHtml(entry.id)}"><strong>${escapeHtml(entry.label)}</strong></button>`).join("")}</div>`;
}

function unitCardMarkup(unit, { gm = false, player = false } = {}) {
  const active = state?.activeId === unit.id;
  const resolving = state?.activeAction?.unitId === unit.id;
  const own = player && unit.id === myUnitId;
  const awaitingPlayer = gm && active && unit.controlledBy === "player";
  const side = unit.team === "pc" ? "PC" : "NPC";
  const poiseTool = gm && unit.poiseMax > 0 ? `<button class="vector-icon-button npc-poise-button" data-action="poise" data-id="${escapeHtml(unit.id)}" title="Poise ${unit.poiseRemaining}/${unit.poiseMax}" aria-label="Poise for ${escapeHtml(unit.characterName)}"><span>${unit.poiseRemaining}</span></button>` : "";
  return `<article class="unit-card vector-unit-card phase-${escapeHtml(unit.phase)} ${active ? "ready" : ""} ${resolving ? "resolving" : ""} ${own ? "own-unit" : ""}" data-unit-id="${escapeHtml(unit.id)}" data-signature="${escapeHtml(unitStructureSignature(unit, gm, player))}" style="--bar:${escapeHtml(unit.color || "#39e58f")}">
    <div class="vector-unit-head">
      <div><div class="unit-name">${escapeHtml(unit.characterName)}</div><div class="unit-owner">${escapeHtml(unit.playerName)} - ${side} - DEC ${formatRate(unit.stats.intellect + unit.stats.initiative)} - Move ${unit.moveSpeed}</div></div>
      <div class="unit-readout"><strong class="unit-percent">${Math.floor(pct(unit))}%</strong><span class="unit-estimate">${escapeHtml(estimatePhase(unit))}</span></div>
      ${gm ? `<div class="vector-card-tools"><button class="vector-icon-button damage-button" data-action="stagger" data-id="${escapeHtml(unit.id)}" title="Damage / Stagger" aria-label="Apply Stagger"><span class="target-symbol"></span></button>${poiseTool}</div>` : ""}
    </div>
    <div class="meter vector-phase-meter ${unit.phaseDirection === "down" ? "draining" : ""}"><div class="fill" style="width:${pct(unit)}%"></div><div class="vector-bar-label">${escapeHtml(awaitingPlayer ? "AWAITING PLAYER DECISION" : phaseLabel(unit))}</div></div>
    <div class="vector-action-line"><strong class="unit-action-name">${escapeHtml(awaitingPlayer ? "Awaiting Player" : actionLabel(unit))}</strong><span class="unit-risk">${escapeHtml(currentRiskLabel(unit))}</span></div>
    ${player && own ? `<label class="player-color-inline"><span>Color</span><input data-action="playerColor" data-id="${escapeHtml(unit.id)}" type="color" value="${escapeHtml(unit.color)}" /></label>` : ""}
    ${gm ? `<div class="unit-actions"><label>Name<input data-action="name" data-id="${escapeHtml(unit.id)}" value="${escapeHtml(unit.characterName)}" /></label>${unit.team === "pc" ? `<label>Command<input data-action="commandWindow" data-id="${escapeHtml(unit.id)}" type="number" min="1" value="${unit.commandWindow || DEFAULT_COMMAND_WINDOW}" /></label>` : ""}<label>Color<input data-action="color" data-id="${escapeHtml(unit.id)}" type="color" value="${escapeHtml(unit.color)}" /></label><button class="mini" data-action="nudge" data-id="${escapeHtml(unit.id)}">+5%</button><button class="mini danger" data-action="remove" data-id="${escapeHtml(unit.id)}">Remove</button></div>` : ""}
    ${gm && !awaitingPlayer ? actionButtonsMarkup(unit) : ""}
  </article>`;
}

function updateUnitCard(card, unit) {
  card.querySelector(".fill")?.style.setProperty("width", `${pct(unit)}%`);
  const percent = card.querySelector(".unit-percent"); if (percent) percent.textContent = `${Math.floor(pct(unit))}%`;
  const estimate = card.querySelector(".unit-estimate"); if (estimate) estimate.textContent = estimatePhase(unit);
  const actionName = card.querySelector(".unit-action-name"); if (actionName) actionName.textContent = actionLabel(unit);
  const risk = card.querySelector(".unit-risk"); if (risk) risk.textContent = currentRiskLabel(unit);
}

function renderUnitList(units) {
  const gm = mode === "gm";
  const player = mode === "player";
  const wanted = new Set(units.map((unit) => unit.id));
  for (const card of elements.unitList.querySelectorAll("[data-unit-id]")) if (!wanted.has(card.dataset.unitId)) card.remove();
  units.forEach((unit, index) => {
    let card = elements.unitList.querySelector(`[data-unit-id="${CSS.escape(unit.id)}"]`);
    const signature = unitStructureSignature(unit, gm, player);
    if (!card || card.dataset.signature !== signature) {
      const shell = document.createElement("div");
      shell.innerHTML = unitCardMarkup(unit, { gm, player }).trim();
      const replacement = shell.firstElementChild;
      if (card) card.replaceWith(replacement); else elements.unitList.append(replacement);
      card = replacement;
    }
    updateUnitCard(card, unit);
    const expected = elements.unitList.children[index];
    if (expected !== card) elements.unitList.insertBefore(card, expected || null);
  });
}

function renderActivePanel() {
  if (!state) return;
  const active = activeUnit();
  if (state.activeAction) {
    elements.activeKicker.textContent = "Resolve Action";
    elements.activeTitle.textContent = `RESOLVE: ${state.activeAction.label}`;
    const target = state.activeAction.targetName !== "None/N/A" ? `Target ${state.activeAction.targetName}` : "No target";
    const moving = state.activeAction.movingTargetPenalty ? ` - Moving target To-Hit -${state.activeAction.movingTargetPenalty}` : "";
    elements.activeMeta.textContent = `${state.activeAction.characterName} - ${target}${moving}`;
  } else if (state.pendingStagger) {
    elements.activeKicker.textContent = "Stagger Response"; elements.activeTitle.textContent = `Awaiting ${state.pendingStagger.characterName}`; elements.activeMeta.textContent = `${formatSecondsValue(state.pendingStagger.duration)} Stagger`;
  } else if (active) {
    elements.activeKicker.textContent = "Decision Window";
    elements.activeTitle.textContent = mode === "gm" && active.controlledBy === "player" ? "Awaiting player decision" : `${active.characterName}: choose action`;
    elements.activeMeta.textContent = commandFor(active) ? `${formatClock(commandFor(active).remaining)} Command Window` : active.characterName;
  } else {
    elements.activeKicker.textContent = "Clock Status";
    elements.activeTitle.textContent = state.hardPaused ? "All timers paused" : state.running ? "Action phases in motion" : state.units.length ? "Waiting for GM to engage clock" : "Waiting for characters";
    elements.activeMeta.textContent = `${state.units.length} participant${state.units.length === 1 ? "" : "s"}`;
  }
}

function playerActionMarkup() {
  return playerVisibleActions().map((entry, index) => `<button type="button" class="player-action-choice action-${escapeHtml(entry.id)}" data-action-id="${escapeHtml(entry.id)}" data-index="${String(index + 1).padStart(2, "0")}"><span>${escapeHtml(entry.label)}</span></button>`).join("");
}

function renderPlayerCommand(mine) {
  const isDecision = Boolean(mine && state?.activeId === mine.id);
  const isResolution = Boolean(mine && state?.activeAction?.unitId === mine.id);
  const focus = mode === "player" && (isDecision || isResolution);
  const focusEnded = playerFocusWasActive && !focus && mode === "player";
  playerFocusWasActive = focus;
  elements.playerFocusScreen.classList.toggle("hidden", !focus);
  document.body.classList.toggle("player-focus-active", focus);
  if (focusEnded) requestAnimationFrame(() => window.scrollTo(0, 0));
  if (!focus || !mine) return;
  elements.playerFocusCharacter.textContent = mine.characterName;
  elements.playerFocusRoomCode.textContent = state.roomCode;
  elements.playerDecisionView.classList.toggle("hidden", !isDecision);
  elements.playerResolutionView.classList.toggle("hidden", !isResolution);
  if (isResolution) {
    elements.playerFocusEyebrow.textContent = "Resolution";
    elements.playerResolutionAction.textContent = state.activeAction.label;
    elements.playerResolutionStatus.textContent = state.activeAction.targetName !== "None/N/A" ? `Target: ${state.activeAction.targetName}` : "GM resolving";
    return;
  }
  const command = commandFor(mine);
  const percent = command ? clamp((command.remaining / command.total) * 100, 0, 100) : 100;
  elements.playerFocusEyebrow.textContent = mine.decisionBoost ? "Decision x2" : "Decision Window";
  elements.playerFocusCommandTime.textContent = command ? formatClock(command.remaining) : "READY";
  elements.playerFocusPrompt.textContent = command?.expired ? "Choose now" : "Choose one action";
  elements.playerCommandTrackFill.style.width = `${percent}%`;
  elements.playerFocusTimer.style.setProperty("--command-elapsed", `${100 - percent}%`);
  elements.playerFocusTimer.style.setProperty("--timer-hue", `${Math.round(percent * 1.2)}deg`);
  elements.playerFocusTimer.classList.toggle("urgent", Boolean(command && command.remaining <= 10 && command.remaining > 5));
  elements.playerFocusTimer.classList.toggle("critical", Boolean(command && command.remaining <= 5));
  if (!elements.playerFocusActions.children.length) elements.playerFocusActions.innerHTML = playerActionMarkup();
}

function availablePoiseChoices(unit) {
  if (!unit || unit.poiseLocked) return [];
  const level = Number(unit.stats.composure) || 0;
  const points = Number(unit.poiseRemaining) || 0;
  const choices = [];
  if (level >= 1 && points >= 1) choices.push({ use: "snapBack", name: "Snap Back", cost: 1, text: "Void the current state and begin Decision at twice normal speed." });
  if (level >= 3 && points >= 1 && !["decision", "stagger"].includes(unit.phase) && !unit.staggerImmunity) choices.push({ use: "staggerImmunity", name: "Stagger Immunity", cost: 1, text: "Ignore Stagger until the next Decision fills." });
  const attackWindow = unit.phase === "decision" || (unit.phase === "preparation" && unit.currentAction?.kind === "attack");
  if (level >= 4 && points >= 2 && attackWindow) choices.push({ use: "heavyStagger", name: unit.pendingAttackPoise?.heavyStagger ? "Cancel Crushing Commitment" : "Crushing Commitment", cost: unit.pendingAttackPoise?.heavyStagger ? 0 : 2, text: "Double inflicted Stagger and this attack's Recovery time." });
  if (level >= 5 && points >= 2 && attackWindow) choices.push({ use: "poiseBreaker", name: unit.pendingAttackPoise?.poiseBreaker ? "Cancel Poise Breaker" : "Poise Breaker", cost: unit.pendingAttackPoise?.poiseBreaker ? 0 : 2, text: "Defeat all Poise protection; double Preparation time." });
  if (level >= 6 && points >= 3) choices.push({ use: "rapidRecovery", name: "Rapid Recovery", cost: 3, text: "Halve the next three Recovery or Stagger durations. Stacks." });
  return choices;
}

function renderPoiseControls(mine) {
  const show = mode === "player" && Boolean(mine) && mine.poiseMax > 0;
  elements.playerPoiseButton.classList.toggle("hidden", !show);
  if (mine) {
    elements.playerPoiseCount.textContent = `${mine.poiseRemaining}/${mine.poiseMax}`;
    elements.playerPoiseButton.classList.toggle("empty", mine.poiseRemaining <= 0);
    elements.playerPoiseButton.classList.toggle("braced", Boolean(mine.staggerImmunity));
  }
  if (elements.poiseDialog.classList.contains("hidden")) return;
  const target = state?.units.find((unit) => unit.id === poiseTargetId);
  if (!target) return closePoiseDialog();
  elements.poiseDialogTarget.textContent = `${target.characterName} - ${target.poiseRemaining}/${target.poiseMax}`;
  const choices = availablePoiseChoices(target);
  elements.poiseChoiceList.innerHTML = choices.length ? choices.map((choice) => `<button type="button" data-poise-use="${choice.use}"><strong>${escapeHtml(choice.name)}${choice.cost ? ` - ${choice.cost} Poise` : ""}</strong><small>${escapeHtml(choice.text)}</small></button>`).join("") : `<p class="empty-poise-options">No Poise options are available now.</p>`;
}

function renderQueue(mine) {
  const show = mode === "player" && Boolean(mine);
  elements.playerQueueButton.classList.toggle("hidden", !show);
  if (mine) elements.playerQueueCount.textContent = `${mine.actionQueue.length}/2`;
  if (elements.queueDialog.classList.contains("hidden") || !mine) return;
  elements.queuedActionList.innerHTML = mine.actionQueue.length ? mine.actionQueue.map((entry, index) => `<article><div><strong>${escapeHtml(actionById(entry.actionId).label)}</strong><span>${entry.targetId ? escapeHtml(state.units.find((unit) => unit.id === entry.targetId)?.characterName || "Invalid target") : entry.distance ? `${formatRate(entry.distance)} units` : "Configured"}</span></div><button type="button" data-remove-queue="${index}" aria-label="Remove queued action">&times;</button></article>`).join("") : `<p class="queue-empty">No actions queued.</p>`;
  elements.queueActionChoices.innerHTML = mine.actionQueue.length >= 2 ? "" : playerVisibleActions().map((entry) => `<button type="button" data-queue-action="${entry.id}">${escapeHtml(entry.label)}</button>`).join("");
}

function renderStaggerResponse() {
  const pending = state?.pendingStagger;
  const unit = pending ? state.units.find((entry) => entry.id === pending.unitId) : null;
  const responsible = unit && ((mode === "player" && unit.id === myUnitId) || (mode === "gm" && unit.controlledBy !== "player"));
  elements.staggerResponseDialog.classList.toggle("hidden", !responsible);
  if (responsible) {
    elements.staggerResponseTitle.textContent = `${unit.characterName}: Stagger`;
    elements.staggerResponseText.textContent = `${formatSecondsValue(pending.duration)} will void the current action.`;
    elements.ignoreStagger.classList.toggle("hidden", unit.stats.composure < 2 || unit.poiseRemaining < 1);
  }
}

function renderResolutionDialog() {
  if (mode === "gm" && state?.activeAction) {
    elements.turnDialogKicker.textContent = state.activeAction.action.poiseBreaker ? "Poise Breaker" : "Resolve Action";
    elements.activeName.textContent = `RESOLVE: ${state.activeAction.label}`;
    const moving = state.activeAction.movingTargetPenalty ? ` - To-Hit ${-state.activeAction.movingTargetPenalty}` : "";
    elements.activeOwner.textContent = `${state.activeAction.characterName} - Target: ${state.activeAction.targetName}${moving}`;
    elements.turnDialog.classList.remove("hidden");
  } else elements.turnDialog.classList.add("hidden");
}

function renderPlayerLog(mine) {
  if (!state) return;
  const markup = state.log.slice().reverse().map((entry) => `<article><time>${escapeHtml(entry.at)}</time><p>${escapeHtml(entry.text)}</p></article>`).join("");
  elements.playerLogList.innerHTML = markup;
  elements.logList.innerHTML = state.log.slice().reverse().map((entry) => `<div><span>${escapeHtml(entry.at)}</span>${escapeHtml(entry.text)}</div>`).join("");
  const command = commandFor(mine);
  elements.playerLogCommand.classList.toggle("hidden", !command);
  if (command) elements.playerLogCommandTime.textContent = formatClock(command.remaining);
}

function render() {
  if (!currentRoomCode && !["welcome", "roomJoin"].includes(mode)) mode = "welcome";
  document.body.classList.toggle("gm-mode", mode === "gm");
  document.body.classList.toggle("player-mode", mode === "player");
  elements.welcomePanel.classList.toggle("hidden", mode !== "welcome");
  elements.roomJoinPanel.classList.toggle("hidden", mode !== "roomJoin");
  elements.joinPanel.classList.toggle("hidden", mode !== "join");
  elements.gmPanel.classList.toggle("hidden", mode !== "gm");
  elements.gmTopControls.classList.toggle("hidden", mode !== "gm");
  elements.gmMuteSound.classList.toggle("hidden", mode !== "gm");
  elements.playerTopControls.classList.toggle("hidden", mode !== "player");
  elements.topbar.classList.toggle("hidden", ["welcome", "roomJoin"].includes(mode));
  elements.initiativePanel.classList.toggle("hidden", !state || !["gm", "player"].includes(mode));
  elements.logPanel.classList.toggle("hidden", !state || mode !== "gm");
  elements.activePanel.classList.toggle("hidden", !state || mode !== "gm");
  elements.gmPanicPause.classList.toggle("hidden", mode !== "gm" || !state);
  if (!state) return;
  const previousRejoinId = elements.rejoinSelect.value || myUnitId;
  const rejoinable = mode === "join" ? state.units.filter((unit) => unit.controlledBy === "player") : [];
  elements.rejoinBlock.classList.toggle("hidden", rejoinable.length === 0);
  elements.rejoinSelect.innerHTML = rejoinable.map((unit) => `<option value="${escapeHtml(unit.id)}"${unit.id === previousRejoinId ? " selected" : ""}>${escapeHtml(unit.characterName)} (${escapeHtml(unit.playerName)})</option>`).join("");
  elements.roomCode.textContent = state.roomCode;
  elements.playerRoomCode.textContent = state.roomCode;
  elements.readyCount.textContent = `${state.units.filter((unit) => unit.phase === "decision" && unit.phaseProgress >= 100).length} Ready`;
  elements.clockState.textContent = state.hardPaused ? "Paused" : state.pausedForStagger ? "Stagger" : state.pausedForResolution ? "Resolution" : state.pausedForTurn ? "Decision" : state.running ? "Engaged" : "Waiting";
  elements.gmPanicPause.innerHTML = state.hardPaused || (!state.running && !state.pausedForTurn && !state.pausedForResolution && !state.pausedForStagger) ? "<span>Engage Clock</span>" : "<span>Pause Everything</span>";
  const mine = myUnit();
  const visibleUnits = mode === "player" && mine ? [mine] : state.units;
  renderUnitList(visibleUnits);
  renderActivePanel();
  renderPlayerCommand(mine);
  renderPoiseControls(mine);
  renderQueue(mine);
  renderStaggerResponse();
  renderResolutionDialog();
  renderPlayerLog(mine);
  elements.enableAlerts.textContent = alertsEnabled ? "Sound: On" : "Sound: Off";
  elements.undoLastTiming.disabled = !state.undoAvailable;
}

function targetOptions(unit) {
  const likely = state.units.filter((entry) => entry.id !== unit.id && entry.team !== unit.team);
  return `${likely.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.characterName)}</option>`).join("")}<option value="__other__">Other...</option><option value="">None/N/A</option>`;
}

function openActionConfig(unitId, actionId, { queue = false } = {}) {
  const unit = state?.units.find((entry) => entry.id === unitId);
  const template = actionById(actionId);
  if (!unit || !template) return;
  const needsConfig = template.kind === "move" || template.targetMode !== "none" || (template.id === "improvised" && mode === "gm");
  if (!needsConfig) return submitConfiguredAction({ unitId, actionId, queue });
  actionConfigContext = { unitId, actionId, queue };
  elements.actionConfigEyebrow.textContent = queue ? "Queue Action" : template.id === "improvised" ? "GM Special Action" : "Configure Action";
  elements.actionConfigTitle.textContent = template.label;
  elements.actionDistanceWrap.classList.toggle("hidden", template.kind !== "move");
  elements.actionTargetWrap.classList.toggle("hidden", template.targetMode === "none");
  elements.improvisedFields.classList.toggle("hidden", template.id !== "improvised" || mode !== "gm");
  elements.actionOtherTargetWrap.classList.add("hidden");
  if (template.targetMode !== "none") {
    elements.actionTarget.innerHTML = targetOptions(unit);
    elements.actionOtherTarget.innerHTML = state.units.filter((entry) => entry.id !== unit.id).map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.characterName)} (${entry.team.toUpperCase()})</option>`).join("");
  }
  elements.actionConfigDialog.classList.remove("hidden");
}

function closeActionConfig() { actionConfigContext = null; elements.actionConfigDialog.classList.add("hidden"); elements.actionOtherTargetWrap.classList.add("hidden"); }

async function submitConfiguredAction({ unitId, actionId, queue = false, targetId = null, distance = null, customAction = null }) {
  const payload = { action: queue ? "queueAction" : "chooseAction", id: unitId, actionId, targetId, distance, customAction };
  if (!queue && mode === "player") {
    if (playerActionRequestPending) return;
    playerActionRequestPending = true;
    elements.playerFocusActions.setAttribute("aria-busy", "true");
    elements.playerFocusPrompt.textContent = "Locking action";
  }
  await action(payload, "start");
  playerActionRequestPending = false;
  elements.playerFocusActions.removeAttribute("aria-busy");
  if (queue) openQueueDialog();
}

function confirmConfiguredAction() {
  if (!actionConfigContext) return;
  const context = actionConfigContext;
  const template = actionById(context.actionId);
  let targetId = null;
  if (template.targetMode !== "none") targetId = elements.actionTarget.value === "__other__" ? elements.actionOtherTarget.value : elements.actionTarget.value || null;
  const distance = template.kind === "move" ? Math.max(0.01, numberValue("actionDistance", 1)) : null;
  const customAction = template.id === "improvised" && mode === "gm" ? {
    label: elements.improvisedName.value,
    preparationRate: numberValue("improvisedPreparation", 10), preparationRisk: numberValue("improvisedPreparationRisk", 1),
    executionRate: numberValue("improvisedExecution", 20), executionRisk: numberValue("improvisedExecutionRisk", 3),
    recoveryRate: numberValue("improvisedRecovery", 15), recoveryRisk: numberValue("improvisedRecoveryRisk", 2), hasResolution: true,
  } : null;
  closeActionConfig();
  submitConfiguredAction({ ...context, targetId, distance, customAction });
}

function openPoiseDialog(unitId) { poiseTargetId = unitId; elements.poiseDialog.classList.remove("hidden"); document.body.classList.add("poise-modal-open"); renderPoiseControls(myUnit()); }
function closePoiseDialog() { poiseTargetId = ""; elements.poiseDialog.classList.add("hidden"); document.body.classList.remove("poise-modal-open"); }
function openStaggerDialog(unitId) { const unit = state?.units.find((entry) => entry.id === unitId); if (!unit) return; staggerTargetId = unitId; elements.staggerDialogTarget.textContent = unit.characterName; elements.staggerDuration.value = "5"; elements.staggerDialog.classList.remove("hidden"); elements.staggerDuration.focus(); }
function closeStaggerDialog() { staggerTargetId = ""; elements.staggerDialog.classList.add("hidden"); }
function openQueueDialog() { elements.queueDialog.classList.remove("hidden"); renderQueue(myUnit()); }
function closeQueueDialog() { elements.queueDialog.classList.add("hidden"); }
function openPlayerLog() { elements.playerLogDrawer.classList.remove("hidden"); document.body.classList.add("player-log-open"); }
function closePlayerLogDrawer() { elements.playerLogDrawer.classList.add("hidden"); document.body.classList.remove("player-log-open"); }

function ensureAudio() { const Context = window.AudioContext || window.webkitAudioContext; if (!audioContext) audioContext = new Context(); if (audioContext.state === "suspended") audioContext.resume(); return audioContext; }
function tone(frequency, duration, gainValue = 0.04, type = "square") { const audio = ensureAudio(); const osc = audio.createOscillator(); const gain = audio.createGain(); osc.type = type; osc.frequency.value = frequency; gain.gain.setValueAtTime(gainValue, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration); osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + duration + 0.02); }
function playCombatStartSting() { combatStartAudio.pause(); combatStartAudio.currentTime = 0; combatStartAudio.volume = 0.9; combatStartAudio.play().catch(() => {}); }
function playGmSound(name) { if (gmSoundsMuted) return; try { tone(name === "danger" ? 280 : name === "resolve" ? 760 : 680, 0.07, 0.025, "square"); } catch { /* Audio permission is optional. */ } }
function playTurnDing() { try { tone(880, 0.22, 0.24, "sine"); setTimeout(() => tone(1320, 0.25, 0.2, "sine"), 120); } catch { /* Visual alert remains. */ } }
function playInterruptedBuzz() { try { tone(180, 0.35, 0.35, "sawtooth"); } catch { /* Log remains. */ } }

function notifyTurnIfNeeded() {
  const active = activeUnit();
  if (!active) { lastNotifiedActiveId = ""; return; }
  if (mode === "player" && active.id === myUnitId && alertsEnabled && lastNotifiedActiveId !== active.id) {
    lastNotifiedActiveId = active.id;
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
    playTurnDing();
  }
}

function notifyInterruptionIfNeeded() {
  if (mode !== "player" || !state?.lastInterruptedId || state.lastInterruptedId !== myUnitId || !alertsEnabled) return;
  const key = `${state.lastInterruptedId}:${state.lastInterruptedAt}`;
  if (key === lastInterruptedNotice) return;
  lastInterruptedNotice = key;
  if (navigator.vibrate) navigator.vibrate([280, 90, 420]);
  playInterruptedBuzz();
}

function enablePlayerAlerts(test = false) { alertsEnabled = true; safeLocalStorageSet("vector-atb-alerts", "on"); ensureAudio(); if (test) playTurnDing(); }
function disablePlayerAlerts() { alertsEnabled = false; safeLocalStorageSet("vector-atb-alerts", "off"); }

function returnToWelcome(message = "") {
  if (events) events.close();
  events = null; state = null; currentRoomCode = ""; myUnitId = "";
  localStorage.removeItem("vector-atb-room-code"); localStorage.removeItem("vector-atb-unit-id");
  setConnected(false, message || "Disconnected."); setMode("welcome");
}

elements.createRoom.addEventListener("click", async () => {
  try { const response = await fetch("/api/create-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (response.ok) { setRoom(await response.json()); myUnitId = ""; setMode("gm"); } } catch { setConnected(false, "Cannot reach the Vector server."); }
});
elements.showJoinRoom.addEventListener("click", () => setMode("roomJoin"));
elements.backToWelcome.addEventListener("click", () => setMode("welcome"));
elements.openGm.addEventListener("click", () => setMode("roomJoin"));
elements.joinRoomCode.addEventListener("input", () => { elements.joinRoomCode.value = elements.joinRoomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); });
elements.confirmJoinRoom.addEventListener("click", async () => {
  const code = elements.joinRoomCode.value.trim().toUpperCase(); if (!code) return;
  try { const response = await fetch(`/api/state?room=${encodeURIComponent(code)}`); if (!response.ok) return setConnected(false, "Room not found."); setRoom(await response.json()); setMode("join"); } catch { setConnected(false, "Cannot reach the room."); }
});
elements.joinPlayer.addEventListener("click", async () => {
  enablePlayerAlerts();
  const next = await action({ action: "join", playerName: elements.playerName.value || "Player", characterName: elements.characterName.value || "Character", color: elements.playerColor.value, controlledBy: "player", team: "pc", commandWindow: DEFAULT_COMMAND_WINDOW, ...collectEntryData(pcFields) });
  if (!next) return;
  const unit = next.units.at(-1); myUnitId = unit.id; safeLocalStorageSet("vector-atb-unit-id", myUnitId); setMode("player");
});
elements.rejoinPlayer.addEventListener("click", () => { myUnitId = elements.rejoinSelect.value; safeLocalStorageSet("vector-atb-unit-id", myUnitId); setMode("player"); });

elements.gmAddUnit.addEventListener("click", async () => {
  if (elements.gmTeam.value === "npc") applyNpcDefaultPreview();
  await action({ action: "addUnit", playerName: elements.gmPlayerName.value || "GM", characterName: elements.gmCharacterName.value || "NPC", commandWindow: elements.gmTeam.value === "pc" ? elements.gmCommandWindow.value : null, color: elements.gmColor.value, controlledBy: "gm", team: elements.gmTeam.value, ...collectEntryData(gmFields) });
  if (elements.gmTeam.value === "npc") { nextNpcDefault(); applyNpcDefaultPreview({ force: true }); }
});
elements.gmTeam.addEventListener("change", () => { elements.gmCommandWindowWrap.classList.toggle("hidden", elements.gmTeam.value !== "pc"); if (elements.gmTeam.value === "npc") { nextNpcDefault(); applyNpcDefaultPreview({ force: true }); } });

elements.unitList.addEventListener("click", (event) => {
  const actionButton = event.target.closest(".vector-action-button");
  if (actionButton) { const unitId = actionButton.closest("[data-action-unit]")?.dataset.actionUnit; if (unitId) openActionConfig(unitId, actionButton.dataset.actionId); return; }
  const button = event.target.closest("button"); if (!button || mode !== "gm") return;
  const unitId = button.dataset.id;
  if (button.dataset.action === "stagger") openStaggerDialog(unitId);
  if (button.dataset.action === "poise") openPoiseDialog(unitId);
  if (button.dataset.action === "remove") action({ action: "removeUnit", id: unitId }, "danger");
  if (button.dataset.action === "nudge") action({ action: "nudge", id: unitId, amount: 5 });
});
elements.unitList.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-action]"); if (!input) return;
  if (input.dataset.action === "playerColor" && input.dataset.id === myUnitId) action({ action: "setColor", id: myUnitId, color: input.value });
  if (mode !== "gm") return;
  if (input.dataset.action === "name") action({ action: "setName", id: input.dataset.id, characterName: input.value });
  if (input.dataset.action === "commandWindow") action({ action: "setCommandWindow", id: input.dataset.id, commandWindow: input.value });
  if (input.dataset.action === "color") action({ action: "setColor", id: input.dataset.id, color: input.value });
});

let playerPointer = null;
let lastPlayerPointerActivationAt = -Infinity;
elements.playerFocusActions.addEventListener("pointerdown", (event) => { const button = event.target.closest("button[data-action-id]"); if (button && event.isPrimary) playerPointer = { id: event.pointerId, button, x: event.clientX, y: event.clientY }; });
elements.playerFocusActions.addEventListener("pointerup", (event) => { if (!playerPointer || playerPointer.id !== event.pointerId) return; const pointer = playerPointer; playerPointer = null; if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) <= 20) { event.preventDefault(); lastPlayerPointerActivationAt = performance.now(); openActionConfig(myUnitId, pointer.button.dataset.actionId); } });
elements.playerFocusActions.addEventListener("pointercancel", () => { playerPointer = null; });
elements.playerFocusActions.addEventListener("click", (event) => { if (performance.now() - lastPlayerPointerActivationAt < 700) return; const button = event.target.closest("button[data-action-id]"); if (button) openActionConfig(myUnitId, button.dataset.actionId); });

elements.actionTarget.addEventListener("change", () => elements.actionOtherTargetWrap.classList.toggle("hidden", elements.actionTarget.value !== "__other__"));
elements.cancelActionConfig.addEventListener("click", closeActionConfig);
elements.confirmActionConfig.addEventListener("click", confirmConfiguredAction);
elements.actionConfigDialog.addEventListener("keydown", (event) => { if (event.key === "Escape") closeActionConfig(); });

elements.playerPoiseButton.addEventListener("click", () => { if (myUnitId) openPoiseDialog(myUnitId); });
elements.cancelPoise.addEventListener("click", closePoiseDialog);
elements.poiseChoiceList.addEventListener("click", async (event) => { const button = event.target.closest("button[data-poise-use]"); if (!button || !poiseTargetId) return; const id = poiseTargetId; closePoiseDialog(); await action({ action: "spendPoise", id, use: button.dataset.poiseUse }, "resolve"); });

elements.cancelStagger.addEventListener("click", closeStaggerDialog);
elements.confirmStagger.addEventListener("click", async () => { if (!staggerTargetId) return; const id = staggerTargetId; const duration = Math.max(0.1, Number(elements.staggerDuration.value) || 1); closeStaggerDialog(); await action({ action: "applyStagger", id, duration }, "danger"); });
elements.continueStagger.addEventListener("click", () => { const pending = state?.pendingStagger; if (pending) action({ action: "resolveStagger", id: pending.unitId, choice: "continue" }, "danger"); });
elements.ignoreStagger.addEventListener("click", () => { const pending = state?.pendingStagger; if (pending) action({ action: "resolveStagger", id: pending.unitId, choice: "ignore" }, "resolve"); });

elements.playerQueueButton.addEventListener("click", openQueueDialog);
elements.closeQueueDialog.addEventListener("click", closeQueueDialog);
elements.queueActionChoices.addEventListener("click", (event) => { const button = event.target.closest("button[data-queue-action]"); if (!button) return; closeQueueDialog(); openActionConfig(myUnitId, button.dataset.queueAction, { queue: true }); });
elements.queuedActionList.addEventListener("click", async (event) => { const button = event.target.closest("button[data-remove-queue]"); if (!button) return; await action({ action: "removeQueuedAction", id: myUnitId, index: Number(button.dataset.removeQueue) }); renderQueue(myUnit()); });

elements.completeTurn.addEventListener("click", () => action({ action: "completeResolution" }, "resolve"));
elements.gmPanicPause.addEventListener("click", () => { const now = performance.now(); if (now - lastGmClockClickAt < 450) return; lastGmClockClickAt = now; action({ action: "toggleClock" }, state?.running ? "pause" : "start"); });
elements.stepTick.addEventListener("click", () => action({ action: "step" }));
elements.resetAll.addEventListener("click", () => { if (confirm("Reset every character and Poise pool?")) action({ action: "reset" }, "danger"); });
elements.clearEncounter.addEventListener("click", () => { if (confirm("Remove every participant?")) action({ action: "clearEncounter" }, "danger"); });
elements.undoLastTiming.addEventListener("click", () => action({ action: "undoLastTiming" }));
elements.exitCombat.addEventListener("click", () => returnToWelcome("Exited combat."));
elements.leaveRoom.addEventListener("click", () => returnToWelcome("Left the room."));
elements.gmMuteSound.addEventListener("click", () => { gmSoundsMuted = !gmSoundsMuted; safeLocalStorageSet("vector-atb-gm-muted", gmSoundsMuted ? "on" : "off"); elements.gmMuteSound.classList.toggle("muted", gmSoundsMuted); });
elements.enableAlerts.addEventListener("click", () => { if (alertsEnabled) disablePlayerAlerts(); else enablePlayerAlerts(true); render(); });
elements.playerLogButton.addEventListener("click", openPlayerLog);
elements.playerFocusLogButton.addEventListener("click", openPlayerLog);
elements.closePlayerLog.addEventListener("click", closePlayerLogDrawer);

setInterval(() => {
  const mine = myUnit();
  if (mode !== "player" || !mine || !alertsEnabled || document.hidden || state?.hardPaused || !state?.running) return;
  const completion = mine.phaseDirection === "down" ? 100 - pct(mine) : pct(mine);
  if (completion < 75) return;
  const intensity = (completion - 75) / 25;
  try { tone(920 + intensity * 380, 0.025, 0.008 + intensity * 0.035, "square"); } catch { /* Sound remains optional. */ }
}, 500);

setInterval(async () => {
  if (mode !== "gm" || !currentRoomCode) return;
  try { const response = await fetch(`/api/keep-alive?room=${encodeURIComponent(currentRoomCode)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (response.ok) receiveState(await response.json()); } catch { /* SSE will reconnect. */ }
}, KEEP_ALIVE_MS);

nextNpcDefault();
applyNpcDefaultPreview({ force: true });
if (currentRoomCode && !["welcome", "roomJoin"].includes(mode)) {
  fetch(`/api/state?room=${encodeURIComponent(currentRoomCode)}`).then((response) => response.ok ? response.json() : null).then((next) => { if (next) setRoom(next); else returnToWelcome("That room expired."); }).catch(() => setConnected(false, "Cannot reconnect."));
} else render();
