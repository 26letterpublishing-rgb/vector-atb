const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const HOST = "0.0.0.0";
const PUBLIC_DIR = __dirname;
const HEARTBEAT_MS = 25000;
const THRESHOLD = 100;
const DEFAULT_COMMAND_WINDOW = 20;
const DUMBFOUNDED_RATE = 20;
const EXPIRED_COMMAND_MULTIPLIER = 0.2;
const MOVE_EDGE_RATE = 75;

const rooms = new Map();
const clients = new Map();
let stateSequence = 0;

const ACTIONS = {
  move: { id: "move", label: "Move", kind: "move", skill: null, hasResolution: false, targetMode: "none", risk: { preparation: 0, execution: 1, recovery: 0 }, notes: "Move a chosen distance." },
  use_item: { id: "use_item", label: "Use Item", kind: "item", skill: "initiative", hasResolution: true, targetMode: "optional", risk: { preparation: 1, execution: 3, recovery: 2 }, notes: "Use or activate an item." },
  defense: { id: "defense", label: "Defense", kind: "standard", skill: "dodge", hasResolution: false, targetMode: "none", risk: { preparation: 0, execution: 0, recovery: 0 }, notes: "Focus entirely on defense." },
  melee_attack: { id: "melee_attack", label: "Melee Attack", kind: "attack", skill: "melee", hasResolution: true, targetMode: "required", risk: null, notes: "Attack with a melee weapon." },
  fire_gun: { id: "fire_gun", label: "Fire Gun", kind: "attack", skill: "firearms", hasResolution: true, targetMode: "required", risk: null, notes: "Fire the equipped weapon." },
  close_quarter: { id: "close_quarter", label: "Close Quarter Action", kind: "attack", skill: "melee", hasResolution: true, targetMode: "required", risk: null, notes: "Wrestle, tackle, disarm, or restrain." },
  reload_ready: { id: "reload_ready", label: "Reload / Ready", kind: "standard", skill: "firearms", hasResolution: false, targetMode: "none", risk: null, notes: "Reload, draw, ready, or clear a weapon." },
  improvised: { id: "improvised", label: "Improvised Action", kind: "improvised", skill: null, hasResolution: true, targetMode: "optional", risk: { preparation: 1, execution: 3, recovery: 2 }, notes: "GM-configured special action." },
};

function id() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function whole(value, fallback = 0, min = 0, max = 999) {
  return clamp(Math.round(number(value, fallback)), min, max);
}

function positiveRate(value, fallback = 1) {
  return Math.max(0.01, number(value, fallback));
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#39e58f";
}

function normalizeTeam(value) {
  return value === "pc" ? "pc" : "npc";
}

function normalizeCommandWindow(value, team) {
  if (team !== "pc") return null;
  return whole(value, DEFAULT_COMMAND_WINDOW, 1, 999);
}

function normalizeRisk(value, fallback = 0) {
  return whole(value, fallback, 0, 3);
}

function normalizeStats(source = {}) {
  return {
    intellect: whole(source.intellect, 7, 0, 20),
    dexterity: whole(source.dexterity, 7, 0, 20),
    perception: whole(source.perception, 7, 0, 20),
    initiative: whole(source.initiative, 7, 0, 99),
    composure: whole(source.composure, 3, 0, 99),
    firearms: whole(source.firearms, 7, 0, 99),
    melee: whole(source.melee, 7, 0, 99),
    dodge: whole(source.dodge, 7, 0, 99),
  };
}

function normalizeWeapon(source = {}) {
  return {
    preparation: positiveRate(source.preparation, 10),
    execution: positiveRate(source.execution, 20),
    recovery: positiveRate(source.recovery, 15),
    risk: {
      preparation: normalizeRisk(source.risk?.preparation ?? source.preparationRisk, 1),
      execution: normalizeRisk(source.risk?.execution ?? source.executionRisk, 3),
      recovery: normalizeRisk(source.risk?.recovery ?? source.recoveryRisk, 2),
    },
  };
}

function moveSpeed(dexterity) {
  const dex = whole(dexterity, 0, 0, 20);
  if (dex <= 4) return dex;
  if (dex <= 10) return 4 + Math.floor((dex - 4) / 2);
  return Math.min(10, 7 + Math.floor((dex - 10) / 3));
}

function recoveryRate(dexterity, skill, weaponRecovery) {
  return positiveRate((25 * (number(dexterity) + number(skill) + 6)) / positiveRate(weaponRecovery, 15));
}

function actionMetadata() {
  return Object.values(ACTIONS).map((entry) => clone(entry));
}

function isAttack(action) {
  return action?.kind === "attack";
}

function actionRequestFromBody(body = {}) {
  return {
    actionId: String(body.actionId || "improvised"),
    targetId: body.targetId ? String(body.targetId) : null,
    distance: body.distance === undefined ? null : positiveRate(body.distance, 1),
    customAction: body.customAction ? clone(body.customAction) : null,
  };
}

function targetExists(room, targetId) {
  return !targetId || room.units.some((unit) => unit.id === targetId);
}

function requestIsValid(room, request) {
  const template = ACTIONS[request.actionId];
  if (!template) return false;
  if (!targetExists(room, request.targetId)) return false;
  if (template.kind === "move" && !(number(request.distance) > 0)) return false;
  return true;
}

