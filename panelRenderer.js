// Get DOM elements
const zoomLevelDisplay = document.getElementById('zoom-level');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const togglePipButton = document.getElementById('toggle-pip');
const collapseButton = document.getElementById('collapse');
const pipContainer = document.getElementById('pip-container');
const pipCanvas = document.getElementById('pip-canvas');
const zoomRectangle = document.getElementById('zoom-rectangle');

// State variables
let currentZoomLevel = 1.0;
let isPipActive = false;
let isDraggingPip = false;
let pipContext = null;
let pipImage = null;
let videoWidth = 3840;
let videoHeight = 2160;

// Initialize PiP canvas
function initializePipCanvas() {
    // Set canvas resolution (consider a lower resolution for performance)
    pipCanvas.width = 210;
    pipCanvas.height = 118;
    
    // Get 2D context
    pipContext = pipCanvas.getContext('2d');
    
    // Draw initial gray background
    pipContext.fillStyle = '#222';
    pipContext.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
    pipContext.fillStyle = '#555';
    pipContext.font = '12px Arial';
    pipContext.textAlign = 'center';
    pipContext.fillText('Waiting for snapshot...', pipCanvas.width / 2, pipCanvas.height / 2);
}

// Format zoom level for display
function formatZoomLevel(level) {
    return `${level.toFixed(1)}x`;
}

// Update zoom level display
function updateZoomLevelDisplay(level) {
    currentZoomLevel = level;
    zoomLevelDisplay.textContent = formatZoomLevel(level);
    updateZoomRectangle();
}

// Update PiP button state
function updatePipState(isActive) {
    isPipActive = isActive;
    togglePipButton.style.backgroundColor = isActive ? '#4CAF50' : '#555';
    pipContainer.style.display = isActive ? 'block' : 'none';
}

// Update zoom rectangle position and size based on current zoom level
function updateZoomRectangle() {
    if (!isPipActive) return;
    
    // Calculate zoom rectangle dimensions as a percentage of PiP canvas
    const rectWidth = (pipCanvas.width / currentZoomLevel);
    const rectHeight = (pipCanvas.height / currentZoomLevel);
    
    // Center the rectangle by default
    const rectX = (pipCanvas.width - rectWidth) / 2;
    const rectY = (pipCanvas.height - rectHeight) / 2;
    
    // Update rectangle position and size
    zoomRectangle.style.width = `${rectWidth}px`;
    zoomRectangle.style.height = `${rectHeight}px`;
    zoomRectangle.style.left = `${rectX}px`;
    zoomRectangle.style.top = `${rectY}px`;
}

// Process and display a frame in the PiP canvas
function displayPipFrame(dataURL) {
    if (!pipContext || !isPipActive) return;
    
    // Create a new image from the data URL
    const img = new Image();
    img.onload = () => {
        // Clear the canvas
        pipContext.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
        
        // Draw the image scaled to fit the canvas
        pipContext.drawImage(img, 0, 0, pipCanvas.width, pipCanvas.height);
        
        // Save reference to image for potential redraws
        pipImage = img;
    };
    img.src = dataURL;
}

// Convert PiP canvas coordinates to main video coordinates
function pipToVideoCoordinates(pipX, pipY) {
    const scaleX = videoWidth / pipCanvas.width;
    const scaleY = videoHeight / pipCanvas.height;
    
    const videoX = pipX * scaleX;
    const videoY = pipY * scaleY;
    
    return { x: videoX, y: videoY };
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

// PiP canvas interaction events
pipCanvas.addEventListener('mousedown', (event) => {
    if (!isPipActive) return;
    
    isDraggingPip = true;
    
    // Get click position relative to the canvas
    const rect = pipCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to video coordinates
    const videoCoords = pipToVideoCoordinates(x, y);
    
    // Send new center coordinates to main renderer
    window.panelAPI.setZoomCenter(videoCoords.x, videoCoords.y);
});

pipCanvas.addEventListener('mousemove', (event) => {
    if (!isPipActive || !isDraggingPip) return;
    
    // Get mouse position relative to the canvas
    const rect = pipCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to video coordinates
    const videoCoords = pipToVideoCoordinates(x, y);
    
    // Send new center coordinates to main renderer
    window.panelAPI.setZoomCenter(videoCoords.x, videoCoords.y);
});

pipCanvas.addEventListener('mouseup', () => {
    isDraggingPip = false;
});

pipCanvas.addEventListener('mouseleave', () => {
    isDraggingPip = false;
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

window.panelAPI.onPipFrameUpdate((dataURL) => {
    console.log('Received PiP frame update');
    displayPipFrame(dataURL);
});

window.panelAPI.onVideoSizeUpdate((width, height) => {
    console.log(`Received video size update: ${width}x${height}`);
    videoWidth = width;
    videoHeight = height;
});

// Initialize
initializePipCanvas();
updateZoomLevelDisplay(currentZoomLevel);
updatePipState(isPipActive); 