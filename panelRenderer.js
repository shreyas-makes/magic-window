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

// Border effect variables
const BORDER_COLORS = [0xFF5F1F, 0xFF1F8E, 0x8A2BE2]; // Orange/coral → pink → purple
let borderPulseTime = 0; // Time counter for pulsing animation
let lastFrameTime = 0; // For animation timing

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
            
            // Create the pulsing effect (value between 0.3 and 1.0)
            const now = performance.now();
            const deltaTime = now - lastFrameTime;
            lastFrameTime = now;
            
            borderPulseTime += deltaTime / 1000;
            const pulseAlpha = 0.3 + (Math.sin(borderPulseTime * 2) * 0.35 + 0.35);
            const lineWidth = 2; // Line thickness appropriate for the PiP size
            
            // Draw the zoom rectangle with gradient border
            const gradientSteps = 8; // Number of steps for the gradient effect
            
            for (let i = 0; i < gradientSteps; i++) {
                // Calculate gradient color and alpha
                const ratio = i / (gradientSteps - 1);
                
                // Blend between the colors in BORDER_COLORS
                let color;
                if (ratio < 0.5) {
                    // Blend between first and second color
                    const blendRatio = ratio * 2;
                    color = blendColors(BORDER_COLORS[0], BORDER_COLORS[1], blendRatio);
                } else {
                    // Blend between second and third color
                    const blendRatio = (ratio - 0.5) * 2;
                    color = blendColors(BORDER_COLORS[1], BORDER_COLORS[2], blendRatio);
                }
                
                // Draw a segment of the border
                zoomRectGraphics.lineStyle(lineWidth, color, pulseAlpha);
                
                // Calculate segment position - draw clockwise starting from top-left
                if (i < gradientSteps / 4) {
                    // Top segment
                    const segmentRatio = i / (gradientSteps / 4);
                    const segmentX = rectX + rectWidth * segmentRatio;
                    zoomRectGraphics.moveTo(segmentX, rectY);
                    zoomRectGraphics.lineTo(Math.min(segmentX + rectWidth / (gradientSteps / 4), rectX + rectWidth), rectY);
                } else if (i < gradientSteps / 2) {
                    // Right segment
                    const segmentRatio = (i - gradientSteps / 4) / (gradientSteps / 4);
                    const segmentY = rectY + rectHeight * segmentRatio;
                    zoomRectGraphics.moveTo(rectX + rectWidth, segmentY);
                    zoomRectGraphics.lineTo(rectX + rectWidth, Math.min(segmentY + rectHeight / (gradientSteps / 4), rectY + rectHeight));
                } else if (i < 3 * gradientSteps / 4) {
                    // Bottom segment
                    const segmentRatio = (i - gradientSteps / 2) / (gradientSteps / 4);
                    const segmentX = rectX + rectWidth - rectWidth * segmentRatio;
                    zoomRectGraphics.moveTo(segmentX, rectY + rectHeight);
                    zoomRectGraphics.lineTo(Math.max(segmentX - rectWidth / (gradientSteps / 4), rectX), rectY + rectHeight);
                } else {
                    // Left segment
                    const segmentRatio = (i - 3 * gradientSteps / 4) / (gradientSteps / 4);
                    const segmentY = rectY + rectHeight - rectHeight * segmentRatio;
                    zoomRectGraphics.moveTo(rectX, segmentY);
                    zoomRectGraphics.lineTo(rectX, Math.max(segmentY - rectHeight / (gradientSteps / 4), rectY));
                }
            }
            
            // Request animation frame to continuously update the pulsing effect
            requestAnimationFrame(updateZoomRectangle);
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
        
        // Create the pulsing effect
        const now = performance.now();
        const deltaTime = now - lastFrameTime;
        lastFrameTime = now;
        
        borderPulseTime += deltaTime / 1000;
        const pulseAlpha = 0.3 + (Math.sin(borderPulseTime * 2) * 0.35 + 0.35);
        
        // For Canvas 2D, we'll use a simpler approach - we'll just change colors 
        // along the rectangle to simulate a gradient
        const gradientSteps = 4; // Fewer steps for Canvas 2D
        const lineWidth = 2;
        
        // Define the 4 corners of the rectangle
        const corners = [
            { x: rectX, y: rectY }, // Top-left
            { x: rectX + rectWidth, y: rectY }, // Top-right
            { x: rectX + rectWidth, y: rectY + rectHeight }, // Bottom-right
            { x: rectX, y: rectY + rectHeight } // Bottom-left
        ];
        
        // Draw each side with a different color from the gradient
        for (let i = 0; i < gradientSteps; i++) {
            const ratio = i / (gradientSteps - 1);
            
            // Get color based on position in the gradient
            let color;
            if (ratio < 0.5) {
                const blendRatio = ratio * 2;
                color = blendColorsRgba(BORDER_COLORS[0], BORDER_COLORS[1], blendRatio, pulseAlpha);
            } else {
                const blendRatio = (ratio - 0.5) * 2;
                color = blendColorsRgba(BORDER_COLORS[1], BORDER_COLORS[2], blendRatio, pulseAlpha);
            }
            
            // Convert hex color to rgba string for Canvas 2D
            pipContext.strokeStyle = color;
            pipContext.lineWidth = lineWidth;
            
            // Draw one side of the rectangle
            const startIdx = i;
            const endIdx = (i + 1) % 4;
            
            pipContext.beginPath();
            pipContext.moveTo(corners[startIdx].x, corners[startIdx].y);
            pipContext.lineTo(corners[endIdx].x, corners[endIdx].y);
            pipContext.stroke();
        }
        
        // Request animation frame to continuously update the pulsing effect
        requestAnimationFrame(updateZoomRectangle);
    }
}