function buildAction(room, unit, request, { queued = false } = {}) {
  const template = clone(ACTIONS[request.actionId] || ACTIONS.improvised);
  const stats = unit.stats;
  const weapon = unit.weapon;
  const target = room.units.find((entry) => entry.id === request.targetId) || null;
  const action = {
    ...template,
    targetId: target?.id || null,
    targetName: target?.characterName || "None/N/A",
    queued,
    rates: { preparation: 1, execution: 1, recovery: 1 },
    risk: clone(template.risk || weapon.risk),
    movement: null,
    heavyStagger: false,
    poiseBreaker: false,
    recoveryReductionStacks: 0,
  };

  if (template.kind === "improvised") {
    const custom = request.customAction || {};
    action.label = String(custom.label || template.label).trim().slice(0, 80) || template.label;
    action.rates = {
      preparation: positiveRate(custom.preparationRate, 10),
      execution: positiveRate(custom.executionRate, 20),
      recovery: positiveRate(custom.recoveryRate, 15),
    };
    action.risk = {
      preparation: normalizeRisk(custom.preparationRisk, 1),
      execution: normalizeRisk(custom.executionRisk, 3),
      recovery: normalizeRisk(custom.recoveryRisk, 2),
    };
    action.hasResolution = custom.hasResolution !== false;
  } else if (template.kind === "move") {
    const distance = positiveRate(request.distance, 1);
    const speed = Math.max(1, moveSpeed(stats.dexterity));
    const duration = (3 * distance) / speed;
    action.rates = { preparation: MOVE_EDGE_RATE, execution: THRESHOLD / duration, recovery: MOVE_EDGE_RATE };
    action.movement = { distance, speed, duration };
  } else if (template.kind === "item") {
    action.rates = {
      preparation: positiveRate(stats.perception + stats.initiative + 35),
      execution: positiveRate(stats.dexterity + stats.initiative + 5),
      recovery: positiveRate(stats.dexterity + stats.initiative + 35),
    };
  } else {
    const skill = number(stats[template.skill]);
    action.rates = {
      preparation: positiveRate(stats.perception + skill + weapon.preparation),
      execution: positiveRate(stats.dexterity + skill + weapon.execution),
      recovery: recoveryRate(stats.dexterity, skill, weapon.recovery),
    };
  }

  if (queued) action.rates.preparation += 1;

  if (isAttack(action)) {
    const pending = unit.pendingAttackPoise || {};
    const totalCost = (pending.heavyStagger ? 2 : 0) + (pending.poiseBreaker ? 2 : 0);
    if (totalCost <= unit.poiseRemaining) {
      action.heavyStagger = Boolean(pending.heavyStagger);
      action.poiseBreaker = Boolean(pending.poiseBreaker);
      unit.poiseRemaining -= totalCost;
      if (action.poiseBreaker) action.rates.preparation *= 0.5;
      if (action.heavyStagger) action.rates.recovery *= 0.5;
    }
  }
  unit.pendingAttackPoise = { heavyStagger: false, poiseBreaker: false };
  return action;
}

function currentPhaseRate(unit) {
  if (!unit) return 0;
  if (unit.phase === "decision") {
    const rate = positiveRate(unit.stats.intellect + unit.stats.initiative);
    return unit.decisionBoost ? rate * 2 : rate;
  }
  if (unit.phase === "dumbfounded") return DUMBFOUNDED_RATE;
  if (unit.phase === "stagger") return positiveRate(unit.staggerRate);
  if (!unit.currentAction) return 0;
  if (unit.phase === "preparation") return positiveRate(unit.currentAction.rates.preparation);
  if (unit.phase === "execution") return positiveRate(unit.currentAction.rates.execution);
  if (unit.phase === "recovery") return positiveRate(unit.currentAction.activeRecoveryRate || unit.currentAction.rates.recovery);
  return 0;
}

function currentRisk(unit) {
  if (!unit?.currentAction) return 0;
  if (unit.phase === "preparation") return normalizeRisk(unit.currentAction.risk.preparation);
  if (unit.phase === "execution" || unit.phase === "resolution") return normalizeRisk(unit.currentAction.risk.execution);
  if (unit.phase === "recovery") return normalizeRisk(unit.currentAction.risk.recovery);
  return 0;
}

function movementUnits(unit) {
  if (unit?.phase !== "execution" || unit.currentAction?.kind !== "move") return 0;
  const distance = number(unit.currentAction.movement?.distance);
  return Math.min(distance, Math.floor((distance * number(unit.phaseProgress)) / THRESHOLD + 1e-7));
}

function phaseDirection(phase) {
  if (phase === "decision" || phase === "execution") return "up";
  if (["preparation", "recovery", "dumbfounded", "stagger"].includes(phase)) return "down";
  return "hold";
}

function createRoom() {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = {
    roomCode: code,
    running: false,
    pausedForTurn: false,
    pausedForResolution: false,
    pausedForStagger: false,
    resumeAfterTurn: false,
    hardPaused: false,
    activeId: null,
    activeAction: null,
    pendingStagger: null,
    commandDeadline: null,
    commandTotal: 0,
    commandExpired: false,
    lastInterruptedId: null,
    lastInterruptedAt: 0,
    lastKeepAliveAt: Date.now(),
    lastTick: Date.now(),
    hasEngagedClock: false,
    threshold: THRESHOLD,
    units: [],
    log: [],
    undoSnapshot: null,
  };
  rooms.set(code, room);
  clients.set(code, new Set());
  pushLog(room, `Room ${code} created.`);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || "").trim().toUpperCase());
}

