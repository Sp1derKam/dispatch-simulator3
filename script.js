let currentCall = null;

const calls = [
  "Robbery in progress at downtown store",
  "House fire reported on Oak Street",
  "Medical emergency: unconscious person",
  "Car accident on Highway 6",
  "Suspicious person reported in neighborhood"
];

function generateCall() {
  const randomIndex = Math.floor(Math.random() * calls.length);
  currentCall = calls[randomIndex];

  document.getElementById("callText").innerText = currentCall;
}

function dispatch(unit) {
  if (!currentCall) {
    alert("No active call!");
    return;
  }

  alert(`${unit} dispatched to: ${currentCall}`);

  currentCall = null;
  document.getElementById("callText").innerText = "No active call";
}
