const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const HOST = "0.0.0.0";
const PUBLIC_DIR = __dirname;
const HEARTBEAT_MS = 25000;
const THRESHOLD = 100;
const DEFAULT_BASELINE = 7;
const DEFAULT_COMMAND_WINDOW = 20;
const DUMBFOUNDED_SPEED = 20;
const EXPIRED_COMMAND_MULTIPLIER = 0.2;
const PREPARATION_BASE_MULTIPLIER = 3.2;
const EXECUTION_BASE_MULTIPLIER = 4;
const RECOVERY_BASE_MULTIPLIER = 2.5;
const DEFAULT_POISE = 3;

const rooms = new Map();
const clients = new Map();
let stateSequence = 0;

const TEST_ACTIONS = {
  move: {
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
  use_item: {
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
  defense: {
    id: "defense",
    label: "Defense",
    speed: { preparation: 1, execution: 0, recovery: 1 },
    risk: { preparation: -3, execution: -5, recovery: -3 },
    hitBonus: null,
    damage: "",
    critical: "",
    damageType: "",
    hasResolution: false,
    notes: "Negative risk improves defense. Critical defense may become a counterattack later.",
  },
  melee_attack: {
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
  fire_gun: {
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
  close_quarter: {
    id: "close_quarter",
    label: "Close Quarter Action",
    speed: { preparation: -1, execution: 0, recovery: -1 },
    risk: { preparation: 2, execution: 3, recovery: 3 },
    hitBonus: 1,
    damage: "2d6 / effect",
    critical: "GM call",
    damageType: "blunt/control",
    hasResolution: true,
    notes: "Wrestle, tackle, disarm, restrain, or similar close action.",
  },
  reload_ready: {
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
  improvised: {
    id: "improvised",
    label: "Improvised Action",
    speed: { preparation: 0, execution: 0, recovery: 0 },
    risk: { preparation: 0, execution: 0, recovery: 0 },
    hitBonus: null,
    damage: "GM call",
    critical: "GM call",
    damageType: "GM call",
    hasResolution: true,
    notes: "Fallback action. GM may override values from the interface later.",
  },
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
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#39e58f";
}

function normalizeTeam(value) {
  return value === "pc" ? "pc" : "npc";
}

function normalizeBaseline(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_BASELINE;
  return clamp(Number(value) || DEFAULT_BASELINE, 1, 30);
}

function normalizeCommandWindow(value, team = "pc") {
  if (team !== "pc") return null;
  if (value === null || value === undefined || value === "") return DEFAULT_COMMAND_WINDOW;
  return clamp(Math.round(Number(value) || DEFAULT_COMMAND_WINDOW), 1, 999);
}

function normalizeStep(value, min = -4, max = 4) {
  return clamp(Math.round(Number(value) || 0), min, max);
}

function normalizeRisk(value) {
  return normalizeStep(value, -5, 5);
}

function normalizeActionTemplate(template) {
  const action = clone(template || TEST_ACTIONS.improvised);
  action.id = String(action.id || "improvised").trim().slice(0, 40) || "improvised";
  action.label = String(action.label || "Improvised Action").trim().slice(0, 80) || "Improvised Action";
  action.speed = {
    preparation: normalizeStep(action.speed?.preparation),
    execution: normalizeStep(action.speed?.execution),
    recovery: normalizeStep(action.speed?.recovery),
  };
  action.risk = {
    preparation: normalizeRisk(action.risk?.preparation),
    execution: normalizeRisk(action.risk?.execution),
    recovery: normalizeRisk(action.risk?.recovery),
  };
  action.hitBonus = action.hitBonus === null || action.hitBonus === undefined || action.hitBonus === ""
    ? null
    : clamp(Math.round(Number(action.hitBonus) || 0), -99, 99);
  action.damage = String(action.damage || "").trim().slice(0, 80);
  action.critical = String(action.critical || "").trim().slice(0, 40);
  action.damageType = String(action.damageType || "").trim().slice(0, 40);
  action.hasResolution = Boolean(action.hasResolution);
  action.notes = String(action.notes || "").trim().slice(0, 160);
  return action;
}

function actionFromBody(body) {
  if (body.customAction) return normalizeActionTemplate({ ...TEST_ACTIONS.improvised, ...body.customAction, id: "improvised" });
  return normalizeActionTemplate(TEST_ACTIONS[body.actionId] || TEST_ACTIONS.improvised);
}

function stepRate(base, step) {
  const count = Math.min(4, Math.abs(Number(step) || 0));
  if (!count) return clamp(base, 0.1, 60);
  const positive = step > 0;
  let flat = 0;
  let percent = 0;
  const steps = positive
    ? [{ flat: 2, percent: 0 }, { flat: 3, percent: 0 }, { flat: 0, percent: 0.16 }, { flat: 0, percent: 0.33 }]
    : [{ flat: -2, percent: 0 }, { flat: -3, percent: 0 }, { flat: 0, percent: -0.16 }, { flat: 0, percent: -0.33 }];
  for (const modifier of steps.slice(0, count)) {
    flat += modifier.flat;
    percent += modifier.percent;
  }
  const withFlat = Math.max(1, base + flat);
  return clamp(Math.ceil(Math.max(0.1, withFlat * (1 + percent)) * 10) / 10, 0.1, 60);
}

function currentPhaseRate(unit) {
  const base = normalizeBaseline(unit?.baseline);
  if (!unit) return 0;
  if (unit.phase === "decision") return unit.decisionBoost ? base * 2 : base;
  if (unit.phase === "dumbfounded") return DUMBFOUNDED_SPEED;
  if (unit.phase === "stagger") return clamp(Number(unit.staggerRate) || 1, 1, 200);
  if (!unit.currentAction) return base;
  if (unit.phase === "preparation") return stepRate(base * PREPARATION_BASE_MULTIPLIER, unit.currentAction.speed.preparation);
  if (unit.phase === "execution") return stepRate(base * EXECUTION_BASE_MULTIPLIER, unit.currentAction.speed.execution);
  if (unit.phase === "recovery") {
    const rate = stepRate(base * RECOVERY_BASE_MULTIPLIER, unit.currentAction.speed.recovery);
    return unit.currentAction.overcommitted ? Math.max(0.1, rate * 0.5) : rate;
  }
  return 0;
}

function currentRisk(unit) {
  if (!unit?.currentAction) return 0;
  if (unit.phase === "preparation") return unit.currentAction.risk.preparation;
  if (unit.phase === "execution" || unit.phase === "resolution") return unit.currentAction.risk.execution;
  if (unit.phase === "recovery") return unit.currentAction.risk.recovery;
  return 0;
}

function phaseDirection(phase) {
  if (phase === "decision" || phase === "execution") return "up";
  if (phase === "preparation" || phase === "recovery" || phase === "dumbfounded" || phase === "stagger") return "down";
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
    resumeAfterTurn: false,
    hardPaused: false,
    activeId: null,
    activeAction: null,
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
  const remaining = room.commandExpired || !room.commandDeadline
    ? 0
    : Math.max(0, (room.commandDeadline - Date.now()) / 1000);
  return {
    unitId: room.activeId,
    total: room.commandTotal,
    remaining,
    expired: room.commandExpired,
  };
}

function publicState(room) {
  return {
    revision: ++stateSequence,
    roomCode: room.roomCode,
    running: room.running,
    pausedForTurn: room.pausedForTurn,
    pausedForResolution: room.pausedForResolution,
    activeId: room.activeId,
    activeAction: room.activeAction,
    command: commandState(room),
    commandExpired: room.commandExpired,
    hardPaused: room.hardPaused,
    hasEngagedClock: room.hasEngagedClock,
    lastInterruptedId: room.lastInterruptedId,
    lastInterruptedAt: room.lastInterruptedAt,
    lastKeepAliveAt: room.lastKeepAliveAt,
    threshold: room.threshold,
    actions: Object.values(TEST_ACTIONS),
    units: room.units.map((unit) => ({
      ...unit,
      phaseRate: currentPhaseRate(unit),
      phaseDirection: phaseDirection(unit.phase),
      currentRisk: currentRisk(unit),
    })),
    log: room.log.slice(-30),
    undoAvailable: Boolean(room.undoSnapshot),
  };
}

function pushLog(room, text) {
  room.log.push({ id: id(), at: new Date().toLocaleTimeString(), text });
  room.log = room.log.slice(-80);
}

function snapshotRoom(room) {
  return {
    running: room.running,
    pausedForTurn: room.pausedForTurn,
    pausedForResolution: room.pausedForResolution,
    resumeAfterTurn: room.resumeAfterTurn,
    hardPaused: room.hardPaused,
    activeId: room.activeId,
    activeAction: clone(room.activeAction),
    commandRemaining: room.commandDeadline ? Math.max(0, (room.commandDeadline - Date.now()) / 1000) : null,
    commandTotal: room.commandTotal,
    commandExpired: room.commandExpired,
    lastInterruptedId: room.lastInterruptedId,
    lastInterruptedAt: room.lastInterruptedAt,
    hasEngagedClock: room.hasEngagedClock,
    threshold: room.threshold,
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
  room.running = snap.running;
  room.pausedForTurn = snap.pausedForTurn;
  room.pausedForResolution = snap.pausedForResolution;
  room.resumeAfterTurn = snap.resumeAfterTurn;
  room.hardPaused = snap.hardPaused;
  room.activeId = snap.activeId;
  room.activeAction = clone(snap.activeAction);
  room.commandDeadline = snap.commandRemaining === null ? null : Date.now() + snap.commandRemaining * 1000;
  room.commandTotal = snap.commandTotal;
  room.commandExpired = snap.commandExpired;
  room.lastInterruptedId = snap.lastInterruptedId;
  room.lastInterruptedAt = snap.lastInterruptedAt;
  room.hasEngagedClock = snap.hasEngagedClock;
  room.threshold = snap.threshold;
  room.units = clone(snap.units);
  room.log = clone(snap.log);
  room.undoSnapshot = null;
  pushLog(room, "Undid last timing change.");
  return true;
}

const undoableActions = new Set([
  "join",
  "addUnit",
  "removeUnit",
  "setRunning",
  "setHardPaused",
  "toggleClock",
  "setSpeed",
  "setCommandWindow",
  "setName",
  "setColor",
  "chooseAction",
  "completeResolution",
  "applyStagger",
  "spendPoise",
  "step",
  "reset",
  "clearEncounter",
  "nudge",
]);

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room) {
  const data = publicState(room);
  for (const res of clients.get(room.roomCode) || []) sendEvent(res, "state", data);
}

function canStartClock(room) {
  return room.units.length > 0 && !room.pausedForTurn && !room.pausedForResolution;
}

function clearCommand(room) {
  room.commandDeadline = null;
  room.commandTotal = 0;
  room.commandExpired = false;
}

function tieCompare(a, b) {
  if (a.team !== b.team) return a.team === "pc" ? -1 : 1;
  if ((a.baseline || 0) !== (b.baseline || 0)) return (b.baseline || 0) - (a.baseline || 0);
  return a.tieSeed - b.tieSeed;
}

function readyUnits(room, excludeId = null) {
  return room.units
    .filter((unit) => unit.id !== excludeId && unit.phase === "decision" && unit.phaseProgress >= room.threshold)
    .sort((a, b) => tieCompare(a, b));
}

function pauseForDecision(room, unit) {
  if (!unit || room.pausedForTurn || room.pausedForResolution) return;
  room.running = false;
  room.pausedForTurn = true;
  room.activeId = unit.id;
  room.activeAction = null;
  unit.phase = "decision";
  unit.phaseProgress = room.threshold;
  unit.staggerRate = null;
  unit.commandExpired = false;
  if (unit.braceActive) {
    unit.braceActive = false;
    pushLog(room, `${unit.characterName}'s Brace ended at DECISION.`);
  }
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
  unit.phaseProgress = room.threshold;
  unit.currentAction = null;
  unit.commandExpired = false;
  unit.decisionBoost = false;
  room.lastInterruptedId = unit.id;
  room.lastInterruptedAt = Date.now();
  room.activeId = null;
  clearCommand(room);
  pushLog(room, `${unit.characterName} is DUMBFOUNDED!`);
  return true;
}

function startRecovery(room, unit) {
  if (!unit) return;
  unit.phase = "recovery";
  unit.phaseProgress = room.threshold;
  const overcommit = unit.currentAction?.overcommitted ? " (Overcommit: half speed)" : "";
  pushLog(room, `${unit.characterName} entered RECOVERY: ${unit.currentAction?.label || "Action"}${overcommit}.`);
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

function applyStagger(room, unit, duration) {
  if (!unit) return false;
  const seconds = clamp(Number(duration) || 1, 0.5, 120);
  if (unit.braceActive) {
    pushLog(room, `${unit.characterName}'s Brace ignored a ${seconds.toFixed(1)} sec STAGGER.`);
    return true;
  }

  const newRate = room.threshold / seconds;
  if (unit.phase === "stagger") {
    const currentRate = clamp(Number(unit.staggerRate) || 1, 1, 200);
    const remaining = (Number(unit.phaseProgress) || 0) / currentRate;
    if (seconds > remaining) {
      unit.phaseProgress = room.threshold;
      unit.staggerRate = newRate;
      pushLog(room, `${unit.characterName}'s STAGGER was replaced by a longer ${seconds.toFixed(1)} sec STAGGER.`);
    } else {
      unit.staggerRate = Math.max(1, currentRate - 1);
      pushLog(room, `${unit.characterName}'s STAGGER speed was reduced by 1.`);
    }
    return true;
  }

  const cancelledLabel = unit.currentAction?.label || (room.activeId === unit.id ? "Decision" : "current action");
  const releasedPause = cancelPausedActionFor(room, unit);
  unit.phase = "stagger";
  unit.phaseProgress = room.threshold;
  unit.staggerRate = newRate;
  unit.currentAction = null;
  unit.decisionBoost = false;
  unit.commandExpired = false;
  pushLog(room, `${unit.characterName} took damage. ${cancelledLabel} was voided; STAGGER ${seconds.toFixed(1)} sec.`);
  if (releasedPause) moveToNextOrClock(room);
  return true;
}

function spendPoise(room, unit, use) {
  if (!unit) return false;
  const tracksPoise = unit.team === "pc";
  if (tracksPoise && (Number(unit.poiseRemaining) || 0) <= 0) return false;
  let releasedPause = false;
  let outcome = "";

  if (use === "brace") {
    if (unit.braceActive) return false;
    unit.braceActive = true;
  } else if (use === "snapBack") {
    const cancelledLabel = room.activeAction?.unitId === unit.id
      ? room.activeAction.label
      : unit.currentAction?.label || String(unit.phase || "current state").toUpperCase();
    releasedPause = cancelPausedActionFor(room, unit);
    unit.phase = "decision";
    unit.phaseProgress = 0;
    unit.staggerRate = null;
    unit.currentAction = null;
    unit.decisionBoost = true;
    unit.commandExpired = false;
    outcome = ` ${cancelledLabel} was voided; DECISION x2.`;
  } else if (use === "overcommit") {
    if (room.activeAction?.unitId !== unit.id || !unit.currentAction || unit.currentAction.overcommitted) return false;
    unit.currentAction.overcommitted = true;
    room.activeAction.overcommitted = true;
    room.activeAction.action.overcommitted = true;
  } else {
    return false;
  }

  if (tracksPoise) unit.poiseRemaining -= 1;
  const labels = { brace: "BRACE", snapBack: "SNAP BACK", overcommit: "OVERCOMMIT" };
  const remaining = tracksPoise ? ` (${unit.poiseRemaining} Poise remaining)` : "";
  pushLog(room, `${unit.characterName} spent Poise: ${labels[use]}${remaining}.${outcome}`);
  if (releasedPause) moveToNextOrClock(room);
  return true;
}

function pauseForResolution(room, unit) {
  if (!unit?.currentAction || room.pausedForTurn || room.pausedForResolution) return;
  room.running = false;
  room.pausedForResolution = true;
  room.activeId = null;
  clearCommand(room);
  unit.phase = "execution";
  unit.phaseProgress = room.threshold;
  room.activeAction = {
    id: id(),
    unitId: unit.id,
    characterName: unit.characterName,
    playerName: unit.playerName,
    label: unit.currentAction.label,
    action: clone(unit.currentAction),
  };
  pushLog(room, `RESOLVE: ${unit.currentAction.label} (${unit.characterName}).`);
}

function moveToNextOrClock(room) {
  const ready = readyUnits(room)[0];
  if (ready) {
    pauseForDecision(room, ready);
  } else if (room.resumeAfterTurn && canStartClock(room) && !room.hardPaused) {
    room.running = true;
    room.lastTick = Date.now();
  } else {
    room.running = false;
    room.lastTick = Date.now();
  }
}

function chooseAction(room, unit, actionTemplate) {
  if (!unit || room.activeId !== unit.id || room.pausedForResolution) return false;
  const action = normalizeActionTemplate(actionTemplate);
  unit.currentAction = action;
  unit.phase = "preparation";
  unit.phaseProgress = room.threshold;
  unit.commandExpired = false;
  if (unit.decisionBoost) unit.decisionBoost = false;
  room.pausedForTurn = false;
  room.activeId = null;
  clearCommand(room);
  pushLog(room, `${unit.characterName} chose ${action.label}.`);
  moveToNextOrClock(room);
  return true;
}

function addProgress(room, seconds, { exact = false } = {}) {
  const expiredId = room.commandExpired ? room.activeId : null;
  const multiplier = expiredId ? EXPIRED_COMMAND_MULTIPLIER : 1;
  let event = null;

  for (const unit of room.units) {
    if (event) break;
    if (unit.id === expiredId) continue;
    const rate = currentPhaseRate(unit) * multiplier;
    if (!rate) continue;

    if (unit.phase === "decision") {
      unit.phaseProgress = Math.min(room.threshold, (Number(unit.phaseProgress) || 0) + rate * seconds);
      if (unit.phaseProgress >= room.threshold) event = { type: "decision", unit };
      continue;
    }

    if (unit.phase === "preparation") {
      unit.phaseProgress = Math.max(0, (Number(unit.phaseProgress) || room.threshold) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        unit.phase = "execution";
        unit.phaseProgress = 0;
        pushLog(room, `${unit.characterName} began EXECUTION: ${unit.currentAction?.label || "Action"}.`);
      }
      continue;
    }

    if (unit.phase === "execution") {
      unit.phaseProgress = Math.min(room.threshold, (Number(unit.phaseProgress) || 0) + rate * seconds);
      if (unit.phaseProgress >= room.threshold) event = { type: "execution", unit };
      continue;
    }

    if (unit.phase === "recovery") {
      unit.phaseProgress = Math.max(0, (Number(unit.phaseProgress) || room.threshold) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        pushLog(room, `${unit.characterName} returned to DECISION.`);
        unit.phase = "decision";
        unit.phaseProgress = 0;
        unit.currentAction = null;
      }
      continue;
    }

    if (unit.phase === "stagger") {
      unit.phaseProgress = Math.max(0, (Number(unit.phaseProgress) || room.threshold) - rate * seconds);
      if (unit.phaseProgress <= 0) {
        unit.phase = "decision";
        unit.phaseProgress = 0;
        unit.staggerRate = null;
        unit.currentAction = null;
        pushLog(room, `${unit.characterName} recovered from STAGGER and returned to DECISION.`);
      }
      continue;
    }

    if (unit.phase === "dumbfounded") {
      unit.phaseProgress = Math.max(0, (Number(unit.phaseProgress) || room.threshold) - rate * seconds);
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
    return;
  }
  if (event.type === "execution") {
    if (event.unit.currentAction?.hasResolution) {
      pauseForResolution(room, event.unit);
    } else {
      startRecovery(room, event.unit);
    }
  }
}

function advanceSeconds(room, seconds = 1) {
  if (room.pausedForTurn || room.pausedForResolution || room.hardPaused) return;
  addProgress(room, seconds, { exact: true });
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
    if (!room.running || room.pausedForTurn || room.pausedForResolution || room.hardPaused) continue;
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
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".mp4": "video/mp4",
    ".svg": "image/svg+xml",
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = decodeURIComponent(url.pathname);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);
  if (requested === "/" || requested === "") filePath = path.join(PUBLIC_DIR, "index.html");
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
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

async function handleAction(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Bad JSON" });
    return;
  }

  const room = getRoom(body.roomCode);
  if (!room) {
    sendJson(res, 404, { error: "Room not found" });
    return;
  }

  const action = body.action;
  if (action === "undoLastTiming") {
    restoreUndoSnapshot(room);
    sendJson(res, 200, publicState(room));
    broadcast(room);
    return;
  }

  if (undoableActions.has(action) && !(action === "join" && body.controlledBy === "player")) saveUndoSnapshot(room);

  if (action === "join" || action === "addUnit") {
    const team = normalizeTeam(body.team || (body.controlledBy === "player" ? "pc" : "npc"));
    const unit = {
      id: id(),
      playerName: String(body.playerName || "Player").trim().slice(0, 40) || "Player",
      characterName: String(body.characterName || "Character").trim().slice(0, 40) || "Character",
      baseline: normalizeBaseline(body.baseline ?? body.speed),
      commandWindow: normalizeCommandWindow(body.commandWindow, team),
      phase: "decision",
      phaseProgress: 0,
      currentAction: null,
      decisionBoost: false,
      commandExpired: false,
      staggerRate: null,
      braceActive: false,
      poiseRemaining: team === "pc" ? DEFAULT_POISE : null,
      controlledBy: body.controlledBy || "player",
      team,
      actorType: "character",
      color: normalizeColor(body.color),
      tieSeed: Math.random(),
    };
    room.units.push(unit);
    pushLog(room, `${unit.characterName} joined (Base ${unit.baseline}).`);
  }

  if (action === "removeUnit") {
    const unit = room.units.find((entry) => entry.id === body.id);
    room.units = room.units.filter((entry) => entry.id !== body.id);
    if (room.activeId === body.id) {
      room.activeId = null;
      room.pausedForTurn = false;
      clearCommand(room);
      moveToNextOrClock(room);
    }
    if (room.activeAction?.unitId === body.id) {
      room.activeAction = null;
      room.pausedForResolution = false;
      moveToNextOrClock(room);
    }
    if (unit) pushLog(room, `${unit.characterName} removed from combat.`);
  }

  if (action === "setRunning") {
    if (Boolean(body.running) && !room.pausedForTurn && !room.pausedForResolution && !room.hardPaused) {
      if (!canStartClock(room)) {
        pushLog(room, "Clock cannot start until at least one participant is ready.");
      } else {
        room.running = true;
        room.resumeAfterTurn = true;
        room.hasEngagedClock = true;
        room.lastTick = Date.now();
        pushLog(room, "Clock started.");
      }
    }
  }

  if (action === "setHardPaused") {
    room.hardPaused = Boolean(body.paused);
    room.lastTick = Date.now();
    pushLog(room, room.hardPaused ? "All timers paused." : "All timers resumed.");
    if (!room.hardPaused && room.resumeAfterTurn && !room.pausedForTurn && !room.pausedForResolution) {
      room.running = true;
      room.lastTick = Date.now();
    }
  }

  if (action === "toggleClock") {
    if (room.hardPaused) {
      room.hardPaused = false;
      room.lastTick = Date.now();
      if (room.resumeAfterTurn && !room.pausedForTurn && !room.pausedForResolution) room.running = true;
      pushLog(room, "All timers resumed.");
    } else if (room.running || room.pausedForTurn || room.pausedForResolution) {
      room.hardPaused = true;
      room.lastTick = Date.now();
      pushLog(room, "All timers paused.");
    } else if (canStartClock(room)) {
      room.running = true;
      room.resumeAfterTurn = true;
      room.hasEngagedClock = true;
      room.lastTick = Date.now();
      pushLog(room, "Clock started.");
    } else {
      pushLog(room, "Add a participant before starting the clock.");
    }
  }

  if (action === "setSpeed") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) {
      const oldBaseline = unit.baseline;
      unit.baseline = normalizeBaseline(body.baseline ?? body.speed);
      pushLog(room, `${unit.characterName}'s Base changed from ${oldBaseline} to ${unit.baseline}.`);
    }
  }

  if (action === "setCommandWindow") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) {
      const oldWindow = unit.commandWindow;
      unit.commandWindow = normalizeCommandWindow(body.commandWindow, unit.team);
      pushLog(room, `${unit.characterName}'s Command Window changed from ${oldWindow || "unset"} to ${unit.commandWindow || "none"}.`);
    }
  }

  if (action === "setName") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) {
      const oldName = unit.characterName;
      unit.characterName = String(body.characterName || unit.characterName).trim().slice(0, 40) || unit.characterName;
      pushLog(room, `${oldName} renamed to ${unit.characterName}.`);
    }
  }

  if (action === "setColor") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) {
      unit.color = normalizeColor(body.color);
      pushLog(room, `${unit.characterName}'s ATB color changed.`);
    }
  }

  if (action === "chooseAction") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) chooseAction(room, unit, actionFromBody(body));
  }

  if (action === "completeResolution") {
    if (room.activeAction) {
      const unit = room.units.find((entry) => entry.id === room.activeAction.unitId);
      const label = room.activeAction.label;
      if (unit) startRecovery(room, unit);
      room.pausedForResolution = false;
      room.activeAction = null;
      room.activeId = null;
      pushLog(room, `Resolved: ${label}.`);
      moveToNextOrClock(room);
    }
  }

  if (action === "applyStagger") {
    const unit = room.units.find((entry) => entry.id === body.id);
    applyStagger(room, unit, body.duration);
  }

  if (action === "spendPoise") {
    const unit = room.units.find((entry) => entry.id === body.id);
    spendPoise(room, unit, body.use);
  }

  if (action === "step") {
    if (room.pausedForTurn || room.pausedForResolution) {
      pushLog(room, "Resolve the active decision/resolution before stepping the clock.");
      sendJson(res, 200, publicState(room));
      broadcast(room);
      return;
    }
    room.running = false;
    room.resumeAfterTurn = false;
    clearCommand(room);
    advanceSeconds(room, 1);
    pushLog(room, "GM advanced one second.");
  }

  if (action === "reset") {
    for (const unit of room.units) {
      unit.phase = "decision";
      unit.phaseProgress = 0;
      unit.currentAction = null;
      unit.decisionBoost = false;
      unit.commandExpired = false;
      unit.staggerRate = null;
      unit.braceActive = false;
      unit.poiseRemaining = unit.team === "pc" ? DEFAULT_POISE : null;
    }
    room.running = false;
    room.pausedForTurn = false;
    room.pausedForResolution = false;
    room.resumeAfterTurn = false;
    room.hardPaused = false;
    room.activeId = null;
    room.activeAction = null;
    room.lastInterruptedId = null;
    room.lastInterruptedAt = 0;
    clearCommand(room);
    room.lastTick = Date.now();
    pushLog(room, "Encounter reset.");
  }

  if (action === "clearEncounter") {
    room.units = [];
    room.running = false;
    room.pausedForTurn = false;
    room.pausedForResolution = false;
    room.resumeAfterTurn = false;
    room.hardPaused = false;
    room.activeId = null;
    room.activeAction = null;
    room.lastInterruptedId = null;
    room.lastInterruptedAt = 0;
    clearCommand(room);
    room.lastTick = Date.now();
    pushLog(room, "Encounter cleared.");
  }

  if (action === "nudge") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit && !room.pausedForTurn && !room.pausedForResolution) {
      unit.phaseProgress = Math.min(room.threshold, (Number(unit.phaseProgress) || 0) + Math.max(1, Number(body.amount) || 1));
      if (unit.phase === "decision" && unit.phaseProgress >= room.threshold) {
        if (room.commandExpired && room.activeId) interruptExpiredDecision(room);
        pauseForDecision(room, unit);
      }
    }
  }

  sendJson(res, 200, publicState(room));
  broadcast(room);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/ping" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Vector ATB server is reachable.");
    return;
  }

  if (url.pathname === "/api/create-room" && req.method === "POST") {
    handleCreateRoom(req, res);
    return;
  }

  if (url.pathname === "/api/action" && req.method === "POST") {
    handleAction(req, res);
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const room = getRoom(url.searchParams.get("room"));
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return;
    }
    sendJson(res, 200, publicState(room));
    return;
  }

  if (url.pathname === "/api/keep-alive" && req.method === "POST") {
    const room = getRoom(url.searchParams.get("room"));
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return;
    }
    room.lastKeepAliveAt = Date.now();
    sendJson(res, 200, publicState(room));
    return;
  }

  if (url.pathname === "/events") {
    const room = getRoom(url.searchParams.get("room"));
    if (!room) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Room not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const roomClients = clients.get(room.roomCode) || new Set();
    clients.set(room.roomCode, roomClients);
    roomClients.add(res);
    const heartbeat = setInterval(() => {
      res.write(`: keep-alive ${Date.now()}\n\n`);
    }, HEARTBEAT_MS);
    sendEvent(res, "state", publicState(room));
    req.on("close", () => {
      clearInterval(heartbeat);
      roomClients.delete(res);
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  console.log("Vector ATB multiplayer running");
  console.log(`Local:   http://127.0.0.1:${PORT}`);
  for (const address of addresses) console.log(`Phone:   http://${address}:${PORT}`);
});