function commandState(room) {
  if (!room.activeId || !room.commandTotal) return null;
  const remaining = room.commandExpired || !room.commandDeadline ? 0 : Math.max(0, (room.commandDeadline - Date.now()) / 1000);
  return { unitId: room.activeId, total: room.commandTotal, remaining, expired: room.commandExpired };
}

function publicState(room) {
  return {
    revision: ++stateSequence,
    roomCode: room.roomCode,
    running: room.running,
    pausedForTurn: room.pausedForTurn,
    pausedForResolution: room.pausedForResolution,
    pausedForStagger: room.pausedForStagger,
    activeId: room.activeId,
    activeAction: clone(room.activeAction),
    pendingStagger: clone(room.pendingStagger),
    command: commandState(room),
    commandExpired: room.commandExpired,
    hardPaused: room.hardPaused,
    hasEngagedClock: room.hasEngagedClock,
    lastInterruptedId: room.lastInterruptedId,
    lastInterruptedAt: room.lastInterruptedAt,
    lastKeepAliveAt: room.lastKeepAliveAt,
    threshold: room.threshold,
    actions: actionMetadata(),
    units: room.units.map((unit) => ({
      ...clone(unit),
      phaseRate: currentPhaseRate(unit),
      phaseDirection: phaseDirection(unit.phase),
      currentRisk: currentRisk(unit),
      movementUnits: movementUnits(unit),
      moveSpeed: moveSpeed(unit.stats.dexterity),
    })),
    log: room.log.slice(-40),
    undoAvailable: Boolean(room.undoSnapshot),
  };
}

function pushLog(room, text) {
  room.log.push({ id: id(), at: new Date().toLocaleTimeString(), text });
  room.log = room.log.slice(-100);
}

function snapshotRoom(room) {
  return {
    running: room.running,
    pausedForTurn: room.pausedForTurn,
    pausedForResolution: room.pausedForResolution,
    pausedForStagger: room.pausedForStagger,
    resumeAfterTurn: room.resumeAfterTurn,
    hardPaused: room.hardPaused,
    activeId: room.activeId,
    activeAction: clone(room.activeAction),
    pendingStagger: clone(room.pendingStagger),
    commandRemaining: room.commandDeadline ? Math.max(0, (room.commandDeadline - Date.now()) / 1000) : null,
    commandTotal: room.commandTotal,
    commandExpired: room.commandExpired,
    lastInterruptedId: room.lastInterruptedId,
    lastInterruptedAt: room.lastInterruptedAt,
    hasEngagedClock: room.hasEngagedClock,
    units: clone(room.units),
    log: clone(room.log),
  };
}

function saveUndoSnapshot(room) {
  room.undoSnapshot = snapshotRoom(room);
}

function restoreUndoSnapshot(room) {
  if (!room.undoSnapshot) return false;
  const snap = room.undoSnapshot;
  Object.assign(room, clone(snap));
  room.commandDeadline = snap.commandRemaining === null ? null : Date.now() + snap.commandRemaining * 1000;
  room.undoSnapshot = null;
  room.lastTick = Date.now();
  pushLog(room, "Undid last timing change.");
  return true;
}

const undoableActions = new Set(["join", "addUnit", "removeUnit", "setRunning", "setHardPaused", "toggleClock", "setCommandWindow", "setName", "setColor", "chooseAction", "queueAction", "removeQueuedAction", "completeResolution", "applyStagger", "resolveStagger", "spendPoise", "step", "reset", "clearEncounter", "nudge"]);

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room) {
  const data = publicState(room);
  for (const res of clients.get(room.roomCode) || []) sendEvent(res, "state", data);
}

function canStartClock(room) {
  return room.units.length > 0 && !room.pausedForTurn && !room.pausedForResolution && !room.pausedForStagger;
}

function clearCommand(room) {
  room.commandDeadline = null;
  room.commandTotal = 0;
  room.commandExpired = false;
}

function tieCompare(a, b) {
  if (a.team !== b.team) return a.team === "pc" ? -1 : 1;
  const rateDifference = currentPhaseRate(b) - currentPhaseRate(a);
  return rateDifference || a.tieSeed - b.tieSeed;
}

function readyUnits(room, excludeId = null) {
  return room.units.filter((unit) => unit.id !== excludeId && unit.phase === "decision" && unit.phaseProgress >= THRESHOLD).sort(tieCompare);
}

function clearPoiseBuffs(unit) {
  unit.staggerImmunity = false;
  unit.recoveryPoiseStacks = [];
  unit.pendingAttackPoise = { heavyStagger: false, poiseBreaker: false };
}

function completeExecutionPoise(room, unit) {
  unit.cleanExecutionCount = whole(unit.cleanExecutionCount) + 1;
  unit.totalExecutionCount = whole(unit.totalExecutionCount) + 1;
  let restored = 0;
  if (unit.stats.composure >= 8 && unit.cleanExecutionCount >= 5) {
    unit.cleanExecutionCount = 0;
    restored += 1;
  }
  if (unit.stats.composure >= 10 && unit.totalExecutionCount >= 8) {
    unit.totalExecutionCount %= 8;
    restored += 1;
  }
  if (restored) {
    const before = unit.poiseRemaining;
    unit.poiseRemaining = Math.min(unit.poiseMax, unit.poiseRemaining + restored);
    if (unit.poiseRemaining > before) pushLog(room, `${unit.characterName} regained ${unit.poiseRemaining - before} Poise.`);
  }
}

