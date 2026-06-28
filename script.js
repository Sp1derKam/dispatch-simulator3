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

// --- Persistence & Sync ---------------------------------------------------
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
      calls = parsed.calls || calls;
      units = parsed.units || units;
      selectedCallId = parsed.selectedCallId || null;
    }
  } catch (e) {
    console.warn('localStorage read failed', e);
  }
}

function initSyncChannels() {
  // BroadcastChannel if available
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

  // storage event fallback
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
  // Overwrite local state with incoming state
  calls = state.calls || [];
  units = state.units || [];
  selectedCallId = state.selectedCallId || null;
  // save locally (but don't broadcast again)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ calls, units, selectedCallId })); } catch (e) {}
  renderUnits();
  renderCalls();
}

// --- Actions --------------------------------------------------------------
// Generate call
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

// Clear all calls
function clearCalls() {
  calls = [];
  units.forEach(u => u.status = 'available');
  selectedCallId = null;
  renderUnits();
  renderCalls();
  saveStateAndBroadcast();
}

// Render calls
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

    // assigned units container
    const assigned = document.createElement('div');
    assigned.className = 'assigned-list';

    c.assignedUnits.forEach(unitId => {
      const unit = units.find(u => u.id === unitId);
      if (!unit) return;
      const badge = document.createElement('span');
      badge.className = 'assigned-unit ' + (unit.type || '');
      badge.innerText = unit.name;

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

      assignUnitToCall(unitId, c.id);
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

// Render units (DRAGGABLE)
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

  // avoid duplicate
  if (!call.assignedUnits.includes(unitId)) call.assignedUnits.push(unitId);
  unit.status = 'busy';

  // reflect immediately
  renderUnits();
  renderCalls();
}

function unassignUnitFromCall(unitId, callId) {
  const call = calls.find(c => c.id === callId);
  const unit = units.find(u => u.id === unitId);
  if (!call || !unit) return;

  call.assignedUnits = call.assignedUnits.filter(id => id !== unitId);
  unit.status = 'available';

  renderUnits();
  renderCalls();
}

// initialize controls
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
renderUnits();
renderCalls();
