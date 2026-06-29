// Live CAD with cross-tab sync (BroadcastChannel + localStorage fallback)
let calls = [];
let units = [];
let unitMap = new Map(); // index for O(1) lookups
let callMap = new Map();
let selectedCallId = null;
let activeCountdowns = new Set(); // track which countdowns need updating

const STORAGE_KEY = 'dispatch-cad-state';
const CHANNEL_NAME = 'dispatch-cad';
const SENDER_ID = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random());
let bc = null;
let timerInterval = null;
let syncDebounceTimer = null;
const SYNC_DEBOUNCE_MS = 300; // batch updates

// --- Unit presets -------------------------------------------------------
const UNIT_PRESETS = [
  { id: 'unit-12', name: 'Unit 12', type: 'police', status: 'available' },
  { id: 'unit-45', name: 'Unit 45', type: 'ems', status: 'available' },
  { id: 'unit-7', name: 'Unit 7', type: 'fire', status: 'available' },
  { id: 'unit-3', name: 'Unit 3', type: 'police', status: 'available' }
];

// --- Helpers ---------------------------------------------------------------
function formatTimeLeft(ms) {
  if (ms <= 0) return '0s';
  const s = Math.ceil(ms / 1000);
  if (s >= 60) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return s + 's';
}

function preferredTypeForCall(callText) {
  const t = callText.toLowerCase();
  if (t.includes('medical') || t.includes('accident')) return 'ems';
  if (t.includes('fire') || t.includes('structure')) return 'fire';
  if (t.includes('robbery') || t.includes('suspicious')) return 'police';
  return 'police';
}

function baseDurationForType(type) {
  // base seconds
  if (type === 'ems') return 120;
  if (type === 'fire') return 180;
  return 90; // police/default
}

function computeAssignmentDuration(callText, unitType) {
  const pref = preferredTypeForCall(callText);
  const base = baseDurationForType(unitType);
  // small random variation +/-20%
  const variance = 0.2; // 20%
  const rand = 1 + (Math.random() * 2 - 1) * variance;
  let dur = base * rand;
  // faster if unit matches preferred
  if (unitType === pref) dur *= 0.8;
  return Math.max(10, Math.round(dur)) * 1000; // ms
}

// --- Index management ---------------------------------------------------
function rebuildIndices() {
  unitMap.clear();
  callMap.clear();
  units.forEach(u => unitMap.set(u.id, u));
  calls.forEach(c => callMap.set(c.id, c));
}

// --- Persistence & Sync ------------------------------------------------
function debouncedSaveAndBroadcast() {
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    saveStateAndBroadcast();
  }, SYNC_DEBOUNCE_MS);
}

function saveStateAndBroadcast() {
  const state = { calls, units, selectedCallId };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('localStorage set failed', e);
  }

  if (bc) {
    bc.postMessage({ type: 'state-update', state, sender: SENDER_ID });
  }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.calls) calls = parsed.calls;
      if (parsed.units) units = parsed.units;
      selectedCallId = parsed.selectedCallId || null;
    } else {
      units = JSON.parse(JSON.stringify(UNIT_PRESETS));
    }
  } catch (e) {
    console.warn('localStorage read failed', e);
    units = JSON.parse(JSON.stringify(UNIT_PRESETS));
  }
  rebuildIndices();
}

function initSyncChannels() {
  if ('BroadcastChannel' in window) {
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (ev) => {
        const m = ev.data;
        if (!m || m.sender === SENDER_ID) return; // ignore own messages
        if (m.type === 'state-update') {
          applyExternalState(m.state);
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel init failed', e);
      bc = null;
    }
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    if (!ev.newValue) return;
    try {
      const parsed = JSON.parse(ev.newValue);
      applyExternalState(parsed);
    } catch (e) { /* ignore */ }
  });
}

function applyExternalState(state) {
  if (!state) return;
  calls = state.calls || [];
  units = state.units || [];
  selectedCallId = state.selectedCallId || null;
  rebuildIndices();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ calls, units, selectedCallId })); } catch (e) {}
  render();
}

// --- Timers & Tick -------------------------------------------------------
function tickCountdowns() {
  const now = Date.now();
  // Only update active countdowns
  activeCountdowns.forEach(countdownId => {
    const el = document.getElementById(countdownId);
    if (!el) {
      activeCountdowns.delete(countdownId);
      return;
    }
    const ends = Number(el.dataset.ends);
    if (!ends) {
      el.textContent = '';
      activeCountdowns.delete(countdownId);
      return;
    }
    const left = ends - now;
    if (left <= 0) {
      el.textContent = ' — 0s';
    } else {
      el.textContent = ' — ' + formatTimeLeft(left);
    }
  });
}