function consumeRecoveryPoise(unit) {
  const stacks = Array.isArray(unit.recoveryPoiseStacks) ? unit.recoveryPoiseStacks : [];
  const active = stacks.length;
  unit.recoveryPoiseStacks = stacks.map((uses) => uses - 1).filter((uses) => uses > 0);
  return active;
}

function chooseActionInternal(room, unit, request, { queued = false } = {}) {
  if (!requestIsValid(room, request)) return false;
  const action = buildAction(room, unit, request, { queued });
  unit.currentAction = action;
  unit.phase = "preparation";
  unit.phaseProgress = THRESHOLD;
  unit.commandExpired = false;
  unit.decisionBoost = false;
  unit.staggerImmunity = false;
  room.pausedForTurn = false;
  room.activeId = null;
  clearCommand(room);
  pushLog(room, `${unit.characterName} ${queued ? "activated queued action" : "chose"} ${action.label}${action.targetId ? ` targeting ${action.targetName}` : ""}.`);
  return true;
}

function pauseForDecision(room, unit) {
  if (!unit || room.pausedForTurn || room.pausedForResolution || room.pausedForStagger) return;
  unit.staggerImmunity = false;
  if (unit.actionQueue?.length) {
    const request = unit.actionQueue.shift();
    if (chooseActionInternal(room, unit, request, { queued: true })) {
      room.running = room.resumeAfterTurn && !room.hardPaused;
      room.lastTick = Date.now();
      return;
    }
    pushLog(room, `${unit.characterName}'s queued action became invalid.`);
  }
  room.running = false;
  room.pausedForTurn = true;
  room.activeId = unit.id;
  room.activeAction = null;
  unit.phase = "decision";
  unit.phaseProgress = THRESHOLD;
  unit.staggerRate = null;
  unit.commandExpired = false;
  room.commandExpired = false;
  if (unit.team === "pc" && unit.commandWindow) {
    room.commandTotal = unit.commandWindow;
    room.commandDeadline = Date.now() + unit.commandWindow * 1000;
    pushLog(room, `${unit.characterName} is ready. Command Window started (${unit.commandWindow} sec).`);
  } else {
    clearCommand(room);
    pushLog(room, `${unit.characterName} is ready.`);
  }
}

function interruptExpiredDecision(room) {
  if (!room.commandExpired || !room.activeId) return false;
  const unit = room.units.find((entry) => entry.id === room.activeId);
  if (!unit) return false;
  unit.phase = "dumbfounded";
  unit.phaseProgress = THRESHOLD;
  unit.currentAction = null;
  unit.commandExpired = false;
  unit.decisionBoost = false;
  unit.pendingAttackPoise = { heavyStagger: false, poiseBreaker: false };
  room.lastInterruptedId = unit.id;
  room.lastInterruptedAt = Date.now();
  room.activeId = null;
  clearCommand(room);
  pushLog(room, `${unit.characterName} is DUMBFOUNDED!`);
  return true;
}

function startRecovery(room, unit) {
  if (!unit?.currentAction) return;
  const reductionStacks = consumeRecoveryPoise(unit);
  unit.currentAction.recoveryReductionStacks = reductionStacks;
  unit.currentAction.activeRecoveryRate = unit.currentAction.rates.recovery * (2 ** reductionStacks);
  unit.phase = "recovery";
  unit.phaseProgress = THRESHOLD;
  const reduction = reductionStacks ? ` (Poise x${2 ** reductionStacks} speed)` : "";
  pushLog(room, `${unit.characterName} entered RECOVERY: ${unit.currentAction.label}${reduction}.`);
}

function cancelPausedActionFor(room, unit) {
  let releasedPause = false;
  if (room.activeId === unit.id) {
    room.activeId = null;
    room.pausedForTurn = false;
    clearCommand(room);
    releasedPause = true;
  }
  if (room.activeAction?.unitId === unit.id) {
    room.activeAction = null;
    room.pausedForResolution = false;
    releasedPause = true;
  }
  return releasedPause;
}

function finishPendingStagger(room) {
  room.pendingStagger = null;
  room.pausedForStagger = false;
  room.lastTick = Date.now();
  moveToNextOrClock(room);
}

function applyStaggerNow(room, unit, rawDuration, { poiseBreaker = false } = {}) {
  if (!unit) return false;
  let duration = clamp(number(rawDuration, 1), 0.1, 3600);
  if (poiseBreaker) {
    clearPoiseBuffs(unit);
    unit.poiseLocked = true;
  } else {
    if (unit.staggerImmunity) {
      pushLog(room, `${unit.characterName}'s Poise ignored a ${duration.toFixed(2)} sec STAGGER.`);
      return true;
    }
    const stacks = consumeRecoveryPoise(unit);
    if (stacks) duration /= 2 ** stacks;
  }

  unit.cleanExecutionCount = 0;
  const newRate = THRESHOLD / duration;
  if (unit.phase === "stagger") {
    const currentRate = positiveRate(unit.staggerRate);
    const remaining = number(unit.phaseProgress) / currentRate;
    if (duration > remaining) {
      unit.phaseProgress = THRESHOLD;
      unit.staggerRate = newRate;
      pushLog(room, `${unit.characterName}'s STAGGER was replaced by a longer ${duration.toFixed(2)} sec STAGGER.`);
    } else {
      unit.staggerRate = Math.max(0.01, currentRate - 1);
      pushLog(room, `${unit.characterName}'s STAGGER Rate was reduced by 1.`);
    }
    return true;
  }

  const cancelledLabel = unit.currentAction?.label || (room.activeId === unit.id ? "Decision" : "current action");
  const releasedPause = cancelPausedActionFor(room, unit);
  unit.phase = "stagger";
  unit.phaseProgress = THRESHOLD;
  unit.staggerRate = newRate;
  unit.currentAction = null;
  unit.decisionBoost = false;
  unit.commandExpired = false;
  unit.pendingAttackPoise = { heavyStagger: false, poiseBreaker: false };
  pushLog(room, `${unit.characterName} took damage. ${cancelledLabel} was voided; STAGGER ${duration.toFixed(2)} sec.`);
  if (releasedPause) moveToNextOrClock(room);
  return true;
}

