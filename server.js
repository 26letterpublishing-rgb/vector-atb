const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const HOST = "0.0.0.0";
const PUBLIC_DIR = __dirname;

const rooms = new Map();
const clients = new Map();
let stateSequence = 0;
const HEARTBEAT_MS = 25000;

function id() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function createRoom() {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = {
    roomCode: code,
    running: false,
    pausedForTurn: false,
    resumeAfterTurn: false,
    activeId: null,
    activeAction: null,
    activeSource: null,
    commandDeadline: null,
    commandTotal: 0,
    commandExpired: false,
    hardPaused: false,
    holdPaused: false,
    holdStartedAt: null,
    commandHeldRemaining: null,
    lastInterruptedId: null,
    lastInterruptedAt: 0,
    lastKeepAliveAt: Date.now(),
    lastTick: Date.now(),
    delayRequest: null,
    hasEngagedClock: false,
    threshold: 100,
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

function publicState(room) {
  migrateRoomDelays(room);
  const command = commandState(room);
  return {
    revision: ++stateSequence,
    roomCode: room.roomCode,
    running: room.running,
    pausedForTurn: room.pausedForTurn,
    activeId: room.activeId,
    activeAction: room.activeAction,
    activeSource: room.activeSource,
    command,
    hardPaused: room.hardPaused,
    holdPaused: room.holdPaused,
    delayRequest: room.delayRequest,
    hasEngagedClock: room.hasEngagedClock,
    lastInterruptedId: room.lastInterruptedId,
    lastInterruptedAt: room.lastInterruptedAt,
    lastKeepAliveAt: room.lastKeepAliveAt,
    threshold: room.threshold,
    units: room.units,
    log: room.log.slice(-30),
    undoAvailable: Boolean(room.undoSnapshot),
  };
}

function pushLog(room, text) {
  room.log.push({ id: id(), at: new Date().toLocaleTimeString(), text });
  room.log = room.log.slice(-80);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotRoom(room) {
  return {
    running: room.running,
    pausedForTurn: room.pausedForTurn,
    resumeAfterTurn: room.resumeAfterTurn,
    activeId: room.activeId,
    activeAction: clone(room.activeAction),
    activeSource: room.activeSource,
    commandRemaining: room.commandDeadline ? Math.max(0, (room.commandDeadline - Date.now()) / 1000) : null,
    commandTotal: room.commandTotal,
    commandExpired: room.commandExpired,
    hardPaused: room.hardPaused,
    holdPaused: room.holdPaused,
    holdStartedAt: room.holdStartedAt,
    commandHeldRemaining: room.commandHeldRemaining,
    lastInterruptedId: room.lastInterruptedId,
    lastInterruptedAt: room.lastInterruptedAt,
    delayRequest: clone(room.delayRequest),
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
  const snapshot = room.undoSnapshot;
  room.running = snapshot.running;
  room.pausedForTurn = snapshot.pausedForTurn;
  room.resumeAfterTurn = snapshot.resumeAfterTurn;
  room.activeId = snapshot.activeId;
  room.activeAction = clone(snapshot.activeAction);
  room.activeSource = snapshot.activeSource;
  room.commandDeadline = snapshot.commandRemaining === null ? null : Date.now() + snapshot.commandRemaining * 1000;
  room.commandTotal = snapshot.commandTotal;
  room.commandExpired = snapshot.commandExpired;
  room.hardPaused = snapshot.hardPaused;
  room.holdPaused = snapshot.holdPaused;
  room.holdStartedAt = snapshot.holdStartedAt;
  room.commandHeldRemaining = snapshot.commandHeldRemaining;
  room.lastInterruptedId = snapshot.lastInterruptedId;
  room.lastInterruptedAt = snapshot.lastInterruptedAt;
  room.delayRequest = clone(snapshot.delayRequest);
  room.hasEngagedClock = snapshot.hasEngagedClock;
  room.threshold = snapshot.threshold;
  room.units = clone(snapshot.units);
  room.log = clone(snapshot.log);
  room.undoSnapshot = null;
  room.lastTick = Date.now();
  pushLog(room, "GM undid the last timing change.");
  return true;
}

const undoableActions = new Set([
  "addUnit",
  "removeUnit",
  "setRunning",
  "setHardPaused",
  "toggleClock",
  "setSpeed",
  "setCommandWindow",
  "requestDelay",
  "cancelDelayRequest",
  "startDelay",
  "updateDelay",
  "instantDelay",
  "impairQueuedEffect",
  "removeQueuedEffect",
  "step",
  "reset",
  "clearEncounter",
  "completeTurn",
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

function normalizeSpeed(value) {
  if (value === null || value === undefined || value === "") return null;
  return Math.max(1, Math.min(100, Number(value) || 1));
}

function normalizeCommandWindow(value) {
  if (value === null || value === undefined || value === "") return null;
  return Math.max(1, Math.min(999, Math.round(Number(value) || 1)));
}

function normalizeDelayRate(value) {
  if (value === null || value === undefined || value === "") return null;
  return Math.max(0.1, Math.min(100, Number(value) || 1));
}

function normalizeDelayKind(value) {
  if (value === "queued") return "queued";
  return value === "action" ? "action" : "timer";
}

function normalizeDelayLabel(value, kind = "timer") {
  const fallback = kind === "queued" ? "Queued Effect" : kind === "action" ? "Delayed Resolution" : "Reload/Recovery";
  return String(value || fallback).trim().slice(0, 60) || fallback;
}

function normalizeDelaySettings(value) {
  const base = Number(value?.base);
  const allowedBases = new Set([3, 6, 8, 10, 14]);
  const factors = {};
  for (const factor of ["Quality", "Performance", "Efficiency", "Situation", "Ingenuity", "Execution"]) {
    const raw = Number(value?.factors?.[factor]) || 0;
    if (factor === "Execution") {
      factors[factor] = raw > 0 ? 1 : 0;
      continue;
    }
    factors[factor] = Math.max(-4, Math.min(4, Math.round(raw)));
  }
  return {
    base: allowedBases.has(base) ? base : 8,
    factors,
  };
}

function normalizeQueuedEffect(value) {
  return {
    id: id(),
    label: normalizeDelayLabel(value?.label, "queued"),
    rate: normalizeDelayRate(value?.rate) || 1,
    settings: normalizeDelaySettings(value?.settings),
    progress: 0,
    total: 100,
    impairments: 0,
    resolving: false,
  };
}

function normalizeActionLog(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
  return text || "has taken an action";
}

function normalizeTeam(value) {
  return value === "pc" ? "pc" : "npc";
}

function normalizeActorType(value) {
  return "character";
}

function normalizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#39e58f";
}

function needsSetup(unit) {
  return !unit.speed || (unit.team === "pc" && !unit.commandWindow);
}

function canStartClock(room) {
  return room.units.length > 0 && !room.units.some(needsSetup);
}

function tieCompare(a, b) {
  if (a.team !== b.team) return a.team === "pc" ? -1 : 1;
  if ((a.speed || 0) !== (b.speed || 0)) return (b.speed || 0) - (a.speed || 0);
  return a.tieSeed - b.tieSeed;
}

function findReadyUnit(room, excludeId = null) {
  return room.units.filter((unit) => unit.id !== excludeId && !hasDelay(unit) && unit.atb >= room.threshold).sort((a, b) => tieCompare(a, b))[0];
}

function nextTurnSource(room, previousSource = null) {
  if (room.resumeAfterTurn) return "clock";
  if (previousSource === "step") return "step";
  return "manual";
}

function commandState(room) {
  if (!room.activeId || !room.commandTotal) return null;
  const remaining = (room.hardPaused || room.holdPaused) && room.commandHeldRemaining !== null
    ? room.commandHeldRemaining
    : room.commandExpired || !room.commandDeadline
    ? 0
    : Math.max(0, (room.commandDeadline - Date.now()) / 1000);
  return {
    unitId: room.activeId,
    total: room.commandTotal,
    remaining,
    expired: room.commandExpired,
  };
}

function clearActiveCommand(room) {
  room.activeSource = null;
  room.commandDeadline = null;
  room.commandTotal = 0;
  room.commandExpired = false;
  room.holdPaused = false;
  room.holdStartedAt = null;
  room.commandHeldRemaining = null;
}

function clearDelayRequest(room) {
  room.delayRequest = null;
}

function delayConsoleAllowed(room) {
  const active = room.units.find((unit) => unit.id === room.activeId);
  return Boolean(room.hardPaused || (room.pausedForTurn && active?.team === "npc"));
}

function holdCommandWindow(room) {
  if (!room.commandDeadline || room.commandExpired || room.holdPaused) return;
  room.holdPaused = true;
  room.holdStartedAt = Date.now();
  room.commandHeldRemaining = Math.max(0, (room.commandDeadline - Date.now()) / 1000);
}

function hardPauseRoom(room) {
  if (room.hardPaused) return;
  if (!room.holdPaused && room.commandDeadline && !room.commandExpired) {
    room.commandHeldRemaining = Math.max(0, (room.commandDeadline - Date.now()) / 1000);
  }
  room.hardPaused = true;
  room.holdStartedAt = Date.now();
  room.lastTick = Date.now();
  pushLog(room, "All timers paused.");
}

function hardResumeRoom(room) {
  if (!room.hardPaused) return;
  if (room.commandHeldRemaining !== null && room.commandDeadline) {
    room.commandDeadline = Date.now() + Math.max(0, room.commandHeldRemaining || 0) * 1000;
  }
  room.hardPaused = false;
  room.holdStartedAt = null;
  if (!room.holdPaused) room.commandHeldRemaining = null;
  room.lastTick = Date.now();
  if (!room.running && !room.pausedForTurn && !room.holdPaused && !room.activeAction && hasActiveDelayCountdown(room) && canStartClock(room)) {
    room.running = true;
  }
  pushLog(room, "All timers resumed.");
}

function copyDelay(delay) {
  if (!delay) return null;
  return JSON.parse(JSON.stringify(delay));
}

function migrateRoomDelays(room) {
  for (const unit of room.units) {
    if (!Array.isArray(unit.queuedEffects)) unit.queuedEffects = [];
    if (!unit.delay) continue;
    if (unit.delay.kind === "action") {
      unit.delayedAction = unit.delayedAction || unit.delay;
    } else if (unit.delay.kind === "queued") {
      unit.delayedAction = unit.delayedAction || unit.delay;
    } else {
      unit.delayTimer = unit.delayTimer || unit.delay;
    }
    delete unit.delay;
  }
}

function hasDelay(unit) {
  return Boolean(unit?.delayTimer || unit?.delayedAction || unit?.delay);
}

function activeDelay(unit) {
  return unit?.delayTimer || unit?.delayedAction || unit?.delay || null;
}

function hasActiveDelayCountdown(room) {
  return room.units.some((unit) =>
    (unit.delayTimer && !unit.delayTimer.resolving) ||
    (unit.delayedAction && !unit.delayedAction.resolving) ||
    (unit.delay && !unit.delay.resolving) ||
    (Array.isArray(unit.queuedEffects) && unit.queuedEffects.some((effect) => !effect.resolving)),
  );
}

function usesCommandWindow(unit, source) {
  return source === "clock" && unit?.team === "pc" && unit?.commandWindow;
}

function pauseForReadyUnit(room, unit, source = "clock") {
  if (!unit || room.pausedForTurn) return;
  room.pausedForTurn = true;
  room.running = false;
  room.activeId = unit.id;
  room.activeSource = source;
  room.commandExpired = false;
  room.holdPaused = false;
  room.holdStartedAt = null;
  room.commandHeldRemaining = null;
  if (usesCommandWindow(unit, source)) {
    room.commandTotal = unit.commandWindow;
    room.commandDeadline = Date.now() + unit.commandWindow * 1000;
  } else {
    room.commandTotal = 0;
    room.commandDeadline = null;
  }
  pushLog(room, usesCommandWindow(unit, source)
    ? `${unit.characterName} is ready. Command Window started (${unit.commandWindow} sec).`
    : `${unit.characterName} is ready.`);
}

function interruptActiveTurn(room) {
  const interrupted = room.units.find((unit) => unit.id === room.activeId);
  if (interrupted) {
    interrupted.atb = Math.max(0, interrupted.atb - room.threshold);
    room.lastInterruptedId = interrupted.id;
    room.lastInterruptedAt = Date.now();
    pushLog(room, `${interrupted.characterName}'s action was interrupted!`);
  }
  room.activeId = null;
  room.pausedForTurn = false;
  clearActiveCommand(room);
}

function pauseForDelayedAction(room, unit, source = "clock") {
  if (!unit || room.pausedForTurn) return;
  clearActiveCommand(room);
  room.pausedForTurn = true;
  room.running = false;
  room.activeId = null;
  room.activeAction = {
    id: unit.delayedAction?.id || id(),
    unitId: unit.id,
    characterName: unit.characterName,
    playerName: unit.playerName,
    label: normalizeDelayLabel(unit.delayedAction?.label, unit.delayedAction?.kind || "action"),
    kind: unit.delayedAction?.kind || "action",
  };
  room.activeSource = source;
  pushLog(room, `${room.activeAction.kind === "queued" ? "Resolve Queued Setup" : "Resolve Action"}: ${room.activeAction.label}.`);
}

function pauseForQueuedEffect(room, unit, effect, source = "clock") {
  if (!unit || !effect || room.pausedForTurn) return;
  clearActiveCommand(room);
  room.pausedForTurn = true;
  room.running = false;
  room.activeId = null;
  room.activeAction = {
    id: effect.id,
    unitId: unit.id,
    effectId: effect.id,
    characterName: unit.characterName,
    playerName: unit.playerName,
    label: normalizeDelayLabel(effect.label, "queued"),
    kind: "queuedEffect",
  };
  room.activeSource = source;
  pushLog(room, `Resolve Queued Effect: ${room.activeAction.label}.`);
}

function requestDelay(room, unit, kind, requestedBy = "player") {
  if (!unit || room.activeId !== unit.id) return;
  if (requestedBy !== "player" && !delayConsoleAllowed(room)) {
    pushLog(room, "Pause Everything before opening the Delay Console.");
    return;
  }
  holdCommandWindow(room);
  room.delayRequest = {
    id: id(),
    unitId: unit.id,
    kind: normalizeDelayKind(kind),
    characterName: unit.characterName,
    playerName: unit.playerName,
    requestedAt: Date.now(),
  };
  pushLog(room, requestedBy === "gm" ? `GM opened Delay Console for ${unit.characterName}.` : `${unit.characterName} requested a Delay.`);
}

function cancelDelayRequest(room) {
  if (!room.delayRequest) return;
  clearDelayRequest(room);
  if (room.holdPaused && room.commandHeldRemaining !== null && room.commandDeadline) {
    room.commandDeadline = Date.now() + Math.max(0, room.commandHeldRemaining || 0) * 1000;
  }
  room.holdPaused = false;
  room.holdStartedAt = null;
  room.commandHeldRemaining = null;
  pushLog(room, "Delay request cancelled.");
}

function startUnitDelay(room, unit, { kind = "timer", rate = 1, label = "", settings = null, queuedEffect = null } = {}) {
  if (!unit) return;
  const isRequestedDelay = room.delayRequest?.unitId === unit.id;
  if (!delayConsoleAllowed(room) && !isRequestedDelay) {
    pushLog(room, "Pause Everything before confirming a delay.");
    return;
  }
  const previousSource = room.activeSource;
  const wasActive = room.activeId === unit.id;
  const normalizedKind = normalizeDelayKind(kind);
  const nextDelay = {
    id: id(),
    kind: normalizedKind,
    label: normalizeDelayLabel(label, normalizedKind),
    rate: normalizeDelayRate(rate) || 1,
    settings: normalizeDelaySettings(settings),
    remaining: 100,
    total: 100,
    consumeTurn: wasActive,
    resolving: false,
  };
  if (normalizedKind === "queued") {
    nextDelay.queuedEffect = normalizeQueuedEffect(queuedEffect);
    unit.delayedAction = nextDelay;
  } else if (normalizedKind === "action") {
    unit.delayedAction = nextDelay;
  } else {
    unit.delayTimer = nextDelay;
  }
  clearDelayRequest(room);
  pushLog(room, `${unit.characterName} started ${nextDelay.kind === "queued" ? `Queued Effect setup: ${nextDelay.label}` : nextDelay.kind === "action" ? `Delayed Resolution: ${nextDelay.label}` : "Reload/Recovery"} at ${nextDelay.rate}.`);
  if (wasActive) {
    room.pausedForTurn = false;
    room.activeId = null;
    room.activeAction = null;
    clearActiveCommand(room);
    moveToNextTurnOrClock(room, previousSource);
  }
}

function updateUnitDelay(room, unit, { delayId = "", kind = "timer", rate = 1, label = "", settings = null } = {}) {
  if (!unit || !delayConsoleAllowed(room)) {
    pushLog(room, "Pause Everything before changing a delay.");
    return;
  }
  const normalizedKind = normalizeDelayKind(kind);
  const delay = normalizedKind === "timer" ? unit.delayTimer : unit.delayedAction;
  if (!delay || (delayId && delay.id !== delayId)) {
    pushLog(room, "That delay is no longer active.");
    return;
  }
  delay.rate = normalizeDelayRate(rate) || delay.rate || 1;
  delay.label = normalizeDelayLabel(label, normalizedKind);
  delay.settings = normalizeDelaySettings(settings);
  delay.kind = normalizedKind;
  pushLog(room, `${unit.characterName}'s ${normalizedKind === "action" ? "Delayed Resolution" : "Reload/Recovery"} was changed to ${delay.rate}.`);
}

function resolveInstantDelay(room, unit, { kind = "timer", label = "" } = {}) {
  if (!unit) return;
  const previousSource = room.activeSource;
  const wasActive = room.activeId === unit.id;
  const normalizedKind = normalizeDelayKind(kind);
  const resolvedLabel = normalizeDelayLabel(label, normalizedKind);
  clearDelayRequest(room);
  if (wasActive) {
    unit.atb = Math.max(0, unit.atb - room.threshold);
    room.pausedForTurn = false;
    room.activeId = null;
    room.activeAction = null;
    clearActiveCommand(room);
    pushLog(room, normalizedKind === "action"
      ? `Instant Resolution: ${resolvedLabel}.`
      : `${unit.characterName}'s Delay resolved instantly.`);
    moveToNextTurnOrClock(room, previousSource);
    return;
  }
  pushLog(room, normalizedKind === "action"
    ? `Instant Resolution: ${resolvedLabel}. No delay created.`
    : `${unit.characterName}'s Delay resolved instantly. No delay created.`);
}

function moveToNextTurnOrClock(room, previousSource = null) {
  const ready = findReadyUnit(room);
  if (ready) {
    pauseForReadyUnit(room, ready, nextTurnSource(room, previousSource));
  } else if (room.resumeAfterTurn && canStartClock(room)) {
    room.running = true;
    room.lastTick = Date.now();
  } else {
    room.running = false;
    room.lastTick = Date.now();
  }
}

function addProgress(room, seconds, { slow = false, skipId = null } = {}) {
  const multiplier = slow ? 0.2 : 1;
  const completedEvents = [];
  for (const unit of room.units) {
    if (unit.id === skipId || !unit.speed) continue;
    if (Array.isArray(unit.queuedEffects)) {
      for (const effect of unit.queuedEffects) {
        if (effect.resolving) continue;
        const impairmentMultiplier = Math.max(0, 1 - (Math.max(0, Math.min(2, Number(effect.impairments) || 0)) * 0.1));
        effect.progress = Math.min(100, (Number(effect.progress) || 0) + effect.rate * impairmentMultiplier * seconds * multiplier);
        if (effect.progress >= 100) {
          effect.progress = 100;
          effect.resolving = true;
          completedEvents.push({ type: "queued", unit, effect });
        }
      }
    }
    if (unit.delayTimer) {
      if (!unit.delayTimer.resolving) {
        unit.delayTimer.remaining = Math.max(0, unit.delayTimer.remaining - unit.delayTimer.rate * seconds * multiplier);
        if (unit.delayTimer.remaining <= 0) {
          const shouldConsumeTurn = unit.delayTimer.consumeTurn && !unit.delayedAction;
          if (shouldConsumeTurn) unit.atb = Math.max(0, unit.atb - room.threshold);
          unit.delayTimer = null;
          pushLog(room, `${unit.characterName}'s Reload/Recovery ended.`);
        }
      }
      continue;
    }
    if (unit.delayedAction) {
      if (!unit.delayedAction.resolving) {
        unit.delayedAction.remaining = Math.max(0, unit.delayedAction.remaining - unit.delayedAction.rate * seconds * multiplier);
        if (unit.delayedAction.remaining <= 0) {
          unit.delayedAction.remaining = 0;
          unit.delayedAction.resolving = true;
          completedEvents.push({ type: "delayed", unit, delay: unit.delayedAction });
        }
      }
      continue;
    }
    if (unit.atb < room.threshold) unit.atb += unit.speed * seconds * multiplier;
  }
  return completedEvents;
}

function resolveCompletedEvent(room, event, source) {
  if (!event) return false;
  if (event.type === "queued") {
    pauseForQueuedEffect(room, event.unit, event.effect, source);
    return true;
  }
  pauseForDelayedAction(room, event.unit, source);
  return true;
}

function advanceSeconds(room, seconds = 1, { exact = false, source = "clock" } = {}) {
  if (room.pausedForTurn || room.holdPaused) return;

  const interruptedId = room.commandExpired ? room.activeId : null;

  if (!exact) {
    const completedEvents = addProgress(room, seconds, { slow: Boolean(interruptedId), skipId: interruptedId });
    if (completedEvents.length) {
      if (interruptedId) interruptActiveTurn(room);
      resolveCompletedEvent(room, completedEvents[0], source);
      return;
    }
    const ready = findReadyUnit(room, interruptedId);
    if (ready) {
      if (interruptedId) interruptActiveTurn(room);
      pauseForReadyUnit(room, ready, source);
    }
    return;
  }

  const alreadyReady = findReadyUnit(room, interruptedId);
  if (alreadyReady) {
    if (interruptedId) interruptActiveTurn(room);
    pauseForReadyUnit(room, alreadyReady, source);
    return;
  }

  const times = room.units
    .filter((unit) => unit.speed > 0 && unit.id !== interruptedId)
    .flatMap((unit) => {
      const multiplier = interruptedId ? 0.2 : 1;
      const effectTimes = Array.isArray(unit.queuedEffects)
        ? unit.queuedEffects
          .filter((effect) => !effect.resolving)
          .map((effect) => {
            const impairmentMultiplier = Math.max(0, 1 - (Math.max(0, Math.min(2, Number(effect.impairments) || 0)) * 0.1));
            const speed = effect.rate * multiplier * impairmentMultiplier;
            return speed > 0 ? Math.max(0, (100 - (Number(effect.progress) || 0)) / speed) : Infinity;
          })
        : [];
      const delay = activeDelay(unit);
      if (delay && !delay.resolving) return [...effectTimes, Math.max(0, delay.remaining / (delay.rate * multiplier))];
      if (delay) return [...effectTimes, Infinity];
      return [...effectTimes, Math.max(0, (room.threshold - unit.atb) / (unit.speed * multiplier))];
    })
    .filter((time) => Number.isFinite(time));
  if (!times.length) return;

  const nextReadyIn = Math.min(...times);
  if (nextReadyIn <= seconds) {
    const completedEvents = addProgress(room, nextReadyIn, { slow: Boolean(interruptedId), skipId: interruptedId });
    if (interruptedId) interruptActiveTurn(room);
    if (completedEvents.length) {
      resolveCompletedEvent(room, completedEvents[0], source);
      return;
    }
    pauseForReadyUnit(room, findReadyUnit(room), source);
  } else {
    addProgress(room, seconds, { slow: Boolean(interruptedId), skipId: interruptedId });
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    migrateRoomDelays(room);
    if (room.hardPaused) continue;
    if (room.pausedForTurn && room.commandDeadline && !room.holdPaused) {
      if (Date.now() >= room.commandDeadline) {
        const unit = room.units.find((entry) => entry.id === room.activeId);
        room.pausedForTurn = false;
        room.running = true;
        room.commandExpired = true;
        room.commandDeadline = null;
        room.lastTick = Date.now();
        if (unit) pushLog(room, `${unit.characterName}'s Command Window expired.`);
      }
      broadcast(room);
      continue;
    }
    if (!room.running || room.pausedForTurn || room.holdPaused || room.hardPaused) continue;
    const now = Date.now();
    const elapsed = now - room.lastTick;
    if (elapsed < 80) continue;
    room.lastTick = now;
    advanceSeconds(room, elapsed / 1000, { exact: true, source: "clock" });
    broadcast(room);
  }
}, 100);

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolute = path.join(PUBLIC_DIR, filePath);
  if (!absolute.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(absolute, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(absolute), "Cache-Control": "no-store" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleCreateRoom(req, res) {
  try {
    await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Bad JSON" });
    return;
  }
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
  migrateRoomDelays(room);

  const action = body.action;
  if (action === "undoLastTiming") {
    restoreUndoSnapshot(room);
    sendJson(res, 200, publicState(room));
    broadcast(room);
    return;
  }

  if (undoableActions.has(action) && !(action === "join" && body.controlledBy === "player")) {
    saveUndoSnapshot(room);
  }

  if (action === "join" || action === "addUnit") {
    const playerName = String(body.playerName || "Player").trim().slice(0, 40);
    const characterName = String(body.characterName || "Character").trim().slice(0, 40);
    const speed = normalizeSpeed(body.speed);
    const commandWindow = normalizeCommandWindow(body.commandWindow);
    const unit = {
      id: id(),
      playerName,
      characterName,
      speed,
      commandWindow,
      atb: 0,
      delay: null,
      delayTimer: null,
      delayedAction: null,
      queuedEffects: [],
      controlledBy: body.controlledBy || "player",
      team: normalizeTeam(body.team || (body.controlledBy === "player" ? "pc" : "npc")),
      actorType: normalizeActorType(body.actorType),
      color: normalizeColor(body.color),
      tieSeed: Math.random(),
    };
    room.units.push(unit);
    const setupText = needsSetup(unit) ? "awaiting GM setup" : `Speed ${speed}`;
    pushLog(room, `${characterName} joined (${setupText}).`);
  }

  if (action === "removeUnit") {
    const unit = room.units.find((entry) => entry.id === body.id);
    const wasActive = room.activeId === body.id;
    const previousSource = room.activeSource;
    room.units = room.units.filter((entry) => entry.id !== body.id);
    if (wasActive) {
      room.activeId = null;
      room.pausedForTurn = false;
      clearActiveCommand(room);
      moveToNextTurnOrClock(room, previousSource);
    }
    if (room.activeAction?.unitId === body.id) {
      room.activeAction = null;
      room.pausedForTurn = false;
      moveToNextTurnOrClock(room, room.activeSource);
    }
    if (room.delayRequest?.unitId === body.id) clearDelayRequest(room);
    if (unit) pushLog(room, `${unit.characterName} removed from combat.`);
  }

  if (action === "setRunning") {
    const wantsRunning = Boolean(body.running);
    if (wantsRunning && !room.pausedForTurn && !room.hardPaused) {
      if (!canStartClock(room)) {
        pushLog(room, "Clock cannot start until every participant has GM-entered values.");
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
    if (Boolean(body.paused)) {
      hardPauseRoom(room);
    } else {
      hardResumeRoom(room);
    }
  }

  if (action === "toggleClock") {
    if (room.hardPaused) {
      hardResumeRoom(room);
    } else if (room.running || room.pausedForTurn || room.holdPaused || room.activeAction) {
      hardPauseRoom(room);
    } else if (!canStartClock(room)) {
      pushLog(room, "Clock cannot start until every participant has GM-entered values.");
    } else {
      room.running = true;
      room.resumeAfterTurn = true;
      room.hasEngagedClock = true;
      room.lastTick = Date.now();
      pushLog(room, "Clock started.");
    }
  }

  if (action === "setSpeed") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) {
      const oldSpeed = unit.speed;
      unit.speed = normalizeSpeed(body.speed);
      pushLog(room, `${unit.characterName}'s Speed changed from ${oldSpeed} to ${unit.speed}.`);
    }
  }

  if (action === "setCommandWindow") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit) {
      const oldWindow = unit.commandWindow;
      unit.commandWindow = normalizeCommandWindow(body.commandWindow);
      pushLog(room, `${unit.characterName}'s Command Window changed from ${oldWindow || "unset"} to ${unit.commandWindow} seconds.`);
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

  if (action === "logPlayerAction") {
    const unit = room.units.find((entry) => entry.id === body.id);
    const label = normalizeActionLog(body.label);
    if (unit) pushLog(room, `${unit.characterName} ${label}.`);
  }

  if (action === "requestDelay") {
    const unit = room.units.find((entry) => entry.id === body.id);
    requestDelay(room, unit, body.kind, body.requestedBy);
  }

  if (action === "cancelDelayRequest") {
    cancelDelayRequest(room);
  }

  if (action === "startDelay") {
    const unit = room.units.find((entry) => entry.id === body.id);
    startUnitDelay(room, unit, {
      kind: body.kind,
      rate: body.rate,
      label: body.label,
      settings: body.settings,
      queuedEffect: body.queuedEffect,
    });
  }

  if (action === "updateDelay") {
    const unit = room.units.find((entry) => entry.id === body.id);
    updateUnitDelay(room, unit, {
      delayId: body.delayId,
      kind: body.kind,
      rate: body.rate,
      label: body.label,
      settings: body.settings,
    });
  }

  if (action === "instantDelay") {
    const unit = room.units.find((entry) => entry.id === body.id);
    resolveInstantDelay(room, unit, {
      kind: body.kind,
      label: body.label,
    });
  }

  if (action === "impairQueuedEffect") {
    const unit = room.units.find((entry) => entry.id === body.id);
    const effect = unit?.queuedEffects?.find((entry) => entry.id === body.effectId);
    if (unit && effect) {
      effect.impairments = Math.max(0, Math.min(3, (Number(effect.impairments) || 0) + 1));
      if (effect.impairments >= 3) {
        unit.queuedEffects = unit.queuedEffects.filter((entry) => entry.id !== effect.id);
        if (room.activeAction?.effectId === effect.id) {
          room.activeAction = null;
          room.pausedForTurn = false;
          moveToNextTurnOrClock(room, room.activeSource);
        }
        pushLog(room, `${effect.label} was destroyed.`);
      } else {
        pushLog(room, `${effect.label} impaired (${effect.impairments}/3).`);
      }
    }
  }

  if (action === "removeQueuedEffect") {
    const unit = room.units.find((entry) => entry.id === body.id);
    const effect = unit?.queuedEffects?.find((entry) => entry.id === body.effectId);
    if (unit && effect) {
      unit.queuedEffects = unit.queuedEffects.filter((entry) => entry.id !== effect.id);
      if (room.activeAction?.effectId === effect.id) {
        room.activeAction = null;
        room.pausedForTurn = false;
        moveToNextTurnOrClock(room, room.activeSource);
      }
      pushLog(room, `${effect.label} removed.`);
    }
  }

  if (action === "step") {
    if (room.activeId || room.pausedForTurn) {
      pushLog(room, "Resolve the active turn before stepping the clock.");
      sendJson(res, 200, publicState(room));
      broadcast(room);
      return;
    }
    room.resumeAfterTurn = false;
    room.running = false;
    clearActiveCommand(room);
    advanceSeconds(room, 1, { source: "step" });
    pushLog(room, "GM advanced one second.");
  }

  if (action === "reset") {
    for (const unit of room.units) {
      unit.atb = 0;
      unit.delay = null;
      unit.delayTimer = null;
      unit.delayedAction = null;
      unit.queuedEffects = [];
    }
    room.running = false;
    room.pausedForTurn = false;
    room.resumeAfterTurn = false;
    room.hardPaused = false;
    room.activeId = null;
    room.activeAction = null;
    clearDelayRequest(room);
    clearActiveCommand(room);
    room.lastInterruptedId = null;
    room.lastInterruptedAt = 0;
    room.lastTick = Date.now();
    pushLog(room, "Encounter reset.");
  }

  if (action === "clearEncounter") {
    room.units = [];
    room.running = false;
    room.pausedForTurn = false;
    room.resumeAfterTurn = false;
    room.hardPaused = false;
    room.activeId = null;
    room.activeAction = null;
    clearDelayRequest(room);
    clearActiveCommand(room);
    room.lastInterruptedId = null;
    room.lastInterruptedAt = 0;
    room.lastTick = Date.now();
    pushLog(room, "Encounter cleared.");
  }

  if (action === "completeTurn") {
    if (room.activeAction) {
      const previousSource = room.activeSource;
      const actionToResolve = room.activeAction;
      const unit = room.units.find((entry) => entry.id === actionToResolve.unitId);
      if (unit) {
        if (actionToResolve.kind === "queuedEffect") {
          const before = Array.isArray(unit.queuedEffects) ? unit.queuedEffects.length : 0;
          unit.queuedEffects = (unit.queuedEffects || []).filter((effect) => effect.id !== actionToResolve.effectId);
          pushLog(room, before === unit.queuedEffects.length
            ? `Resolved Queued Effect: ${actionToResolve.label}.`
            : `Resolved Queued Effect: ${actionToResolve.label}.`);
        } else {
          const queuedTemplate = unit.delayedAction?.queuedEffect;
          unit.delayedAction = null;
          if (!unit.delayTimer) unit.atb = Math.max(0, unit.atb - room.threshold);
          if (queuedTemplate) {
            unit.queuedEffects = Array.isArray(unit.queuedEffects) ? unit.queuedEffects : [];
            if (unit.queuedEffects.length >= 5) {
              pushLog(room, `${unit.characterName} cannot queue ${queuedTemplate.label}; maximum queued effects reached.`);
            } else {
              unit.queuedEffects.push({
                ...copyDelay(queuedTemplate),
                id: id(),
                progress: 0,
                total: 100,
                impairments: 0,
                resolving: false,
              });
              pushLog(room, `${unit.characterName} launched Queued Effect: ${queuedTemplate.label}.`);
            }
          } else {
            pushLog(room, `Resolved Action: ${actionToResolve.label}.`);
          }
        }
      }
      room.pausedForTurn = false;
      room.activeAction = null;
      room.activeId = null;
      clearActiveCommand(room);
      moveToNextTurnOrClock(room, previousSource);
      sendJson(res, 200, publicState(room));
      broadcast(room);
      return;
    }
    if (body.id && body.id !== room.activeId) {
      sendJson(res, 200, publicState(room));
      return;
    }
    const previousSource = room.activeSource;
    const unit = room.units.find((entry) => entry.id === room.activeId);
    if (unit) {
      unit.atb = Math.max(0, unit.atb - room.threshold);
      pushLog(room, `${unit.characterName}'s turn completed.`);
    }
    room.pausedForTurn = false;
    room.activeId = null;
    clearActiveCommand(room);
    moveToNextTurnOrClock(room, previousSource);
  }

  if (action === "nudge") {
    const unit = room.units.find((entry) => entry.id === body.id);
    if (unit && !room.pausedForTurn) {
      unit.atb = Math.min(room.threshold, unit.atb + Math.max(1, Number(body.amount) || 1));
      if (unit.atb >= room.threshold && !hasDelay(unit)) {
        if (room.commandExpired && room.activeId) interruptActiveTurn(room);
        pauseForReadyUnit(room, unit, room.resumeAfterTurn ? "clock" : "manual");
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
    res.end("Spaceship Architect ATB server is reachable.");
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
  console.log("Spaceship Architect ATB multiplayer running");
  console.log(`Local:   http://127.0.0.1:${PORT}`);
  for (const address of addresses) console.log(`Phone:   http://${address}:${PORT}`);
});