function startTimerLoop() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    let changed = false;
    const now = Date.now();

    calls.forEach(c => {
      if (!c.assignedUnits) return;
      const remaining = c.assignedUnits.filter(assign => {
        const endsAt = (typeof assign === 'string') ? null : assign.endsAt;
        if (endsAt && now >= endsAt) {
          const unitId = (typeof assign === 'string') ? assign : assign.unitId;
          unassignUnitFromCall(unitId, c.id, { save: false });
          changed = true;
          return false; // remove this assignment
        }
        return true; // keep it
      });
      c.assignedUnits = remaining;
    });

    if (changed) {
      rebuildIndices();
      debouncedSaveAndBroadcast();
      updateCallCards();
    }

    // update countdown text
    tickCountdowns();
  }, 1000);
}

function stopTimerLoop() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- Rendering (optimized) -----------------------------------------------
function render() {
  renderCalls();
  renderUnits();
  updateActiveCallDisplay();
}

function renderCalls() {
  const callList = document.getElementById("callList");
  if (!callList) return;

  // Clear and rebuild (unavoidable for structure changes, but kept minimal)
  callList.innerHTML = "";
  activeCountdowns.clear();

  calls.forEach(c => {
    const card = document.createElement("div");
    card.className = "call-card";
    card.dataset.id = c.id;

    if (c.id === selectedCallId) card.classList.add('selected');

    const title = document.createElement('div');
    title.className = 'call-title';
    title.innerText = c.call;

    const preferred = preferredTypeForCall(c.call);
    const prefNote = document.createElement('div');
    prefNote.className = 'call-pref';
    prefNote.innerText = 'Preferred: ' + (preferred ? preferred.toUpperCase() : 'ANY');
    prefNote.dataset.type = preferred;

    // assigned units container
    const assigned = document.createElement('div');
    assigned.className = 'assigned-list';

    (c.assignedUnits || []).forEach((assign, idx) => {
      const unitId = (typeof assign === 'string') ? assign : assign.unitId;
      const unit = unitMap.get(unitId); // O(1) lookup
      if (!unit) return;

      const badge = document.createElement('span');
      badge.className = 'assigned-unit ' + (unit.type || '');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'assigned-name';
      nameSpan.innerText = unit.name;
      badge.appendChild(nameSpan);

      // countdown span
      const countdown = document.createElement('span');
      const countdownId = `countdown-${c.id}-${unitId}-${idx}`;
      countdown.id = countdownId;
      countdown.className = 'countdown';
      if (assign && typeof assign === 'object' && assign.endsAt) {
        countdown.dataset.ends = assign.endsAt;
        activeCountdowns.add(countdownId);
        const left = assign.endsAt - Date.now();
        countdown.textContent = ' — ' + formatTimeLeft(left);
      } else {
        countdown.textContent = '';
      }
      badge.appendChild(countdown);

      // click to unassign (event delegation would be better, but this is minimal)
      badge.onclick = (e) => {
        e.stopPropagation();
        unassignUnitFromCall(unitId, c.id);
        debouncedSaveAndBroadcast();
      };

      assigned.appendChild(badge);
    });

    // drag handlers on card
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const unitId = e.dataTransfer.getData('text/plain');
      if (!unitId) return;

      const unit = unitMap.get(unitId);
      if (!unit) return;

      if (unit.status === 'busy') {
        alert(unit.name + ' is already assigned.');
        return;
      }

      // compute duration based on call and unit type
      const duration = computeAssignmentDuration(c.call, unit.type);
      const endsAt = Date.now() + duration;
      c.assignedUnits = c.assignedUnits || [];
      c.assignedUnits.push({ unitId, assignedAt: Date.now(), duration, endsAt });

      // mark busy
      unit.status = 'busy';

      render();
      debouncedSaveAndBroadcast();
    });

    // click to select active call
    card.onclick = () => {
      selectedCallId = c.id === selectedCallId ? null : c.id;
      updateActiveCallDisplay();
      // Only update call cards, not units
      const sel = document.querySelectorAll('.call-card.selected');
      sel.forEach(el => el.classList.remove('selected'));
      if (selectedCallId === c.id) card.classList.add('selected');
      debouncedSaveAndBroadcast();
    };

    card.appendChild(title);
    card.appendChild(prefNote);
    card.appendChild(assigned);

    callList.appendChild(card);
  });
}

