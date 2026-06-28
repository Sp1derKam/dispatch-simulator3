// Live CAD with cross-tab sync (BroadcastChannel + localStorage fallback)
let calls = [];
let units = [
  { id: 'unit-12', name: 'Unit 12', type: 'police', status: 'available' },
  { id: 'unit-45', name: 'Unit 45', type: 'ems', status: 'available' },
  { id: 'unit-7', name: 'Unit 7', type: 'fire', status: 'available' },
  { id: 'unit-3', name: 'Unit 3', type: 'police', status: 'available' }
];

let selectedCallId = null;
const STORAGE_KEY = 'dispatch-cad-state';
const CHANNEL_NAME = 'dispatch-cad';
const SENDER_ID = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random());
let bc = null;
let timerInterval = null;

// --- Helpers --------------------------------------------------------------
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

// --- Persistence & Sync ---------------------------------------------------
function saveStateAndBroadcast() {
  const state = { calls, units, selectedCallId }; // calls now may include assignment objects
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
    }
  } catch (e) {
    console.warn('localStorage read failed', e);
  }
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ calls, units, selectedCallId })); } catch (e) {}
  renderUnits();
  renderCalls();
}

// --- Timers & Tick -------------------------------------------------------
function startTimerLoop() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    let changed = false;
    const now = Date.now();
    // iterate calls and their assignedUnits (objects with unitId, endsAt)
    calls.forEach(c => {
      if (!Array.isArray(c.assignedUnits)) return;
      // filter expired assignments
      c.assignedUnits.slice().forEach(assign => {
        const unitId = (typeof assign === 'string') ? assign : assign.unitId;
        const endsAt = (typeof assign === 'string') ? null : assign.endsAt;
        if (endsAt && now >= endsAt) {
          // auto-unassign
          unassignUnitFromCall(unitId, c.id, {save:false});
          changed = true;
        }
      });
    });
    if (changed) saveStateAndBroadcast();
    // update UI countdowns
    renderCalls();
    renderUnits();
  }, 1000);
}

function stopTimerLoop() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// --- Actions --------------------------------------------------------------
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

  calls.unshift({ id, call: callText, assignedUnits: [] });

  renderCalls();
  saveStateAndBroadcast();
}

function clearCalls() {
  calls = [];
  units.forEach(u => u.status = 'available');
  selectedCallId = null;
  renderUnits();
  renderCalls();
  saveStateAndBroadcast();
}

function renderCalls() {
  const callList = document.getElementById("callList");
  if (!callList) return;
  callList.innerHTML = "";

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

    (c.assignedUnits || []).forEach(assign => {
      const unitId = (typeof assign === 'string') ? assign : assign.unitId;
      const unit = units.find(u => u.id === unitId);
      if (!unit) return;
      const badge = document.createElement('span');
      badge.className = 'assigned-unit ' + (unit.type || '');
      // compute remaining
      let remainingText = '';
      if (assign && typeof assign === 'object' && assign.endsAt) {
        const left = assign.endsAt - Date.now();
        remainingText = ' — ' + formatTimeLeft(left);
      }
      badge.innerText = unit.name + remainingText;

      // click to unassign
      badge.onclick = (e) => {
        e.stopPropagation();
        unassignUnitFromCall(unitId, c.id);
        saveStateAndBroadcast();
      };

      assigned.appendChild(badge);
    });

    // make each call card a drop target
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

      const unit = units.find(u => u.id === unitId);
      if (!unit) return;

      if (unit.status === 'busy') {
        alert(unit.name + ' is already assigned.');
        return;
      }

      // compute duration based on call and unit type
      const duration = computeAssignmentDuration(c.call, unit.type);
      const endsAt = Date.now() + duration;
      // push assignment object
      c.assignedUnits = c.assignedUnits || [];
      c.assignedUnits.push({ unitId, assignedAt: Date.now(), duration, endsAt });

      // mark busy
      unit.status = 'busy';

      renderUnits();
      renderCalls();
      saveStateAndBroadcast();
    });

    // click to select active call
    card.onclick = () => {
      selectedCallId = c.id === selectedCallId ? null : c.id;
      updateActiveCallDisplay();
      renderCalls();
      saveStateAndBroadcast();
    };

    card.appendChild(title);
    card.appendChild(prefNote);
    card.appendChild(assigned);

    callList.appendChild(card);
  });

  updateActiveCallDisplay();
}

function updateActiveCallDisplay() {
  const el = document.getElementById('activeCall');
  if (!el) return;
  if (!selectedCallId) {
    el.innerText = 'No active selection';
  } else {
    const c = calls.find(cc => cc.id === selectedCallId);
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

function assignUnitToCall(unitId, callId) {
  const call = calls.find(c => c.id === callId);
  const unit = units.find(u => u.id === unitId);
  if (!call || !unit) return;

  // compute duration
  const duration = computeAssignmentDuration(call.call, unit.type);
  const endsAt = Date.now() + duration;

  call.assignedUnits = call.assignedUnits || [];
  if (!call.assignedUnits.find(a => (typeof a === 'string' ? a : a.unitId) === unitId)) {
    call.assignedUnits.push({ unitId, assignedAt: Date.now(), duration, endsAt });
  }
  unit.status = 'busy';

  renderUnits();
  renderCalls();
  saveStateAndBroadcast();
}

function unassignUnitFromCall(unitId, callId, opts = {save:true}) {
  const call = calls.find(c => c.id === callId);
  const unit = units.find(u => u.id === unitId);
  if (!call || !unit) return;

  call.assignedUnits = (call.assignedUnits || []).filter(a => (typeof a === 'string' ? a : a.unitId) !== unitId);
  unit.status = 'available';

  renderUnits();
  renderCalls();
  if (opts.save) saveStateAndBroadcast();
}

// init controls
function initControls() {
  const gen = document.getElementById('generateBtn');
  const clear = document.getElementById('clearBtn');

  if (gen) gen.addEventListener('click', generateCall);
  if (clear) clear.addEventListener('click', clearCalls);
}

// init
loadStateFromStorage();
initSyncChannels();
initControls();
startTimerLoop();
renderUnits();
renderCalls();
