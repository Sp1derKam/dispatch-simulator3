let calls = [];
let units = ["Unit 12", "Unit 45", "Unit 7", "Unit 3"];

let selectedCall = null;

// Generate call
function generateCall() {
  const callTypes = [
    "Robbery in progress",
    "Medical emergency",
    "Structure fire",
    "Traffic accident",
    "Suspicious activity"
  ];

  const call = callTypes[Math.floor(Math.random() * callTypes.length)];
  const id = Date.now();

  calls.push({ id, call });

  renderCalls();
}

// Render calls
function renderCalls() {
  const callList = document.getElementById("callList");
  callList.innerHTML = "";

  calls.forEach(c => {
    const div = document.createElement("div");
    div.className = "call";
    div.innerText = c.call;

    div.onclick = () => selectCall(c);

    callList.appendChild(div);
  });
}

// Select call
function selectCall(call) {
  selectedCall = call;
  document.getElementById("activeCall").innerText = "Selected: " + call.call;
}

// Render units (DRAGGABLE)
function renderUnits() {
  const unitList = document.getElementById("unitList");
  unitList.innerHTML = "";

  units.forEach(u => {
    const div = document.createElement("div");
    div.className = "unit";
    div.innerText = u;

    div.draggable = true;

    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text", u);
    });

    unitList.appendChild(div);
  });
}

// Drop zone logic
const dropZone = document.getElementById("dropZone");

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();

  const unit = e.dataTransfer.getData("text");

  if (!selectedCall) {
    alert("Select a call first!");
    return;
  }

  dropZone.innerText = `${unit} dispatched to: ${selectedCall.call}`;

  // remove call after dispatch
  calls = calls.filter(c => c.id !== selectedCall.id);
  selectedCall = null;

  renderCalls();
});

// init
renderUnits();
renderCalls();