// Incremental update for call cards (called from timer)
function updateCallCards() {
  calls.forEach(c => {
    const card = document.querySelector(`[data-id="${c.id}"]`);
    if (!card) return;

    const assigned = card.querySelector('.assigned-list');
    if (!assigned) return;

    assigned.innerHTML = '';

    (c.assignedUnits || []).forEach((assign, idx) => {
      const unitId = (typeof assign === 'string') ? assign : assign.unitId;
      const unit = unitMap.get(unitId);
      if (!unit) return;

      const badge = document.createElement('span');
      badge.className = 'assigned-unit ' + (unit.type || '');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'assigned-name';
      nameSpan.innerText = unit.name;
      badge.appendChild(nameSpan);

      const countdown = document.createElement('span');
      const countdownId = `countdown-${c.id}-${unitId}-${idx}`;
      countdown.id = countdownId;
      countdown.className = 'countdown';
      if (assign && typeof assign === 'object' && assign.endsAt) {
        countdown.dataset.ends = assign.endsAt;
        activeCountdowns.add(countdownId);
        const left = assign.endsAt - Date.now();
        countdown.textContent = ' — ' + formatTimeLeft(left);
      }
      badge.appendChild(countdown);

      badge.onclick = (e) => {
        e.stopPropagation();
        unassignUnitFromCall(unitId, c.id);
        debouncedSaveAndBroadcast();
      };

      assigned.appendChild(badge);
    });
  });
}

function updateActiveCallDisplay() {
  const el = document.getElementById('activeCall');
  if (!el) return;
  if (!selectedCallId) {
    el.innerText = 'No active selection';
  } else {
    const c = callMap.get(selectedCallId);
    el.innerText = c ? ('Selected: ' + c.call) : 'No active selection';
  }
}

function renderUnits() {
  const unitList = document.getElementById("unitList");
  if (!unitList) return;
  unitList.innerHTML = "";

  units.forEach(u => {
    const div = document.createElement("div");
    div.className = "unit" + (u.status === 'busy' ? ' busy' : '');
    div.dataset.id = u.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'unit-name';
    nameSpan.innerText = u.name;

    const typeSpan = document.createElement('span');
    typeSpan.className = 'unit-type ' + (u.type || '');
    typeSpan.innerText = (u.type || '').toUpperCase();

    div.appendChild(nameSpan);
    div.appendChild(typeSpan);

    // only draggable when available
    if (u.status === 'available') {
      div.draggable = true;
      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", u.id);
        e.dataTransfer.effectAllowed = 'move';
      });
    } else {
      div.draggable = false;
    }

    unitList.appendChild(div);
  });
}

// --- Actions ---------------------------------------------------------------
function generateCall() {
  const callTypes = [
    "Robbery in progress",
    "Medical emergency",
    "Structure fire",
    "Traffic accident",
    "Suspicious activity"
  ];

  const callText = callTypes[Math.floor(Math.random() * callTypes.length)];
  const id = Date.now().toString();

  const newCall = { id, call: callText, assignedUnits: [] };
  calls.unshift(newCall);
  callMap.set(id, newCall);

  renderCalls();
  debouncedSaveAndBroadcast();
}

function clearCalls() {
  calls = [];
  units.forEach(u => u.status = 'available');
  selectedCallId = null;
  rebuildIndices();
  render();
  debouncedSaveAndBroadcast();
}

function assignUnitToCall(unitId, callId) {
  const call = callMap.get(callId);
  const unit = unitMap.get(unitId);
  if (!call || !unit) return;

  // compute duration
  const duration = computeAssignmentDuration(call.call, unit.type);
  const endsAt = Date.now() + duration;

  call.assignedUnits = call.assignedUnits || [];
  const unitIds = new Set(call.assignedUnits.map(a => (typeof a === 'string' ? a : a.unitId)));
  if (!unitIds.has(unitId)) {
    call.assignedUnits.push({ unitId, assignedAt: Date.now(), duration, endsAt });
  }
  unit.status = 'busy';

  render();
  debouncedSaveAndBroadcast();
}

function unassignUnitFromCall(unitId, callId, opts = { save: true }) {
  const call = callMap.get(callId);
  const unit = unitMap.get(unitId);
  if (!call || !unit) return;

  call.assignedUnits = (call.assignedUnits || []).filter(a => (typeof a === 'string' ? a : a.unitId) !== unitId);
  unit.status = 'available';

  // Immediately update the card to reflect change
  updateCallCards();
  renderUnits();
  if (opts.save) debouncedSaveAndBroadcast();
}

// --- Init ----------------------------------------------------------------
function initControls() {
  const gen = document.getElementById('generateBtn');
  const clear = document.getElementById('clearBtn');

  if (gen) gen.addEventListener('click', generateCall);
  if (clear) clear.addEventListener('click', clearCalls);
}

// Startup
loadStateFromStorage();
initSyncChannels();
initControls();
startTimerLoop();
render();