function requestStagger(room, unit, rawDuration) {
  if (!unit) return false;
  let duration = clamp(number(rawDuration, 1), 0.1, 3600);
  const source = room.activeAction?.action;
  const matchesTarget = Boolean(source?.targetId && source.targetId === unit.id);
  const poiseBreaker = matchesTarget && source.poiseBreaker;
  if (matchesTarget && source.heavyStagger) duration *= 2;

  if (!poiseBreaker && unit.staggerImmunity) return applyStaggerNow(room, unit, duration);
  const canIgnore = !poiseBreaker && !unit.poiseLocked && unit.stats.composure >= 2 && unit.poiseRemaining >= 1;
  if (canIgnore) {
    room.running = false;
    room.pausedForStagger = true;
    room.pendingStagger = { id: id(), unitId: unit.id, characterName: unit.characterName, duration, poiseBreaker: false };
    pushLog(room, `${unit.characterName} must respond to STAGGER (${duration.toFixed(2)} sec).`);
    return true;
  }
  return applyStaggerNow(room, unit, duration, { poiseBreaker });
}

function resolveStagger(room, unit, choice) {
  const pending = room.pendingStagger;
  if (!pending || !unit || pending.unitId !== unit.id) return false;
  if (choice === "ignore" && unit.stats.composure >= 2 && unit.poiseRemaining >= 1 && !unit.poiseLocked) {
    unit.poiseRemaining -= 1;
    pushLog(room, `${unit.characterName} spent 1 Poise and ignored STAGGER.`);
  } else {
    applyStaggerNow(room, unit, pending.duration, { poiseBreaker: pending.poiseBreaker });
  }
  finishPendingStagger(room);
  return true;
}

function pauseForResolution(room, unit) {
  if (!unit?.currentAction || room.pausedForTurn || room.pausedForResolution || room.pausedForStagger) return;
  room.running = false;
  room.pausedForResolution = true;
  room.activeId = null;
  clearCommand(room);
  unit.phase = "execution";
  unit.phaseProgress = THRESHOLD;
  const target = room.units.find((entry) => entry.id === unit.currentAction.targetId);
  const movingPenalty = unit.currentAction.id === "fire_gun" && target ? movementUnits(target) : 0;
  room.activeAction = {
    id: id(),
    unitId: unit.id,
    characterName: unit.characterName,
    playerName: unit.playerName,
    label: unit.currentAction.label,
    action: clone(unit.currentAction),
    targetId: target?.id || null,
    targetName: target?.characterName || "None/N/A",
    movingTargetPenalty: movingPenalty,
  };
  pushLog(room, `RESOLVE: ${unit.currentAction.label} (${unit.characterName})${movingPenalty ? `; moving target To-Hit ${-movingPenalty}` : ""}.`);
}

function moveToNextOrClock(room) {
  if (room.pausedForStagger || room.pausedForResolution || room.pausedForTurn) return;
  const ready = readyUnits(room)[0];
  if (ready) pauseForDecision(room, ready);
  else if (room.resumeAfterTurn && canStartClock(room) && !room.hardPaused) {
    room.running = true;
    room.lastTick = Date.now();
  } else {
    room.running = false;
    room.lastTick = Date.now();
  }
}

