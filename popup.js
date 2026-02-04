// Parse interval string (e.g., "2h", "30m", "1d") to milliseconds
function parseInterval(intervalStr) {
  const match = intervalStr.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i);
  if (!match) {
    throw new Error('Invalid interval format. Use: 30m, 1h, 2h, 1d, etc.');
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'w': 7 * 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

// Parse datetime string to Date object
function parseDateTime(dateTimeStr) {
  // Format: YYYY-MM-DD HH:MM:SS
  const str = dateTimeStr.trim();
  const date = new Date(str.replace(' ', 'T'));

  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format. Use: YYYY-MM-DD HH:MM:SS');
  }

  return date;
}

// Format Date to display string
function formatDateTime(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// State
let state = {
  startTime: null,
  intervalMs: 2 * 60 * 60 * 1000, // 2h default
  currentFrom: null,
  currentTo: null
};

// DOM elements
const startTimeInput = document.getElementById('startTime');
const intervalInput = document.getElementById('interval');
const rangeFromDisplay = document.getElementById('rangeFrom');
const rangeToDisplay = document.getElementById('rangeTo');
const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');
const btnApply = document.getElementById('btnApply');
const btnReset = document.getElementById('btnReset');
const statusEl = document.getElementById('status');

// Show status message
function showStatus(message, type = 'success') {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  setTimeout(() => {
    statusEl.className = 'status';
  }, 3000);
}

// Update range display
function updateRangeDisplay() {
  if (state.currentFrom && state.currentTo) {
    rangeFromDisplay.textContent = formatDateTime(state.currentFrom);
    rangeToDisplay.textContent = formatDateTime(state.currentTo);
  } else {
    rangeFromDisplay.textContent = '-';
    rangeToDisplay.textContent = '-';
  }
}

// Save state to storage
function saveState() {
  chrome.storage.local.set({
    grafanaRangeState: {
      startTime: state.startTime ? state.startTime.toISOString() : null,
      intervalMs: state.intervalMs,
      currentFrom: state.currentFrom ? state.currentFrom.toISOString() : null,
      currentTo: state.currentTo ? state.currentTo.toISOString() : null,
      startTimeInput: startTimeInput.value,
      intervalInput: intervalInput.value
    }
  });
}

// Get start of current hour
function getStartOfCurrentHour() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return now;
}

// Load state from storage
function loadState() {
  chrome.storage.local.get(['grafanaRangeState'], (result) => {
    if (result.grafanaRangeState) {
      const saved = result.grafanaRangeState;
      state.startTime = saved.startTime ? new Date(saved.startTime) : null;
      state.intervalMs = saved.intervalMs || 2 * 60 * 60 * 1000;
      state.currentFrom = saved.currentFrom ? new Date(saved.currentFrom) : null;
      state.currentTo = saved.currentTo ? new Date(saved.currentTo) : null;

      if (saved.startTimeInput) startTimeInput.value = saved.startTimeInput;
      if (saved.intervalInput) intervalInput.value = saved.intervalInput;

      updateRangeDisplay();
    } else {
      // Default: start of current hour
      const startOfHour = getStartOfCurrentHour();
      startTimeInput.value = formatDateTime(startOfHour);
    }
  });
}

// Apply range to Grafana
async function applyToGrafana() {
  if (!state.currentFrom || !state.currentTo) {
    showStatus('Set a range first', 'error');
    return;
  }

  const fromMs = state.currentFrom.getTime();
  const toMs = state.currentTo.getTime();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      showStatus('Failed to get tab URL', 'error');
      return;
    }

    const url = new URL(tab.url);

    // Check if this is Grafana Explore (has panes parameter with nested range)
    if (url.searchParams.has('panes')) {
      // Grafana Explore format: range is inside panes JSON
      const panesJson = url.searchParams.get('panes');
      const panes = JSON.parse(panesJson);

      // Update range in all panes
      for (const paneKey in panes) {
        if (panes[paneKey] && panes[paneKey].range) {
          panes[paneKey].range.from = fromMs.toString();
          panes[paneKey].range.to = toMs.toString();
        }
      }

      url.searchParams.set('panes', JSON.stringify(panes));
    } else {
      // Classic Grafana dashboard format: from/to in root params
      url.searchParams.set('from', fromMs.toString());
      url.searchParams.set('to', toMs.toString());
    }

    // Navigate using chrome.tabs.update
    await chrome.tabs.update(tab.id, { url: url.toString() });
  } catch (error) {
    console.error('Apply error:', error);
    showStatus(`Error: ${error.message}`, 'error');
  }
}

// Initialize range from input
function initializeRange() {
  try {
    state.startTime = parseDateTime(startTimeInput.value);
    state.intervalMs = parseInterval(intervalInput.value);
    state.currentFrom = state.startTime;
    state.currentTo = new Date(state.startTime.getTime() + state.intervalMs);
    updateRangeDisplay();
    saveState();
    return true;
  } catch (error) {
    showStatus(error.message, 'error');
    return false;
  }
}

// Move backward
function moveBackward() {
  if (!state.currentFrom) {
    if (!initializeRange()) return;
  }

  try {
    state.intervalMs = parseInterval(intervalInput.value);
  } catch (error) {
    showStatus(error.message, 'error');
    return;
  }

  state.currentTo = new Date(state.currentFrom.getTime());
  state.currentFrom = new Date(state.currentFrom.getTime() - state.intervalMs);

  updateRangeDisplay();
  saveState();
  applyToGrafana();
}

// Move forward
function moveForward() {
  if (!state.currentTo) {
    if (!initializeRange()) return;
    applyToGrafana();
    return;
  }

  try {
    state.intervalMs = parseInterval(intervalInput.value);
  } catch (error) {
    showStatus(error.message, 'error');
    return;
  }

  state.currentFrom = new Date(state.currentTo.getTime());
  state.currentTo = new Date(state.currentTo.getTime() + state.intervalMs);

  updateRangeDisplay();
  saveState();
  applyToGrafana();
}

// Reset state
function resetState() {
  const startOfHour = getStartOfCurrentHour();
  state = {
    startTime: null,
    intervalMs: 2 * 60 * 60 * 1000,
    currentFrom: null,
    currentTo: null
  };
  startTimeInput.value = formatDateTime(startOfHour);
  intervalInput.value = '2h';
  updateRangeDisplay();
  chrome.storage.local.remove(['grafanaRangeState']);
}

// Apply current settings
function applySettings() {
  if (initializeRange()) {
    applyToGrafana();
  }
}

// Event listeners
btnBack.addEventListener('click', moveBackward);
btnForward.addEventListener('click', moveForward);
btnApply.addEventListener('click', applySettings);
btnReset.addEventListener('click', resetState);

// Save inputs on change
startTimeInput.addEventListener('change', () => {
  if (startTimeInput.value) {
    try {
      state.startTime = parseDateTime(startTimeInput.value);
      state.currentFrom = state.startTime;
      state.currentTo = new Date(state.startTime.getTime() + state.intervalMs);
      updateRangeDisplay();
      saveState();
    } catch (e) {
      // Ignore parse errors while typing
    }
  }
});

intervalInput.addEventListener('change', () => {
  try {
    state.intervalMs = parseInterval(intervalInput.value);
    if (state.currentFrom) {
      state.currentTo = new Date(state.currentFrom.getTime() + state.intervalMs);
      updateRangeDisplay();
    }
    saveState();
  } catch (e) {
    // Ignore parse errors while typing
  }
});

// Initialize
loadState();
