let calls = [];
let units = [
  { id: 'unit-12', name: 'Unit 12', status: 'available' },
  { id: 'unit-45', name: 'Unit 45', status: 'available' },
  { id: 'unit-7', name: 'Unit 7', status: 'available' },
  { id: 'unit-3', name: 'Unit 3', status: 'available' }
];

let selectedCallId = null;

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
}

// Clear all calls
function clearCalls() {
  calls = [];
  units.forEach(u => u.status = 'available');
  selectedCallId = null;
  renderUnits();
  renderCalls();
}

// Render calls
function renderCalls() {
  const callList = document.getElementById("callList");
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
      badge.className = 'assigned-unit';
      badge.innerText = unit.name;

      // click to unassign
      badge.onclick = (e) => {
        e.stopPropagation();
        unassignUnitFromCall(unitId, c.id);
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
    });

    // click to select active call
    card.onclick = () => {
      selectedCallId = c.id === selectedCallId ? null : c.id;
      updateActiveCallDisplay();
      renderCalls();
    };

    card.appendChild(title);
    card.appendChild(assigned);

    callList.appendChild(card);
  });

  updateActiveCallDisplay();
}

function updateActiveCallDisplay() {
  const el = document.getElementById('activeCall');
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
  unitList.innerHTML = "";

  units.forEach(u => {
    const div = document.createElement("div");
    div.className = "unit" + (u.status === 'busy' ? ' busy' : '');
    div.innerText = u.name;
    div.dataset.id = u.id;

    // only draggable when available
    if (u.status === 'available') {
      div.draggable = true;
      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", u.id);
        // small visual hint
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

  call.assignedUnits.push(unitId);
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

  gen.addEventListener('click', generateCall);
  clear.addEventListener('click', clearCalls);
}

// init
initControls();
renderUnits();
renderCalls();