function spendPoise(room, unit, use) {
  if (!unit || unit.poiseLocked || unit.poiseRemaining <= 0) return false;
  const level = unit.stats.composure;
  let releasedPause = false;

  if (use === "snapBack") {
    if (level < 1 || unit.poiseRemaining < 1) return false;
    const cancelled = unit.currentAction?.label || unit.phase.toUpperCase();
    releasedPause = cancelPausedActionFor(room, unit);
    unit.poiseRemaining -= 1;
    unit.phase = "decision";
    unit.phaseProgress = 0;
    unit.staggerRate = null;
    unit.currentAction = null;
    unit.decisionBoost = true;
    unit.poiseLocked = false;
    unit.pendingAttackPoise = { heavyStagger: false, poiseBreaker: false };
    pushLog(room, `${unit.characterName} spent 1 Poise: ${cancelled} voided; DECISION x2.`);
  } else if (use === "staggerImmunity") {
    if (level < 3 || unit.phase === "decision" || unit.phase === "stagger" || unit.poiseRemaining < 1 || unit.staggerImmunity) return false;
    unit.poiseRemaining -= 1;
    unit.staggerImmunity = true;
    pushLog(room, `${unit.characterName} spent 1 Poise: immune to STAGGER until the next Decision fills.`);
  } else if (use === "heavyStagger" || use === "poiseBreaker") {
    const requiredLevel = use === "heavyStagger" ? 4 : 5;
    if (level < requiredLevel || unit.poiseRemaining < 2 || !["decision", "preparation"].includes(unit.phase)) return false;
    if (unit.phase === "preparation") {
      if (!isAttack(unit.currentAction) || unit.currentAction[use]) return false;
      unit.poiseRemaining -= 2;
      unit.currentAction[use] = true;
      if (use === "heavyStagger") unit.currentAction.rates.recovery *= 0.5;
      if (use === "poiseBreaker") unit.currentAction.rates.preparation *= 0.5;
      pushLog(room, `${unit.characterName} spent 2 Poise: ${use === "heavyStagger" ? "double STAGGER / double RECOVERY" : "POISE BREAKER"}.`);
    } else {
      const pending = unit.pendingAttackPoise || { heavyStagger: false, poiseBreaker: false };
      pending[use] = !pending[use];
      const reserved = (pending.heavyStagger ? 2 : 0) + (pending.poiseBreaker ? 2 : 0);
      if (reserved > unit.poiseRemaining) return false;
      unit.pendingAttackPoise = pending;
      pushLog(room, `${unit.characterName} ${pending[use] ? "armed" : "cancelled"} ${use === "heavyStagger" ? "double STAGGER" : "POISE BREAKER"}.`);
    }
  } else if (use === "rapidRecovery") {
    if (level < 6 || unit.poiseRemaining < 3) return false;
    unit.poiseRemaining -= 3;
    unit.recoveryPoiseStacks.push(3);
    pushLog(room, `${unit.characterName} spent 3 Poise: next three Recovery/STAGGER durations halved.`);
  } else {
    return false;
  }
  if (releasedPause) moveToNextOrClock(room);
  return true;
}

function addProgress(room, seconds) {
  const expiredId = room.commandExpired ? room.activeId : null;
  const globalMultiplier = expiredId ? EXPIRED_COMMAND_MULTIPLIER : 1;
  let event = null;

  for (const unit of room.units) {
    if (event) break;
    if (unit.id === expiredId) continue;
    const rate = currentPhaseRate(unit) * globalMultiplier;
    if (!(rate > 0)) continue;

    if (unit.phase === "decision") {
      unit.phaseProgress = Math.min(THRESHOLD, number(unit.phaseProgress) + rate * seconds);
      if (unit.phaseProgress >= THRESHOLD) event = { type: "decision", unit };
    } else if (unit.phase === "preparation") {
      unit.phaseProgress = Math.max(0, number(unit.phaseProgress, THRESHOLD) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        unit.phase = "execution";
        unit.phaseProgress = 0;
        pushLog(room, `${unit.characterName} began EXECUTION: ${unit.currentAction?.label || "Action"}.`);
      }
    } else if (unit.phase === "execution") {
      unit.phaseProgress = Math.min(THRESHOLD, number(unit.phaseProgress) + rate * seconds);
      if (unit.phaseProgress >= THRESHOLD) event = { type: "execution", unit };
    } else if (unit.phase === "recovery") {
      unit.phaseProgress = Math.max(0, number(unit.phaseProgress, THRESHOLD) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        pushLog(room, `${unit.characterName} returned to DECISION.`);
        unit.phase = "decision";
        unit.phaseProgress = 0;
        unit.currentAction = null;
      }
    } else if (unit.phase === "stagger") {
      unit.phaseProgress = Math.max(0, number(unit.phaseProgress, THRESHOLD) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        unit.phase = "decision";
        unit.phaseProgress = 0;
        unit.staggerRate = null;
        unit.currentAction = null;
        unit.poiseLocked = false;
        pushLog(room, `${unit.characterName} recovered from STAGGER and returned to DECISION.`);
      }
    } else if (unit.phase === "dumbfounded") {
      unit.phaseProgress = Math.max(0, number(unit.phaseProgress, THRESHOLD) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        unit.phase = "decision";
        unit.phaseProgress = 0;
        unit.currentAction = null;
        unit.decisionBoost = true;
        pushLog(room, `${unit.characterName} shook off DUMBFOUNDED and gains a boosted DECISION.`);
      }
    }
  }

  if (!event) return;
  if (event.type === "decision") {
    if (expiredId && event.unit.id !== expiredId) interruptExpiredDecision(room);
    pauseForDecision(room, event.unit);
  } else if (event.type === "execution") {
    completeExecutionPoise(room, event.unit);
    if (event.unit.currentAction?.hasResolution) pauseForResolution(room, event.unit);
    else startRecovery(room, event.unit);
  }
}

