// Get DOM elements
const zoomLevelDisplay = document.getElementById('zoom-level');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const togglePipButton = document.getElementById('toggle-pip');
const collapseButton = document.getElementById('collapse');
const pipContainer = document.getElementById('pip-container');
const pipCanvas = document.getElementById('pip-canvas');

// State variables
let currentZoomLevel = 1.0;
let isPipActive = false;
let isDraggingPip = false;
let pipApp = null; // PIXI application
let pipTexture = null; // PIXI texture for the video snapshot
let pipSprite = null; // PIXI sprite for the video
let zoomRectGraphics = null; // PIXI graphics for the zoom rectangle
let pipContext = null; // Canvas 2D context (fallback)
let pipImage = null; // For Canvas 2D fallback
let usePixi = false; // Flag to indicate if we're using PIXI.js
let videoWidth = 3840;
let videoHeight = 2160;
let zoomState = {
    zoom: 1.0,
    centerX: 1920,
    centerY: 1080,
    canvasWidth: 3840,
    canvasHeight: 2160
};

// Set initial display state for pipContainer
pipContainer.style.display = 'none';

// Initialize Canvas 2D context as fallback
function initializeCanvas2D() {
    console.log('Initializing Canvas 2D for PiP');
    pipContext = pipCanvas.getContext('2d');
    pipCanvas.width = 210;
    pipCanvas.height = 118;
    
    // Draw initial gray background
    pipContext.fillStyle = '#222';
    pipContext.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
    pipContext.fillStyle = '#555';
    pipContext.font = '12px Arial';
    pipContext.textAlign = 'center';
    pipContext.fillText('Waiting for snapshot...', pipCanvas.width / 2, pipCanvas.height / 2);
    
    usePixi = false;
}

// Initialize PiP canvas with PIXI.js
function initializePixiCanvas() {
    try {
        if (typeof PIXI === 'undefined') {
            throw new Error('PIXI.js not loaded');
        }
        
        // Create PIXI application
        pipApp = new PIXI.Application({
            width: 210,
            height: 118,
            view: pipCanvas,
            backgroundColor: 0x222222,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true
        });
        
        // Create container for our elements
        const container = new PIXI.Container();
        pipApp.stage.addChild(container);
        
        // Create initial texture and sprite
        createInitialTexture();
        
        // Create zoom rectangle graphics
        zoomRectGraphics = new PIXI.Graphics();
        container.addChild(zoomRectGraphics);
        
        // Draw initial zoom rectangle
        updateZoomRectangle();
        
        console.log('PiP canvas initialized with PIXI.js');
        usePixi = true;
    } catch (error) {
        console.error('Error initializing PIXI.js for PiP:', error);
        initializeCanvas2D();
    }
}

// Create initial texture with a placeholder
function createInitialTexture() {
    if (!usePixi || !pipApp) return;
    
    try {
        // Create a graphics object for initial placeholder
        const graphics = new PIXI.Graphics();
        graphics.beginFill(0x333333);
        graphics.drawRect(0, 0, 210, 118);
        graphics.endFill();
        
        // Add text to the placeholder
        const style = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 12,
            fill: '#555555'
        });
        const text = new PIXI.Text('Waiting for snapshot...', style);
        text.anchor.set(0.5);
        text.x = 210 / 2;
        text.y = 118 / 2;
        graphics.addChild(text);
        
        // Create RenderTexture from the graphics
        const renderTexture = PIXI.RenderTexture.create({
            width: 210,
            height: 118
        });
        pipApp.renderer.render(graphics, renderTexture);
        
        // Create sprite from the render texture
        pipSprite = new PIXI.Sprite(renderTexture);
        pipApp.stage.addChild(pipSprite);
    } catch (error) {
        console.error('Error creating initial texture:', error);
    }
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
    console.log('Updating PiP state to:', isActive);
    
    // Only update if state actually changed
    if (isPipActive !== isActive) {
        isPipActive = isActive;
        togglePipButton.style.backgroundColor = isActive ? '#4CAF50' : '#555';
        pipContainer.style.display = isActive ? 'block' : 'none';
        
        // Force a reflow/redraw to ensure style changes apply immediately
        void pipContainer.offsetWidth;
        
        // Log the actual display style after setting it
        console.log('PiP container display style is now:', pipContainer.style.display);
        console.log('PiP container visibility check:', pipContainer.offsetWidth > 0 ? 'visible' : 'hidden');
        
        if (isActive) {
            // Initialize PiP canvas if needed when becoming active
            if (!usePixi && !pipContext) {
                initializeCanvas2D();
            } else if (usePixi && !pipApp) {
                initializePixiCanvas();
            }
        }
    } else {
        console.log('PiP state unchanged, already:', isActive ? 'active' : 'inactive');
    }
}

