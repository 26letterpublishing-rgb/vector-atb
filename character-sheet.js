(() => {
  "use strict";

  const STORAGE_KEY = "vector-characters-v1";
  const FORMAT = "VECTOR_CHARACTER";
  const VERSION = 2;
  const STARTING_EXP = 70;

  const attributes = [
    { key: "strength", name: "Strength", short: "STR", color: "#ff6673" },
    { key: "dexterity", name: "Dexterity", short: "DEX", color: "#45d7ff" },
    { key: "health", name: "Health", short: "HTH", color: "#6de293" },
    { key: "intellect", name: "Intellect", short: "INT", color: "#ad86ff" },
    { key: "perception", name: "Perception", short: "PER", color: "#f7d85b" },
    { key: "charisma", name: "Charisma", short: "CHA", color: "#ff82bd" },
  ];

  const skills = [
    { key: "firearms", name: "Firearms", attribute: "perception", hint: "Fire Gun" },
    { key: "dodge", name: "Dodge", attribute: "dexterity", hint: "Defense" },
    { key: "melee", name: "Melee", attribute: "dexterity", hint: "Melee / Close Quarters" },
    { key: "awareness", name: "Awareness", attribute: "perception" },
    { key: "initiative", name: "Initiative", attribute: "intellect", hint: "Decision / Use Item" },
    { key: "composure", name: "Composure", attribute: "dexterity", hint: "Poise / Stagger" },
    { key: "animalKen", name: "Animal Ken", attribute: "charisma" },
    { key: "incognito", name: "Incognito", attribute: "charisma" },
    { key: "athletics", name: "Athletics", attribute: "health" },
    { key: "brawn", name: "Brawn", attribute: "strength" },
    { key: "breakFree", name: "Break Free", attribute: "strength" },
    { key: "computers", name: "Computers", attribute: "intellect" },
    { key: "creativity", name: "Creativity", attribute: "intellect" },
    { key: "deceive", name: "Deceive", attribute: "charisma" },
    { key: "disarm", name: "Disarm", attribute: "dexterity" },
    { key: "disguise", name: "Disguise", attribute: "charisma" },
    { key: "intimidate", name: "Intimidate", attribute: "charisma" },
    { key: "intuition", name: "Intuition", attribute: "intellect" },
    { key: "investigate", name: "Investigate", attribute: "intellect" },
    { key: "mathematics", name: "Mathematics", attribute: "intellect" },
    { key: "mechanics", name: "Mechanics", attribute: "intellect" },
    { key: "medical", name: "Medical", attribute: "intellect" },
    { key: "navigate", name: "Navigate", attribute: "intellect" },
    { key: "ordnance", name: "Ordnance", attribute: "intellect" },
    { key: "persuade", name: "Persuade", attribute: "charisma" },
    { key: "poise", name: "Poise", attribute: "health" },
    { key: "psychology", name: "Psychology", attribute: "intellect" },
    { key: "resilience", name: "Resilience", attribute: "health", hint: "Stability / Core Thresholds" },
    { key: "resistDeath", name: "Resist Death", attribute: "health" },
    { key: "selfControl", name: "Self-Control", attribute: "intellect" },
    { key: "stealth", name: "Stealth", attribute: "dexterity" },
    { key: "teaching", name: "Teaching", attribute: "charisma" },
    { key: "technology", name: "Technology", attribute: "intellect" },
    { key: "thievery", name: "Thievery", attribute: "dexterity" },
    { key: "vehicles", name: "Vehicles", attribute: "dexterity" },
  ].sort((a, b) => a.name.localeCompare(b.name));

  const networkRatings = [
    { key: "finance", name: "Finance" },
    { key: "punctuality", name: "Punctuality" },
    { key: "criminality", name: "Criminality" },
    { key: "observation", name: "Observation" },
    { key: "credibility", name: "Credibility / Reputation" },
  ];

  const damageLayers = [
    { key: "guard", name: "Guard", shape: "triangle" },
    { key: "shell", name: "Shell", shape: "square" },
    { key: "stability", name: "Stability", shape: "circle" },
    { key: "core", name: "Core", shape: "cross" },
  ];

  const elementIds = [
    "characterCreator characterBack characterSavedSelect characterNew characterSaveState characterSheetName characterSheetColor characterInfo characterInfoClose characterAvailableExp characterSpentExp characterKarma characterTabs characterAttributeGrid characterUndo characterRevert characterReset characterAdvancementNotice characterSkillSearch characterSkillList characterMoveSpeed characterMoveFormula characterStabilityThreshold characterStabilityFormula characterCoreThreshold characterCoreFormula characterPoise characterDamageTracks characterVectorScore characterNetworkRatings characterAffiliations characterAchievements characterImport characterExport characterSave characterImportFile"
  ].join(" ").split(" ");
  const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));

  let draft = null;
  let activeTab = "attributes";
  let sessionUndo = [];
  let saveTimer = null;
  let combatContext = { characterId: "", advancementLocked: false };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function whole(value, fallback = 0, minimum = 0, maximum = 999999) {
    const number = Number(value);
    return clamp(Number.isFinite(number) ? Math.round(number) : fallback, minimum, maximum);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }
  function recordId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `vector-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function baseAttributes() {
    return Object.fromEntries(attributes.map((attribute) => [attribute.key, 2]));
  }

  function baseSkills() {
    return Object.fromEntries(skills.map((skill) => [skill.key, 0]));
  }

  function buildCheckpoint(character) {
    return {
      attributes: clone(character.attributes),
      skills: clone(character.skills),
      totalSpent: whole(character.experience?.totalSpent, 0, 0),
      advancementLog: clone(character.advancementLog || []),
    };
  }

  function createCharacter() {
    const now = new Date().toISOString();
    const character = {
      id: recordId(),
      format: FORMAT,
      version: VERSION,
      finalized: false,
      hasEngagedCombat: false,
      name: "New Vector",
      color: "#39e58f",
      attributes: baseAttributes(),
      skills: baseSkills(),
      experience: { available: STARTING_EXP, totalEarned: STARTING_EXP, totalSpent: 0 },
      karma: 0,
      poise: { current: 3, max: 3 },
      damage: {
        guard: { active: false, current: 0, max: 10 },
        shell: { active: false, current: 0, max: 10 },
        stability: { active: true, current: 10, max: 10 },
        core: { active: true, current: 10, max: 10 },
      },
      network: {
        vectorScore: 0,
        ratings: Object.fromEntries(networkRatings.map((rating) => [rating.key, 0])),
        affiliations: "",
        achievements: "",
      },
      advancementLog: [],
      savedBuild: null,
      createdAt: now,
      updatedAt: now,
    };
    character.savedBuild = buildCheckpoint(character);
    return character;
  }

  function normalizeCharacter(source = {}) {
    const clean = createCharacter();
    clean.id = String(source.id || clean.id).slice(0, 100);
    clean.finalized = Boolean(source.finalized);
    clean.hasEngagedCombat = Boolean(source.hasEngagedCombat);
    clean.name = String(source.name || "New Vector").trim().slice(0, 40) || "New Vector";
    clean.color = /^#[0-9a-f]{6}$/i.test(String(source.color || "")) ? source.color : clean.color;
    for (const attribute of attributes) clean.attributes[attribute.key] = whole(source.attributes?.[attribute.key], 2, 2, 20);
    for (const skill of skills) {
      const legacyValue = skill.key === "incognito" ? source.skills?.anomalistics : undefined;
      clean.skills[skill.key] = whole(source.skills?.[skill.key] ?? legacyValue, 0, 0, 999);
    }
    const spent = whole(source.experience?.totalSpent, 0, 0);
    const earned = whole(source.experience?.totalEarned, STARTING_EXP, STARTING_EXP);
    clean.experience = {
      available: whole(source.experience?.available, Math.max(0, earned - spent), 0),
      totalEarned: earned,
      totalSpent: spent,
    };
    clean.karma = whole(source.karma, 0, 0);
    clean.poise = { current: whole(source.poise?.current, 3, 0, 99), max: whole(source.poise?.max, 3, 1, 99) };
    for (const layer of damageLayers) {
      const active = layer.key === "guard" || layer.key === "shell" ? Boolean(source.damage?.[layer.key]?.active) : true;
      clean.damage[layer.key] = {
        active,
        current: active ? whole(source.damage?.[layer.key]?.current, 10, 0, 10) : 0,
        max: 10,
      };
    }
    clean.network.vectorScore = whole(source.network?.vectorScore, 0, 0, 999);
    for (const rating of networkRatings) clean.network.ratings[rating.key] = whole(source.network?.ratings?.[rating.key], 0, 0, 10);
    clean.network.affiliations = String(source.network?.affiliations || "").slice(0, 10000);
    clean.network.achievements = String(source.network?.achievements || "").slice(0, 10000);
    clean.advancementLog = Array.isArray(source.advancementLog) ? source.advancementLog.slice(-1000).map((entry) => clone(entry)) : [];
    const savedSource = source.savedBuild || {};
    clean.savedBuild = {
      attributes: clone(clean.attributes),
      skills: clone(clean.skills),
      totalSpent: clean.experience.totalSpent,
      advancementLog: clone(clean.advancementLog),
    };
    if (source.savedBuild) {
      for (const attribute of attributes) clean.savedBuild.attributes[attribute.key] = whole(savedSource.attributes?.[attribute.key], clean.attributes[attribute.key], 2, 20);
      for (const skill of skills) {
        const legacyValue = skill.key === "incognito" ? savedSource.skills?.anomalistics : undefined;
        clean.savedBuild.skills[skill.key] = whole(savedSource.skills?.[skill.key] ?? legacyValue, clean.skills[skill.key], 0, 999);
      }
      clean.savedBuild.totalSpent = whole(savedSource.totalSpent, clean.experience.totalSpent, 0);
      clean.savedBuild.advancementLog = Array.isArray(savedSource.advancementLog) ? savedSource.advancementLog.slice(-1000).map(clone) : clone(clean.advancementLog);
    }
    clean.createdAt = String(source.createdAt || clean.createdAt);
    clean.updatedAt = String(source.updatedAt || clean.updatedAt);
    return clean;
  }

  function loadVault() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeCharacter) : [];
    } catch {
      return [];
    }
  }

  function writeVault(characters) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(characters.slice(0, 50))); } catch { /* Export remains available. */ }
  }

  function listCharacters() {
    return loadVault().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function getCharacter(characterId) {
    return listCharacters().find((character) => character.id === characterId) || null;
  }

  function persistNow(status = "Saved locally") {
    if (!draft) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    draft.updatedAt = new Date().toISOString();
    const vault = loadVault();
    const index = vault.findIndex((character) => character.id === draft.id);
    if (index >= 0) vault[index] = clone(draft);
    else vault.push(clone(draft));
    writeVault(vault);
    renderVaultSelect();
    elements.characterSaveState.textContent = status;
    window.dispatchEvent(new CustomEvent("vector-characters-changed", { detail: { id: draft.id } }));
  }

  function schedulePersist() {
    if (!draft) return;
    elements.characterSaveState.textContent = "Saving locally";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistNow(draft.finalized ? "Saved locally" : "Local draft"), 180);
  }

  function attributeUpgradeCost(nextRating) {
    if (nextRating <= 4) return 4;
    if (nextRating <= 8) return 6;
    if (nextRating <= 12) return 8;
    if (nextRating <= 16) return 10;
    return 12;
  }

  function skillUpgradeDetails(skillDefinition, character = draft) {
    const level = whole(character?.skills?.[skillDefinition.key], 0, 0);
    const attribute = whole(character?.attributes?.[skillDefinition.attribute], 2, 2, 20);
    if (level === 0) return { level, attribute, multiplier: 1, cost: 1, formula: "(0 + 1) x 1 = 1 EXP" };
    let multiplier = 4;
    if (attribute >= level * 4) multiplier = 1;
    else if (attribute >= level * 3) multiplier = 2;
    else if (attribute >= level * 2) multiplier = 3;
    else if (attribute < level) {
      if (attribute * 4 <= level) multiplier = 7;
      else if (attribute * 2 <= level) multiplier = 6;
      else multiplier = 5;
    }
    const cost = (level + 1) * multiplier;
    return { level, attribute, multiplier, cost, formula: `(${level} + 1) x ${multiplier} = ${cost} EXP` };
  }

  function skillUpgradeCost(skillDefinition, character = draft) {
    return skillUpgradeDetails(skillDefinition, character).cost;
  }

  function advancementLocked() {
    return Boolean(combatContext.advancementLocked && draft?.id === combatContext.characterId);
  }

  function dicePoolForRating(rawRating) {
    const rating = whole(rawRating, 2, 2, 20);
    if (rating <= 4) return Array.from({ length: rating }, () => 4);
    const sides = [4, 6, 8, 10, 12];
    const tier = Math.floor((rating - 1) / 4);
    const upgradedDice = ((rating - 1) % 4) + 1;
    return [...Array.from({ length: upgradedDice }, () => sides[tier]), ...Array.from({ length: 4 - upgradedDice }, () => sides[tier - 1])];
  }

  function moveSpeed(dexterity) {
    const dex = whole(dexterity, 2, 2, 20);
    if (dex <= 4) return dex;
    if (dex <= 10) return 4 + Math.floor((dex - 4) / 2);
    return Math.min(10, 7 + Math.floor((dex - 10) / 3));
  }

  function diceMarkup(rating) {
    return dicePoolForRating(rating).map((sides) => `<svg class="character-die d${sides}" role="img" aria-label="D${sides}"><use href="vector-dice-icons.svg#d${sides}"></use></svg>`).join("");
  }

  function renderVaultSelect() {
    if (!draft) return;
    const vault = listCharacters();
    elements.characterSavedSelect.innerHTML = vault.map((character) => `<option value="${escapeHtml(character.id)}"${character.id === draft.id ? " selected" : ""}>${escapeHtml(character.name)}${character.finalized ? "" : " (Draft)"}</option>`).join("");
  }

  function renderAttributes() {
    const locked = advancementLocked();
    elements.characterAttributeGrid.innerHTML = attributes.map((attribute) => {
      const rating = draft.attributes[attribute.key];
      const cost = rating < 20 ? attributeUpgradeCost(rating + 1) : null;
      const disabled = locked || cost === null || cost > draft.experience.available;
      return `<article class="character-attribute" style="--attribute-accent:${attribute.color}">
        <header><h3>${attribute.name}</h3><div class="character-attribute-rating"><strong>${rating}</strong><span>${attribute.short}</span></div></header>
        <div class="character-dice" aria-label="${escapeHtml(attribute.name)} dice pool">${diceMarkup(rating)}</div>
        <footer><span>${cost === null ? "Maximum" : `Next: ${cost} EXP`}</span><button type="button" data-buy-attribute="${attribute.key}" aria-label="Increase ${escapeHtml(attribute.name)}" title="Increase ${escapeHtml(attribute.name)}"${disabled ? " disabled" : ""}>+</button></footer>
      </article>`;
    }).join("");
  }

  function renderSkills() {
    const query = elements.characterSkillSearch.value.trim().toLowerCase();
    const visible = query ? skills.filter((skill) => skill.name.toLowerCase().includes(query)) : skills;
    const locked = advancementLocked();
    const groups = new Map(attributes.map((attribute, index) => {
      const group = visible.filter((skill) => skill.attribute === attribute.key);
      if (!group.length) return [attribute.key, ""];
      const rows = group.map((skill) => {
        const rating = draft.skills[skill.key];
        const details = skillUpgradeDetails(skill);
        const hint = skill.hint ? `<small class="character-skill-hint">${escapeHtml(skill.hint)}</small>` : "";
        return `<div class="character-skill-row">
          <div class="character-skill-name"><strong>${escapeHtml(skill.name)}</strong>${hint}</div>
          <span class="character-skill-rating">${rating}</span>
          <span class="character-skill-cost"><strong>${details.cost} EXP</strong><small>${escapeHtml(details.formula)}</small></span>
          <button type="button" data-buy-skill="${skill.key}" aria-label="Increase ${escapeHtml(skill.name)}" title="Increase ${escapeHtml(skill.name)}"${locked || details.cost > draft.experience.available ? " disabled" : ""}>+</button>
        </div>`;
      }).join("");
      return [attribute.key, `<section class="character-skill-group" data-skill-attribute="${attribute.key}" style="--attribute-accent:${attribute.color};--skill-order:${index + 1}"><header><strong>${attribute.short}</strong><span>${attribute.name}</span></header>${rows}</section>`];
    }));
    const left = ["strength", "health", "intellect"].map((key) => groups.get(key)).join("");
    const right = ["dexterity", "perception", "charisma"].map((key) => groups.get(key)).join("");
    elements.characterSkillList.innerHTML = left || right ? `<div class="character-skill-column">${left}</div><div class="character-skill-column">${right}</div>` : `<p class="character-skill-empty">No matching skills.</p>`;
  }

  function damagePoints(layer) {
    return Array.from({ length: 10 }, (_, index) => `<span class="damage-point ${layer.shape}${index < layer.current ? " filled" : ""}" aria-hidden="true"></span>`).join("");
  }

  function renderVitals() {
    const threshold = draft.attributes.health + draft.skills.resilience;
    elements.characterMoveSpeed.textContent = String(moveSpeed(draft.attributes.dexterity));
    elements.characterMoveFormula.textContent = `DEX ${draft.attributes.dexterity} -> ${moveSpeed(draft.attributes.dexterity)} spaces`;
    elements.characterStabilityThreshold.textContent = String(threshold);
    elements.characterStabilityFormula.textContent = `HTH ${draft.attributes.health} + Resilience ${draft.skills.resilience}`;
    elements.characterCoreThreshold.textContent = String(threshold);
    elements.characterCoreFormula.textContent = `HTH ${draft.attributes.health} + Resilience ${draft.skills.resilience}`;
    elements.characterPoise.textContent = `${draft.poise.current} / ${draft.poise.max}`;
    elements.characterDamageTracks.innerHTML = damageLayers.map((definition) => {
      const layer = { ...definition, ...draft.damage[definition.key] };
      const inactive = !layer.active;
      const coreLost = 10 - layer.current;
      const corePenalty = definition.key === "core" ? `<small>Final Score Penalty: ${coreLost ? `-${coreLost}` : "0"}</small>` : "";
      return `<article class="character-damage-track${inactive ? " inactive" : ""}">
        <header><div><h3>${definition.name}</h3>${corePenalty}</div><strong>${inactive ? "Inactive" : `${layer.current} / 10`}</strong></header>
        <div class="damage-track-controls">
          <div class="damage-points">${damagePoints(layer)}</div>
          <div class="damage-stepper">
            <button type="button" data-damage-layer="${definition.key}" data-damage-change="-1" aria-label="Remove one ${definition.name} point" title="Remove point"${inactive || layer.current <= 0 ? " disabled" : ""}>-</button>
            <button type="button" data-damage-layer="${definition.key}" data-damage-change="1" aria-label="Restore one ${definition.name} point" title="Restore point"${inactive || layer.current >= 10 ? " disabled" : ""}>+</button>
          </div>
        </div>
      </article>`;
    }).join("");
  }

  function renderNetwork() {
    elements.characterVectorScore.value = String(draft.network.vectorScore);
    elements.characterNetworkRatings.innerHTML = networkRatings.map((rating) => {
      const value = draft.network.ratings[rating.key];
      return `<label class="character-network-rating"><span>${escapeHtml(rating.name)}</span><div>
        <button type="button" data-network-rating="${rating.key}" data-network-change="-1" aria-label="Reduce ${escapeHtml(rating.name)}"${value <= 0 ? " disabled" : ""}>-</button>
        <input type="number" min="0" max="10" step="1" value="${value}" inputmode="numeric" data-network-input="${rating.key}" aria-label="${escapeHtml(rating.name)} rating" />
        <button type="button" data-network-rating="${rating.key}" data-network-change="1" aria-label="Increase ${escapeHtml(rating.name)}"${value >= 10 ? " disabled" : ""}>+</button>
      </div></label>`;
    }).join("");
    elements.characterAffiliations.value = draft.network.affiliations;
    elements.characterAchievements.value = draft.network.achievements;
  }

  function renderTabs() {
    elements.characterTabs.querySelectorAll("[data-character-tab]").forEach((button) => {
      const active = button.dataset.characterTab === activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-character-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.characterPanel !== activeTab));
  }

  function render() {
    if (!draft || !elements.characterCreator) return;
    document.documentElement.style.setProperty("--character-accent", draft.color);
    elements.characterSheetName.value = draft.name;
    elements.characterSheetColor.value = draft.color;
    elements.characterAvailableExp.textContent = String(draft.experience.available);
    elements.characterSpentExp.textContent = String(draft.experience.totalSpent);
    elements.characterKarma.textContent = String(draft.karma);
    const locked = advancementLocked();
    elements.characterUndo.disabled = locked || sessionUndo.length === 0;
    elements.characterRevert.disabled = locked || !draft.savedBuild;
    elements.characterReset.disabled = locked || draft.hasEngagedCombat;
    elements.characterReset.title = draft.hasEngagedCombat ? "Reset is unavailable after this character has entered combat." : "Reset Attributes and Skills";
    elements.characterAdvancementNotice.classList.toggle("hidden", !locked);
    elements.characterSave.textContent = draft.finalized ? "Save Changes" : "Save Character";
    renderVaultSelect();
    renderTabs();
    renderAttributes();
    renderSkills();
    renderVitals();
    renderNetwork();
  }

  function logPurchase(kind, key, from, to, cost) {
    const record = { id: recordId(), kind, key, from, to, cost, at: new Date().toISOString() };
    draft.advancementLog.push(record);
    sessionUndo.push(record);
    draft.experience.available -= cost;
    draft.experience.totalSpent += cost;
  }

  function buyAttribute(key) {
    if (advancementLocked()) return;
    const definition = attributes.find((attribute) => attribute.key === key);
    if (!definition || draft.attributes[key] >= 20) return;
    const from = draft.attributes[key];
    const cost = attributeUpgradeCost(from + 1);
    if (cost > draft.experience.available) return;
    draft.attributes[key] += 1;
    logPurchase("attribute", key, from, from + 1, cost);
    schedulePersist();
    render();
  }

  function buySkill(key) {
    if (advancementLocked()) return;
    const definition = skills.find((skill) => skill.key === key);
    if (!definition) return;
    const from = draft.skills[key];
    const cost = skillUpgradeCost(definition);
    if (cost > draft.experience.available) return;
    draft.skills[key] += 1;
    logPurchase("skill", key, from, from + 1, cost);
    schedulePersist();
    render();
  }

  function undoLastPurchase() {
    if (advancementLocked()) return;
    const record = sessionUndo.pop();
    if (!record) return;
    if (record.kind === "attribute") draft.attributes[record.key] = record.from;
    if (record.kind === "skill") draft.skills[record.key] = record.from;
    draft.experience.available += record.cost;
    draft.experience.totalSpent = Math.max(0, draft.experience.totalSpent - record.cost);
    draft.advancementLog = draft.advancementLog.filter((entry) => entry.id !== record.id);
    schedulePersist();
    render();
  }

  function resetBuild() {
    if (advancementLocked() || draft.hasEngagedCombat) return;
    if (!confirm("Reset all Attribute and Skill purchases? Awarded EXP and Karma will be kept.")) return;
    draft.attributes = baseAttributes();
    draft.skills = baseSkills();
    draft.experience.totalSpent = 0;
    draft.experience.available = draft.experience.totalEarned;
    draft.advancementLog = [];
    sessionUndo = [];
    schedulePersist();
    render();
  }

  function revertToLastSave() {
    if (advancementLocked() || !draft.savedBuild) return;
    if (!confirm("Revert Attributes and Skills to the last explicit save? Awarded EXP and Karma will be kept.")) return;
    draft.attributes = clone(draft.savedBuild.attributes);
    draft.skills = clone(draft.savedBuild.skills);
    draft.experience.totalSpent = whole(draft.savedBuild.totalSpent, 0, 0);
    draft.experience.available = Math.max(0, draft.experience.totalEarned - draft.experience.totalSpent);
    draft.advancementLog = clone(draft.savedBuild.advancementLog || []);
    sessionUndo = [];
    schedulePersist();
    render();
  }

  function openNew() {
    if (draft && getCharacter(draft.id)) persistNow();
    draft = createCharacter();
    sessionUndo = [];
    activeTab = "attributes";
    persistNow("Local draft");
    render();
  }

  function openCharacter(characterId) {
    if (draft && getCharacter(draft.id)) persistNow();
    const character = getCharacter(characterId);
    if (!character) return openNew();
    draft = clone(character);
    sessionUndo = [];
    activeTab = "attributes";
    elements.characterSaveState.textContent = character.finalized ? "Saved locally" : "Local draft";
    render();
  }

  function saveCharacter() {
    if (!draft) return;
    draft.name = String(elements.characterSheetName.value || draft.name).trim().slice(0, 40) || "Unnamed Vector";
    draft.finalized = true;
    draft.savedBuild = buildCheckpoint(draft);
    sessionUndo = [];
    persistNow("Saved locally");
    render();
  }

  async function exportCharacter() {
    if (!draft) return;
    saveCharacter();
    const payload = JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), character: draft }, null, 2);
    const safeName = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vector-character";
    const file = new File([payload], `${safeName}.vector.json`, { type: "application/json" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: draft.name, files: [file] }); return; } catch (error) { if (error?.name === "AbortError") return; }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function importCharacter(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed?.format === FORMAT && parsed.character ? parsed.character : parsed;
      const imported = normalizeCharacter(source);
      imported.id = recordId();
      imported.finalized = true;
      imported.updatedAt = new Date().toISOString();
      draft = imported;
      sessionUndo = [];
      activeTab = "attributes";
      persistNow("Imported and saved");
      render();
    } catch {
      elements.characterSaveState.textContent = "Import failed";
    } finally {
      elements.characterImportFile.value = "";
    }
  }

  function syncEconomy(characterId, experience, karma) {
    if (!characterId) return false;
    const vault = loadVault();
    const index = vault.findIndex((character) => character.id === characterId);
    if (index < 0) return false;
    const character = draft?.id === characterId ? clone(draft) : vault[index];
    const nextEarned = whole(experience?.totalEarned, character.experience.totalEarned, STARTING_EXP);
    const nextAvailable = Math.max(0, nextEarned - character.experience.totalSpent);
    const nextKarma = whole(karma, character.karma, 0);
    if (character.experience.available === nextAvailable && character.experience.totalEarned === nextEarned && character.karma === nextKarma) return false;
    character.experience.available = nextAvailable;
    character.experience.totalEarned = nextEarned;
    character.karma = nextKarma;
    character.updatedAt = new Date().toISOString();
    vault[index] = normalizeCharacter(character);
    writeVault(vault);
    if (draft?.id === characterId) draft = clone(vault[index]);
    window.dispatchEvent(new CustomEvent("vector-characters-changed", { detail: { id: characterId } }));
    return true;
  }

  function encounterPayload(characterId) {
    const character = getCharacter(characterId);
    if (!character) return null;
    return {
      characterId: character.id,
      experience: clone(character.experience),
      karma: character.karma,
      poiseMax: character.poise.max,
      coreLost: 10 - character.damage.core.current,
      hasEngagedCombat: character.hasEngagedCombat,
      stats: {
        strength: character.attributes.strength,
        dexterity: character.attributes.dexterity,
        health: character.attributes.health,
        intellect: character.attributes.intellect,
        perception: character.attributes.perception,
        charisma: character.attributes.charisma,
        initiative: character.skills.initiative,
        composure: character.skills.composure,
        firearms: character.skills.firearms,
        melee: character.skills.melee,
        dodge: character.skills.dodge,
      },
      character,
    };
  }

  function finalAttributeScore(attributeResult, skill, coreLost) {
    return Number(attributeResult || 0) + Number(skill || 0) - whole(coreLost, 0, 0, 10);
  }

  function markEngaged(characterId) {
    if (!characterId) return false;
    const vault = loadVault();
    const index = vault.findIndex((character) => character.id === characterId);
    if (index < 0 || vault[index].hasEngagedCombat) return false;
    vault[index].hasEngagedCombat = true;
    vault[index].updatedAt = new Date().toISOString();
    writeVault(vault);
    if (draft?.id === characterId) draft.hasEngagedCombat = true;
    window.dispatchEvent(new CustomEvent("vector-characters-changed", { detail: { id: characterId, reason: "combat-history" } }));
    render();
    return true;
  }

  function setCombatContext(next = {}) {
    combatContext = { characterId: String(next.characterId || ""), advancementLocked: Boolean(next.advancementLocked) };
    render();
  }

  function createFromEncounter(unit) {
    const character = createCharacter();
    character.name = String(unit?.characterName || "New Vector").slice(0, 40);
    character.color = /^#[0-9a-f]{6}$/i.test(String(unit?.color || "")) ? unit.color : character.color;
    for (const attribute of attributes) {
      if (unit?.stats?.[attribute.key] !== undefined) character.attributes[attribute.key] = whole(unit.stats[attribute.key], 2, 2, 20);
    }
    for (const skill of skills) {
      if (unit?.stats?.[skill.key] !== undefined) character.skills[skill.key] = whole(unit.stats[skill.key], 0, 0, 999);
    }
    character.karma = whole(unit?.karma, 0, 0);
    character.poise = { current: whole(unit?.poiseRemaining, 3, 0, 99), max: whole(unit?.poiseMax, 3, 1, 99) };
    character.damage.core.current = 10 - whole(unit?.coreLost, 0, 0, 10);
    character.hasEngagedCombat = Boolean(unit?.hasEngagedCombat);
    character.finalized = true;
    character.savedBuild = buildCheckpoint(character);
    draft = normalizeCharacter(character);
    sessionUndo = [];
    activeTab = "attributes";
    persistNow("Saved locally");
    render();
    return clone(draft);
  }

  function bindEvents() {
    elements.characterBack.addEventListener("click", () => { persistNow(); window.dispatchEvent(new CustomEvent("vector-character-close")); });
    elements.characterNew.addEventListener("click", openNew);
    elements.characterSavedSelect.addEventListener("change", () => openCharacter(elements.characterSavedSelect.value));
    elements.characterSave.addEventListener("click", saveCharacter);
    elements.characterExport.addEventListener("click", exportCharacter);
    elements.characterImport.addEventListener("click", () => elements.characterImportFile.click());
    elements.characterImportFile.addEventListener("change", () => importCharacter(elements.characterImportFile.files?.[0]));
    elements.characterUndo.addEventListener("click", undoLastPurchase);
    elements.characterRevert.addEventListener("click", revertToLastSave);
    elements.characterReset.addEventListener("click", resetBuild);
    elements.characterInfo.addEventListener("click", () => { activeTab = "info"; renderTabs(); });
    elements.characterInfoClose.addEventListener("click", () => { activeTab = "attributes"; renderTabs(); });
    elements.characterTabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-character-tab]");
      if (!button) return;
      activeTab = button.dataset.characterTab;
      renderTabs();
    });
    elements.characterAttributeGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-buy-attribute]");
      if (button) buyAttribute(button.dataset.buyAttribute);
    });
    elements.characterSkillList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-buy-skill]");
      if (button) buySkill(button.dataset.buySkill);
    });
    elements.characterSkillSearch.addEventListener("input", renderSkills);
    elements.characterDamageTracks.addEventListener("click", (event) => {
      const button = event.target.closest("[data-damage-layer]");
      if (!button) return;
      const layer = draft.damage[button.dataset.damageLayer];
      if (!layer?.active) return;
      layer.current = clamp(layer.current + Number(button.dataset.damageChange), 0, 10);
      schedulePersist();
      renderVitals();
    });
    elements.characterNetworkRatings.addEventListener("click", (event) => {
      const button = event.target.closest("[data-network-rating]");
      if (!button) return;
      const key = button.dataset.networkRating;
      draft.network.ratings[key] = clamp(draft.network.ratings[key] + Number(button.dataset.networkChange), 0, 10);
      schedulePersist();
      renderNetwork();
    });
    elements.characterNetworkRatings.addEventListener("change", (event) => {
      const input = event.target.closest("[data-network-input]");
      if (!input) return;
      draft.network.ratings[input.dataset.networkInput] = whole(input.value, 0, 0, 10);
      schedulePersist();
      renderNetwork();
    });
    elements.characterSheetName.addEventListener("input", () => { draft.name = elements.characterSheetName.value.slice(0, 40); schedulePersist(); });
    elements.characterSheetColor.addEventListener("input", () => { draft.color = elements.characterSheetColor.value; schedulePersist(); render(); });
    elements.characterVectorScore.addEventListener("change", () => { draft.network.vectorScore = whole(elements.characterVectorScore.value, 0, 0, 999); schedulePersist(); renderNetwork(); });
    elements.characterAffiliations.addEventListener("input", () => { draft.network.affiliations = elements.characterAffiliations.value.slice(0, 10000); schedulePersist(); });
    elements.characterAchievements.addEventListener("input", () => { draft.network.achievements = elements.characterAchievements.value.slice(0, 10000); schedulePersist(); });
  }

  draft = listCharacters()[0] || createCharacter();
  elements.characterSaveState.textContent = getCharacter(draft.id) ? (draft.finalized ? "Saved locally" : "Local draft") : "Unsaved character";
  bindEvents();
  render();

  window.VectorCharacters = {
    attributes: clone(attributes),
    skills: clone(skills),
    openNew,
    openCharacter,
    list: () => listCharacters().map(clone),
    get: (characterId) => { const character = getCharacter(characterId); return character ? clone(character) : null; },
    encounterPayload,
    syncEconomy,
    markEngaged,
    setCombatContext,
    createFromEncounter,
    dicePoolForRating,
    attributeUpgradeCost,
    skillUpgradeCost: (skillKey, character) => {
      const definition = skills.find((skill) => skill.key === skillKey);
      return definition ? skillUpgradeCost(definition, character || draft) : null;
    },
    finalAttributeScore,
  };
})();