function advanceSeconds(room, seconds = 1) {
  if (room.pausedForTurn || room.pausedForResolution || room.pausedForStagger || room.hardPaused) return;
  addProgress(room, seconds);
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.hardPaused) continue;
    if (room.pausedForTurn && room.commandDeadline) {
      if (Date.now() >= room.commandDeadline) {
        const unit = room.units.find((entry) => entry.id === room.activeId);
        room.pausedForTurn = false;
        room.running = true;
        room.commandExpired = true;
        room.commandDeadline = null;
        room.lastTick = Date.now();
        if (unit) {
          unit.commandExpired = true;
          pushLog(room, `${unit.characterName}'s Command Window expired.`);
        }
      }
      broadcast(room);
      continue;
    }
    if (!room.running || room.pausedForTurn || room.pausedForResolution || room.pausedForStagger) continue;
    const now = Date.now();
    const elapsed = now - room.lastTick;
    if (elapsed < 80) continue;
    room.lastTick = now;
    advanceSeconds(room, elapsed / 1000);
    broadcast(room);
  }
}, 100);

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);
  if (requested === "/" || requested === "") filePath = path.join(PUBLIC_DIR, "index.html");
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) reject(new Error("Body too large")); });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); } });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function handleCreateRoom(req, res) {
  const room = createRoom();
  sendJson(res, 200, publicState(room));
  broadcast(room);
}

function createUnit(body) {
  const team = normalizeTeam(body.team || (body.controlledBy === "player" ? "pc" : "npc"));
  const stats = normalizeStats(body.stats || body);
  return {
    id: id(),
    playerName: String(body.playerName || "Player").trim().slice(0, 40) || "Player",
    characterName: String(body.characterName || "Character").trim().slice(0, 40) || "Character",
    stats,
    weapon: normalizeWeapon(body.weapon || body),
    commandWindow: normalizeCommandWindow(body.commandWindow, team),
    phase: "decision",
    phaseProgress: 0,
    currentAction: null,
    actionQueue: [],
    decisionBoost: false,
    commandExpired: false,
    staggerRate: null,
    staggerImmunity: false,
    poiseLocked: false,
    poiseMax: stats.composure,
    poiseRemaining: stats.composure,
    pendingAttackPoise: { heavyStagger: false, poiseBreaker: false },
    recoveryPoiseStacks: [],
    cleanExecutionCount: 0,
    totalExecutionCount: 0,
    controlledBy: body.controlledBy || "player",
    team,
    actorType: "character",
    color: normalizeColor(body.color),
    tieSeed: Math.random(),
  };
}