// Update zoom rectangle based on current zoom state
function updateZoomRectangle() {
    if (!isPipActive) return;
    
    if (usePixi && pipApp && zoomRectGraphics) {
        // PIXI.js implementation
        try {
            // Clear previous rectangle
            zoomRectGraphics.clear();
            
            // Calculate zoom rectangle dimensions as a percentage of PiP canvas
            const zoom = zoomState.zoom;
            const rectWidth = pipCanvas.width / zoom;
            const rectHeight = pipCanvas.height / zoom;
            
            // Calculate position based on center coordinates
            const scaleX = pipCanvas.width / videoWidth;
            const scaleY = pipCanvas.height / videoHeight;
            
            // Calculate rectangle position (centered on the zoom center)
            const rectCenterX = zoomState.centerX * scaleX;
            const rectCenterY = zoomState.centerY * scaleY;
            const rectX = rectCenterX - (rectWidth / 2);
            const rectY = rectCenterY - (rectHeight / 2);
            
            // Draw the zoom rectangle
            zoomRectGraphics.lineStyle(2, 0x4CAF50, 1);
            zoomRectGraphics.beginFill(0x4CAF50, 0.15);
            zoomRectGraphics.drawRect(rectX, rectY, rectWidth, rectHeight);
            zoomRectGraphics.endFill();
        } catch (error) {
            console.error('Error updating zoom rectangle with PIXI.js:', error);
        }
    } else if (pipContext) {
        // Canvas 2D implementation (fallback)
        // Clear canvas and redraw original image if available
        if (pipImage) {
            pipContext.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
            pipContext.drawImage(pipImage, 0, 0, pipCanvas.width, pipCanvas.height);
        }
        
        // Calculate zoom rectangle dimensions
        const zoom = zoomState.zoom;
        const rectWidth = pipCanvas.width / zoom;
        const rectHeight = pipCanvas.height / zoom;
        
        // Calculate position based on center coordinates
        const scaleX = pipCanvas.width / videoWidth;
        const scaleY = pipCanvas.height / videoHeight;
        
        const rectCenterX = zoomState.centerX * scaleX;
        const rectCenterY = zoomState.centerY * scaleY;
        const rectX = rectCenterX - (rectWidth / 2);
        const rectY = rectCenterY - (rectHeight / 2);
        
        // Draw rectangle
        pipContext.strokeStyle = '#4CAF50';
        pipContext.lineWidth = 2;
        pipContext.strokeRect(rectX, rectY, rectWidth, rectHeight);
        
        // Draw semi-transparent fill
        pipContext.fillStyle = 'rgba(76, 175, 80, 0.15)';
        pipContext.fillRect(rectX, rectY, rectWidth, rectHeight);
    }
}

