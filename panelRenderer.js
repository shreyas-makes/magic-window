// Get DOM elements
const zoomLevelDisplay = document.getElementById('zoom-level');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const togglePipButton = document.getElementById('toggle-pip');
const collapseButton = document.getElementById('collapse');

// State variables
let currentZoomLevel = 1.0;
let isPipActive = false;

// Format zoom level for display
function formatZoomLevel(level) {
    return `${level.toFixed(1)}x`;
}

// Update zoom level display
function updateZoomLevelDisplay(level) {
    currentZoomLevel = level;
    zoomLevelDisplay.textContent = formatZoomLevel(level);
}

// Update PiP button state
function updatePipState(isActive) {
    isPipActive = isActive;
    togglePipButton.style.backgroundColor = isActive ? '#4CAF50' : '#555';
}

// Set up event listeners for buttons
zoomInButton.addEventListener('click', () => {
    console.log('Zoom in clicked');
    window.panelAPI.zoomIn();
});

zoomOutButton.addEventListener('click', () => {
    console.log('Zoom out clicked');
    window.panelAPI.zoomOut();
});

togglePipButton.addEventListener('click', () => {
    console.log('Toggle PiP clicked');
    window.panelAPI.togglePip();
});

collapseButton.addEventListener('click', () => {
    console.log('Collapse clicked');
    window.panelAPI.collapse();
});

// Set up listeners for updates from main process
window.panelAPI.onUpdateZoomLevel((level) => {
    console.log('Received zoom level update:', level);
    updateZoomLevelDisplay(level);
});

window.panelAPI.onUpdatePipState((isActive) => {
    console.log('Received PiP state update:', isActive);
    updatePipState(isActive);
});

// Initialize display
updateZoomLevelDisplay(currentZoomLevel);
updatePipState(isPipActive); 