async function handleAction(req, res) {
  let body;
  try { body = await readBody(req); } catch { sendJson(res, 400, { error: "Bad JSON" }); return; }
  const room = getRoom(body.roomCode);
  if (!room) { sendJson(res, 404, { error: "Room not found" }); return; }
  const action = body.action;

  if (action === "undoLastTiming") {
    restoreUndoSnapshot(room); sendJson(res, 200, publicState(room)); broadcast(room); return;
  }
  if (undoableActions.has(action) && !(action === "join" && body.controlledBy === "player")) saveUndoSnapshot(room);

  if (action === "join" || action === "addUnit") {
    const unit = createUnit(body);
    room.units.push(unit);
    pushLog(room, `${unit.characterName} joined (Decision Rate ${unit.stats.intellect + unit.stats.initiative}, Poise ${unit.poiseMax}).`);
  } else if (action === "removeUnit") {
    const unit = room.units.find((entry) => entry.id === body.id);
    room.units = room.units.filter((entry) => entry.id !== body.id);
    if (room.activeId === body.id) { room.activeId = null; room.pausedForTurn = false; clearCommand(room); }
    if (room.activeAction?.unitId === body.id) { room.activeAction = null; room.pausedForResolution = false; }
    if (room.pendingStagger?.unitId === body.id) finishPendingStagger(room);
    if (unit) pushLog(room, `${unit.characterName} removed from combat.`);
    moveToNextOrClock(room);
  } else if (action === "setRunning") {
    if (Boolean(body.running) && canStartClock(room) && !room.hardPaused) {
      room.running = true; room.resumeAfterTurn = true; room.hasEngagedClock = true; room.lastTick = Date.now(); pushLog(room, "Clock started.");
    }
  } else if (action === "setHardPaused") {
    room.hardPaused = Boolean(body.paused); room.lastTick = Date.now(); pushLog(room, room.hardPaused ? "All timers paused." : "All timers resumed.");
    if (!room.hardPaused && room.resumeAfterTurn && canStartClock(room)) room.running = true;
  } else if (action === "toggleClock") {
    if (room.hardPaused) {
      room.hardPaused = false; room.lastTick = Date.now(); if (room.resumeAfterTurn && canStartClock(room)) room.running = true; pushLog(room, "All timers resumed.");
    } else if (room.running || room.pausedForTurn || room.pausedForResolution || room.pausedForStagger) {
      room.hardPaused = true; room.lastTick = Date.now(); pushLog(room, "All timers paused.");
    } else if (canStartClock(room)) {
      room.running = true; room.resumeAfterTurn = true; room.hasEngagedClock = true; room.lastTick = Date.now(); pushLog(room, "Clock started.");
    }
  } else if (action === "setCommandWindow") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) unit.commandWindow = normalizeCommandWindow(body.commandWindow, unit.team);
  } else if (action === "setName") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) unit.characterName = String(body.characterName || unit.characterName).trim().slice(0, 40) || unit.characterName;
  } else if (action === "setColor") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) unit.color = normalizeColor(body.color);
  } else if (action === "chooseAction") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit && room.activeId === unit.id && !room.pausedForResolution) {
      chooseActionInternal(room, unit, actionRequestFromBody(body));
      moveToNextOrClock(room);
    }
  } else if (action === "queueAction") {
    const unit = room.units.find((entry) => entry.id === body.id);
    const request = actionRequestFromBody(body);
    if (unit && unit.controlledBy === "player" && unit.actionQueue.length < 2 && requestIsValid(room, request)) {
      unit.actionQueue.push(request);
      pushLog(room, `${unit.characterName} queued ${ACTIONS[request.actionId].label}.`);
    }
  } else if (action === "removeQueuedAction") {
    const unit = room.units.find((entry) => entry.id === body.id);
    const index = whole(body.index, -1, -1, 1);
    if (unit && index >= 0 && index < unit.actionQueue.length) unit.actionQueue.splice(index, 1);
  } else if (action === "completeResolution") {
    if (room.activeAction) {
      const unit = room.units.find((entry) => entry.id === room.activeAction.unitId);
      const label = room.activeAction.label;
      if (unit) startRecovery(room, unit);
      room.pausedForResolution = false; room.activeAction = null; room.activeId = null; pushLog(room, `Resolved: ${label}.`); moveToNextOrClock(room);
    }
  } else if (action === "applyStagger") {
    requestStagger(room, room.units.find((entry) => entry.id === body.id), body.duration);
  } else if (action === "resolveStagger") {
    resolveStagger(room, room.units.find((entry) => entry.id === body.id), body.choice);
  } else if (action === "spendPoise") {
    spendPoise(room, room.units.find((entry) => entry.id === body.id), body.use);
  } else if (action === "step") {
    if (!room.pausedForTurn && !room.pausedForResolution && !room.pausedForStagger) {
      room.running = false; room.resumeAfterTurn = false; clearCommand(room); advanceSeconds(room, 1); pushLog(room, "GM advanced one second.");
    }
  } else if (action === "reset") {
    for (const unit of room.units) {
      unit.phase = "decision"; unit.phaseProgress = 0; unit.currentAction = null; unit.actionQueue = []; unit.decisionBoost = false; unit.commandExpired = false; unit.staggerRate = null; unit.staggerImmunity = false; unit.poiseLocked = false; unit.poiseMax = unit.stats.composure; unit.poiseRemaining = unit.poiseMax; unit.pendingAttackPoise = { heavyStagger: false, poiseBreaker: false }; unit.recoveryPoiseStacks = []; unit.cleanExecutionCount = 0; unit.totalExecutionCount = 0;
    }
    room.running = false; room.pausedForTurn = false; room.pausedForResolution = false; room.pausedForStagger = false; room.resumeAfterTurn = false; room.hardPaused = false; room.activeId = null; room.activeAction = null; room.pendingStagger = null; room.lastInterruptedId = null; room.lastInterruptedAt = 0; clearCommand(room); room.lastTick = Date.now(); pushLog(room, "Encounter reset.");
  } else if (action === "clearEncounter") {
    room.units = []; room.running = false; room.pausedForTurn = false; room.pausedForResolution = false; room.pausedForStagger = false; room.resumeAfterTurn = false; room.hardPaused = false; room.activeId = null; room.activeAction = null; room.pendingStagger = null; clearCommand(room); room.lastTick = Date.now(); pushLog(room, "Encounter cleared.");
  } else if (action === "nudge") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit && !room.pausedForTurn && !room.pausedForResolution && !room.pausedForStagger) {
      const direction = phaseDirection(unit.phase);
      const amount = Math.max(1, number(body.amount, 1));
      unit.phaseProgress = direction === "down" ? Math.max(0, unit.phaseProgress - amount) : Math.min(THRESHOLD, unit.phaseProgress + amount);
      if (unit.phase === "decision" && unit.phaseProgress >= THRESHOLD) pauseForDecision(room, unit);
    }
  }

  sendJson(res, 200, publicState(room));
  broadcast(room);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/favicon.ico" && req.method === "GET") { res.writeHead(204, { "Cache-Control": "public, max-age=86400" }); res.end(); return; }
  if (url.pathname === "/ping" && req.method === "GET") { res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end("Vector ATB server is reachable."); return; }
  if (url.pathname === "/healthz" && req.method === "GET") { sendJson(res, 200, { ok: true }); return; }
  if (url.pathname === "/api/create-room" && req.method === "POST") { handleCreateRoom(req, res); return; }
  if (url.pathname === "/api/action" && req.method === "POST") { handleAction(req, res); return; }
  if (url.pathname === "/api/state" && req.method === "GET") {
    const room = getRoom(url.searchParams.get("room"));
    if (!room) { sendJson(res, 404, { error: "Room not found" }); return; }
    sendJson(res, 200, publicState(room)); return;
  }
  if (url.pathname === "/api/keep-alive" && req.method === "POST") {
    const room = getRoom(url.searchParams.get("room"));
    if (!room) { sendJson(res, 404, { error: "Room not found" }); return; }
    room.lastKeepAliveAt = Date.now(); sendJson(res, 200, publicState(room)); return;
  }
  if (url.pathname === "/events") {
    const room = getRoom(url.searchParams.get("room"));
    if (!room) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("retry: 1500\n\n");
    clients.get(room.roomCode).add(res);
    sendEvent(res, "state", publicState(room));
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), HEARTBEAT_MS);
    req.on("close", () => { clearInterval(heartbeat); clients.get(room.roomCode)?.delete(res); });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const addresses = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && entry.family === "IPv4" && !entry.internal).map((entry) => `http://${entry.address}:${PORT}`);
  console.log(`Vector ATB listening on http://localhost:${PORT}`);
  for (const address of addresses) console.log(`LAN: ${address}`);
});