// Process and display a frame in the PiP canvas
function displayPipFrame(dataURL) {
    if (!isPipActive) return;
    
    if (usePixi && pipApp && pipApp.stage) {
        // PIXI.js implementation
        try {
            // Create or update texture with plain Image approach instead of PIXI.Texture.fromURL
            const img = new Image();
            img.onload = () => {
                try {
                    if (!pipTexture) {
                        // Create new texture from the loaded image
                        pipTexture = PIXI.Texture.from(img);
                        
                        // Remove placeholder sprite if it exists
                        if (pipSprite) {
                            pipApp.stage.removeChild(pipSprite);
                        }
                        
                        // Create sprite from texture
                        pipSprite = new PIXI.Sprite(pipTexture);
                        pipSprite.width = pipCanvas.width;
                        pipSprite.height = pipCanvas.height;
                        pipApp.stage.addChild(pipSprite);
                        
                        // Add zoom rectangle on top
                        pipApp.stage.addChild(zoomRectGraphics);
                    } else {
                        // Update existing texture
                        const baseTexture = PIXI.BaseTexture.from(img);
                        pipTexture.baseTexture = baseTexture;
                        pipTexture.update();
                    }
                    
                    // Update zoom rectangle
                    updateZoomRectangle();
                } catch (err) {
                    console.error('Error updating PIXI texture:', err);
                    // Fall back to Canvas2D if PIXI texture handling fails
                    usePixi = false;
                    initializeCanvas2D();
                    displayPipFrameCanvas2D(dataURL);
                }
            };
            img.src = dataURL;
        } catch (error) {
            console.error('Error displaying frame with PIXI.js:', error);
            usePixi = false;
            initializeCanvas2D();
            displayPipFrameCanvas2D(dataURL);
        }
    } else {
        // Canvas 2D implementation (fallback)
        displayPipFrameCanvas2D(dataURL);
    }
}

// Fallback Canvas2D implementation for displaying frames
function displayPipFrameCanvas2D(dataURL) {
    // Create a new image from the data URL
    const img = new Image();
    img.onload = () => {
        // Clear the canvas
        pipContext.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
        
        // Draw the image scaled to fit the canvas
        pipContext.drawImage(img, 0, 0, pipCanvas.width, pipCanvas.height);
        
        // Save reference to image for potential redraws
        pipImage = img;
        
        // Redraw the zoom rectangle
        updateZoomRectangle();
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

// Handle zoom state update from main renderer
function handleZoomStateUpdate(newZoomState) {
    zoomState = newZoomState;
    updateZoomRectangle();
}

// Set up event listeners for buttons
let lastButtonClickTime = 0;
const BUTTON_DEBOUNCE_TIME = 250; // ms

zoomInButton.addEventListener('click', () => {
    console.log('Zoom in clicked');
    window.panelAPI.zoomIn();
});

zoomOutButton.addEventListener('click', () => {
    console.log('Zoom out clicked');
    window.panelAPI.zoomOut();
});

togglePipButton.addEventListener('click', () => {
    // Debounce rapid clicks
    const now = performance.now();
    if (now - lastButtonClickTime < BUTTON_DEBOUNCE_TIME) {
        console.log('Ignoring PiP toggle click - too soon after previous click');
        return;
    }
    lastButtonClickTime = now;
    
    console.log('Toggle PiP clicked, current state:', isPipActive);
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
    updateZoomRectangle();
});

window.panelAPI.onZoomStateUpdate((newZoomState) => {
    console.log('Received zoom state update');
    handleZoomStateUpdate(newZoomState);
});

// Initialize - start with Canvas2D for reliability
document.addEventListener('DOMContentLoaded', () => {
    console.log('Panel DOM loaded');
    
    // First initialize with Canvas2D for reliability
    initializeCanvas2D();
    
    // Then try to load PIXI.js
    try {
        // Load PIXI.js from CDN
        const pixiScript = document.createElement('script');
        pixiScript.src = 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.8/dist/browser/pixi.min.js';
        pixiScript.onload = () => {
            console.log('PIXI.js loaded successfully');
            // Wait a bit to make sure PIXI is fully initialized
            setTimeout(() => {
                try {
                    if (typeof PIXI !== 'undefined') {
                        console.log('PIXI is defined, version:', PIXI.VERSION);
                        initializePixiCanvas();
                    } else {
                        console.warn('PIXI is not defined after script load');
                    }
                } catch (err) {
                    console.error('Error initializing PIXI after load:', err);
                }
            }, 100);
        };
        pixiScript.onerror = (err) => {
            console.error('Failed to load PIXI.js:', err);
            // Already using Canvas2D
        };
        document.head.appendChild(pixiScript);
    } catch (err) {
        console.error('Error loading PIXI.js:', err);
        // Already using Canvas2D
    }
    
    updateZoomLevelDisplay(currentZoomLevel);
    updatePipState(isPipActive);
}); 