// Helper function to blend between two colors for PIXI
function blendColors(color1, color2, ratio) {
    // Extract RGB components
    const r1 = (color1 >> 16) & 0xFF;
    const g1 = (color1 >> 8) & 0xFF;
    const b1 = color1 & 0xFF;
    
    const r2 = (color2 >> 16) & 0xFF;
    const g2 = (color2 >> 8) & 0xFF;
    const b2 = color2 & 0xFF;
    
    // Blend the colors
    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);
    
    // Combine into a single color value
    return (r << 16) | (g << 8) | b;
}

// Helper function to blend between two colors for Canvas 2D context (returns rgba string)
function blendColorsRgba(color1, color2, ratio, alpha) {
    // Extract RGB components
    const r1 = (color1 >> 16) & 0xFF;
    const g1 = (color1 >> 8) & 0xFF;
    const b1 = color1 & 0xFF;
    
    const r2 = (color2 >> 16) & 0xFF;
    const g2 = (color2 >> 8) & 0xFF;
    const b2 = color2 & 0xFF;
    
    // Blend the colors
    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);
    
    // Return rgba string
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Function to display a frame in the PiP window
function displayPipFrame(dataURL) {
    // Validate and display the incoming PIP frame
    console.log(`[${new Date().toISOString()}] PiP frame received: ${Math.round(dataURL?.length / 1024) || 0}KB`);
  
    if (!dataURL) {
        console.error('Received empty dataURL for PiP frame');
        return;
    }
    
    if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:image')) {
        console.warn('Invalid PiP frame data received');
        return;
    }
    
    // Make sure PiP container is visible
    if (pipContainer.style.display !== 'block' && isPipActive) {
        console.log('Ensuring PiP container is visible');
        pipContainer.style.display = 'block';
    }

    try {
        if (usePixi && pipApp && pipSprite) {
            // PIXI.js implementation
            // Create an image element to load the data URL
            const img = new Image();
            img.onload = () => {
                try {
                    // If we have an existing texture, destroy it
                    if (pipTexture && pipTexture.baseTexture) {
                        pipTexture.destroy(true);
                    }
                    
                    // Create a new texture from the loaded image
                    pipTexture = PIXI.Texture.from(img);
                    
                    // Update the sprite with the new texture
                    pipSprite.texture = pipTexture;
                    
                    // Adjust sprite dimensions to fit the canvas
                    pipSprite.width = pipCanvas.width;
                    pipSprite.height = pipCanvas.height;
                    
                    // Redraw the zoom rectangle
                    updateZoomRectangle();
                    
                    console.log('Updated PiP sprite with new frame');
                } catch (err) {
                    console.error('Error updating PiP texture:', err);
                }
            };
            img.onerror = (err) => {
                console.error('Error loading PiP image:', err);
            };
            img.src = dataURL;
        } else {
            // Canvas 2D fallback
            displayPipFrameCanvas2D(dataURL);
        }
    } catch (error) {
        console.error('Error displaying PiP frame:', error);
        // Fall back to Canvas2D if PIXI fails
        displayPipFrameCanvas2D(dataURL);
    }
}

// Canvas 2D fallback implementation for PiP frame display
function displayPipFrameCanvas2D(dataURL) {
    if (!pipContext) {
        // Initialize Canvas2D context if not already done
        initializeCanvas2D();
    }
    
    try {
        // Create an image if we don't already have one
        if (!pipImage) {
            pipImage = new Image();
        }
        
        // Set up image load handler
        pipImage.onload = () => {
            try {
                // Clear the canvas
                pipContext.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
                
                // Draw the image
                pipContext.drawImage(pipImage, 0, 0, pipCanvas.width, pipCanvas.height);
                
                // Draw the zoom rectangle if needed
                if (zoomState.zoom > 1.0) {
                    // Calculate rectangle dimensions
                    const rectWidth = pipCanvas.width / zoomState.zoom;
                    const rectHeight = pipCanvas.height / zoomState.zoom;
                    
                    // Calculate center position
                    const scaleX = pipCanvas.width / videoWidth;
                    const scaleY = pipCanvas.height / videoHeight;
                    const rectCenterX = zoomState.centerX * scaleX;
                    const rectCenterY = zoomState.centerY * scaleY;
                    
                    // Calculate top-left corner
                    const rectX = rectCenterX - (rectWidth / 2);
                    const rectY = rectCenterY - (rectHeight / 2);
                    
                    // Draw rectangle
                    pipContext.strokeStyle = 'rgba(255, 95, 31, 0.8)';
                    pipContext.lineWidth = 2;
                    pipContext.strokeRect(rectX, rectY, rectWidth, rectHeight);
                }
                
                console.log('Updated PiP canvas with new frame');
            } catch (err) {
                console.error('Error drawing PiP image to canvas:', err);
            }
        };
        
        // Load the image
        pipImage.src = dataURL;
    } catch (error) {
        console.error('Error in Canvas2D PiP frame display:', error);
    }
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