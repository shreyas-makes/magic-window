// This file runs in the renderer process
// Import path module from Node.js through the preload script
const path = { sep: '/' }; // Simple path separator for use in the renderer

// Reference GSAP and FXAA from global window variables (loaded from CDN)
// No need to import since we're loading from CDN in the HTML
// import gsap from 'gsap';
// import { FXAAFilter } from '@pixi/filter-fxaa';

// Canvas and recording variables
let app = null; // PIXI application
let videoSprite = null; // PIXI sprite for video
let mediaRecorder = null; // MediaRecorder instance
let recordedChunks = []; // Array to hold recorded chunks
let sourceVideo = null; // Source video element
let canvasStream = null; // Stream from canvas
let usePixi = false; // Whether to use PIXI.js or fallback to canvas API
let canvasContext = null; // Canvas 2D context (for fallback renderer)
let animationFrameId = null; // For cancelAnimationFrame in fallback renderer
let isRecording = false; // Whether we're currently recording
let isPaused = false; // Whether recording is paused

// Border effect variables
let borderGraphics = null; // PIXI graphics for border effect
const BORDER_COLORS = [0xFF5F1F, 0xFF1F8E, 0x8A2BE2]; // Orange/coral → pink → purple
let borderPulseTime = 0; // Time counter for pulsing animation

// Zoom state management
const state = {
    currentZoom: 1.0,
    currentCenterX: 1920,
    currentCenterY: 1080,
    targetZoom: 1.0,
    targetCenterX: 1920,
    targetCenterY: 1080
};

// FXAA filter state
let fxaaFilter = null;
let fxaaEnabled = false;

// Timer variables
let timerInterval = null;
let secondsElapsed = 0;

// Define zoom presets
const zoomPresets = [1.0, 1.5, 2.0, 4.0];
let currentPresetIndex = 0;

// Add PiP state and snapshot throttling variables
let isPipVisible = false;
let lastPipUpdateTime = 0;
const PIP_UPDATE_INTERVAL = 250; // Update PiP every 250ms
let pipSnapshotInterval = null;

// Performance monitoring variables
let frameTimeHistory = [];
const MAX_FRAME_HISTORY = 120; // 2 seconds at 60fps
let lastPerformanceLog = 0;
const PERFORMANCE_LOG_INTERVAL = 10000; // Log every 10 seconds

// Enhanced performance monitoring system
const performanceMetrics = {
  frameCount: 0,
  lastFrameTime: 0,
  frameTimes: [],
  fpsHistory: [],
  droppedFrames: 0,
  expectedFrameInterval: 1000 / 60, // ~16.67ms for 60fps
  heapSizeHistory: [],
  startTime: 0,
  isRecording: false,
  zoomOperations: 0,
  lastFpsUpdate: 0,
  fpsUpdateInterval: 500, // Update FPS display every 500ms
};

// Track frame times and calculate metrics
function trackFrameTime(operation = 'render') {
  const now = performance.now();
  
  // Initialize timing on first call
  if (performanceMetrics.startTime === 0) {
    performanceMetrics.startTime = now;
    performanceMetrics.lastFrameTime = now;
    return;
  }
  
  // Calculate time since last frame
  const frameTime = now - performanceMetrics.lastFrameTime;
  performanceMetrics.lastFrameTime = now;
  
  // Track for moving average (keep last 60 frames)
  performanceMetrics.frameTimes.push(frameTime);
  if (performanceMetrics.frameTimes.length > 60) {
    performanceMetrics.frameTimes.shift();
  }
  
  // Detect dropped frames (if frame time > 150% of expected time)
  if (frameTime > performanceMetrics.expectedFrameInterval * 1.5) {
    const estimatedDroppedFrames = Math.floor(frameTime / performanceMetrics.expectedFrameInterval) - 1;
    performanceMetrics.droppedFrames += estimatedDroppedFrames;
    
    // Log significant frame drops during recording
    if (performanceMetrics.isRecording && estimatedDroppedFrames > 2) {
      console.warn(`Potential ${estimatedDroppedFrames} dropped frames detected: ${frameTime.toFixed(1)}ms frame time`);
    }
  }
  
  // Count frames
  performanceMetrics.frameCount++;
  
  // Update FPS calculation periodically
  if (now - performanceMetrics.lastFpsUpdate > performanceMetrics.fpsUpdateInterval) {
    const secondsElapsed = (now - performanceMetrics.lastFpsUpdate) / 1000;
    const fps = performanceMetrics.frameCount / secondsElapsed;
    
    // Reset frame count
    performanceMetrics.frameCount = 0;
    performanceMetrics.lastFpsUpdate = now;
    
    // Update FPS history
    performanceMetrics.fpsHistory.push(fps);
    if (performanceMetrics.fpsHistory.length > 20) {
      performanceMetrics.fpsHistory.shift();
    }
    
    // Update UI if available
    updatePerformanceUI();
  }
  
  // Track memory usage every second
  if (now % 1000 < 20) {
    if (window.performance && window.performance.memory) {
      const heapSize = window.performance.memory.usedJSHeapSize;
      performanceMetrics.heapSizeHistory.push(heapSize);
      
      // Keep last 30 seconds of data
      if (performanceMetrics.heapSizeHistory.length > 30) {
        performanceMetrics.heapSizeHistory.shift();
      }
    }
  }
  
  // Track zoom operations
  if (operation.includes('zoom') || operation.includes('pan')) {
    performanceMetrics.zoomOperations++;
  }
}

// Function to calculate current performance metrics
function getPerformanceStats() {
  const avgFrameTime = performanceMetrics.frameTimes.length > 0 
    ? performanceMetrics.frameTimes.reduce((a, b) => a + b, 0) / performanceMetrics.frameTimes.length 
    : 0;
  
  const avgFps = performanceMetrics.fpsHistory.length > 0
    ? performanceMetrics.fpsHistory.reduce((a, b) => a + b, 0) / performanceMetrics.fpsHistory.length
    : 0;
  
  const totalFrames = performanceMetrics.frameTimes.length + performanceMetrics.droppedFrames;
  const dropRate = totalFrames > 0 ? (performanceMetrics.droppedFrames / totalFrames) * 100 : 0;
  
  // Calculate memory growth if we have enough data
  let memoryGrowth = 0;
  if (performanceMetrics.heapSizeHistory.length > 10) {
    const initial = performanceMetrics.heapSizeHistory[0];
    const current = performanceMetrics.heapSizeHistory[performanceMetrics.heapSizeHistory.length - 1];
    memoryGrowth = current - initial;
  }
  
  return {
    avgFrameTime: avgFrameTime.toFixed(2),
    avgFps: avgFps.toFixed(1),
    droppedFrames: performanceMetrics.droppedFrames,
    dropRate: dropRate.toFixed(2),
    heapSize: window.performance && window.performance.memory ? 
      formatBytes(window.performance.memory.usedJSHeapSize) : 'N/A',
    memoryGrowth: formatBytes(memoryGrowth),
    elapsedTime: ((performance.now() - performanceMetrics.startTime) / 1000).toFixed(0),
    zoomOperations: performanceMetrics.zoomOperations
  };
}

// Update performance metrics display
function updatePerformanceUI() {
  const stats = getPerformanceStats();
  const perfPanel = document.getElementById('performance-metrics');
  
  if (!perfPanel) return;
  
  // Format metrics for display
  perfPanel.innerHTML = `
    <div class="metric ${parseFloat(stats.avgFps) < 55 ? 'warning' : ''}">FPS: ${stats.avgFps}</div>
    <div class="metric ${parseFloat(stats.avgFrameTime) > 20 ? 'warning' : ''}">Frame: ${stats.avgFrameTime}ms</div>
    <div class="metric ${parseFloat(stats.dropRate) > 0.5 ? 'warning' : ''}">Drops: ${stats.droppedFrames} (${stats.dropRate}%)</div>
    <div class="metric">Mem: ${stats.heapSize}</div>
  `;
}

// Start performance monitoring
function startPerformanceMonitoring(isRecording = false) {
  // Reset metrics
  performanceMetrics.frameCount = 0;
  performanceMetrics.lastFrameTime = performance.now();
  performanceMetrics.frameTimes = [];
  performanceMetrics.droppedFrames = 0;
  performanceMetrics.startTime = performance.now();
  performanceMetrics.isRecording = isRecording;
  performanceMetrics.lastFpsUpdate = performance.now();
  
  // Create performance UI if it doesn't exist
  if (!document.getElementById('performance-metrics')) {
    const perfPanel = document.createElement('div');
    perfPanel.id = 'performance-metrics';
    perfPanel.className = 'performance-panel';
    document.body.appendChild(perfPanel);
    
    // Add styles if not already present
    if (!document.getElementById('performance-metrics-style')) {
      const style = document.createElement('style');
      style.id = 'performance-metrics-style';
      style.textContent = `
        .performance-panel {
          position: fixed;
          bottom: 10px;
          left: 10px;
          background: rgba(0, 0, 0, 0.7);
          color: white;
          padding: 8px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          z-index: 9999;
          display: flex;
          gap: 10px;
        }
        .metric.warning {
          color: #ff9800;
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  console.log(`Performance monitoring ${isRecording ? 'during recording ' : ''}started`);
}

// Function to format seconds as HH:MM:SS
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return [hours, minutes, secs]
    .map(val => val.toString().padStart(2, '0'))
    .join(':');
}

// Debug logging function with optional condition to reduce console noise
function debugLog(message, condition = true) {
  if (condition) {
    console.log(`[DEBUG] ${message}`);
  }
}

// Function to start the timer
function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  const timerDisplay = document.getElementById('timer-display');
  timerInterval = setInterval(() => {
    secondsElapsed++;
    timerDisplay.textContent = formatTime(secondsElapsed);
  }, 1000);
}

// Function to pause the timer
function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Function to reset the timer
function resetTimer() {
  pauseTimer();
  secondsElapsed = 0;
  const timerDisplay = document.getElementById('timer-display');
  timerDisplay.textContent = formatTime(secondsElapsed);
}

// Function to format bytes to human-readable form
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0 || bytes === 'N/A') return 'N/A';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

// Function to update disk space UI
function updateDiskSpaceUI(data) {
  const diskSpaceEl = document.getElementById('disk-space-status');
  if (!diskSpaceEl) return;
  
  // Format free space in human-readable form
  const freeSpace = formatBytes(data.free);
  
  // Update the UI based on status
  if (data.status === 'critical') {
    diskSpaceEl.textContent = `CRITICAL: Only ${freeSpace} free`;
    diskSpaceEl.className = 'status error';
  } else if (data.status === 'low') {
    diskSpaceEl.textContent = `Low disk space: ${freeSpace} free`;
    diskSpaceEl.className = 'status warning';
  } else {
    diskSpaceEl.textContent = `Disk space: ${freeSpace} free`;
    diskSpaceEl.className = 'status success';
  }
}

// Function to update concatenation status UI
function updateConcatenationUI(data) {
  const statusEl = document.getElementById('status');
  const recordingMessageEl = document.getElementById('recordingMessage');
  
  switch (data.status) {
    case 'started':
      statusEl.textContent = 'Processing recording...';
      statusEl.className = 'status pending';
      recordingMessageEl.textContent = 'Processing and combining video segments...';
      recordingMessageEl.className = 'pending';
      break;
    
    case 'progress':
      // Update progress if available
      if (data.progress) {
        let progressText = 'Processing: ';
        if (data.progress.percent) {
          progressText += `${Math.round(data.progress.percent)}%`;
        } else if (data.progress.frames) {
          progressText += `${data.progress.frames} frames`;
        }
        statusEl.textContent = progressText;
      }
      break;
    
    case 'error':
      statusEl.textContent = `Error processing recording: ${data.error}`;
      statusEl.className = 'status error';
      recordingMessageEl.textContent = `Error: ${data.error}`;
      recordingMessageEl.className = 'error';
      break;
    
    case 'complete':
      statusEl.textContent = 'Recording processed successfully';
      statusEl.className = 'status success';
      // The recordingSaved event will update the message
      break;
  }
}

// Function to check PIXI version and log important information
function logPixiInfo() {
  try {
    const version = PIXI.VERSION || 'unknown';
    console.log(`PIXI.js version: ${version}`);
    
    // Log available properties
    console.log('PIXI.Renderer available:', !!PIXI.Renderer);
    console.log('PIXI.CanvasRenderer available:', !!PIXI.CanvasRenderer);
    console.log('app.view:', !!app.view);
    
    if (app.renderer) {
      console.log('app.renderer type:', app.renderer.type);
      console.log('app.renderer dimensions:', app.renderer.width, 'x', app.renderer.height);
    }
    
    return version;
  } catch (err) {
    console.error('Error getting PIXI info:', err);
    return 'error';
  }
}

// Function to initialize Pixi.js renderer
function initializePixi() {
  try {
    console.log('Initializing Pixi.js');
    
    // Get canvas element
    const canvasElement = document.getElementById('main-canvas');
    if (!canvasElement) {
      console.error('Canvas element not found during Pixi initialization');
      throw new Error('Canvas element not found');
    }
    console.log('Canvas element found:', canvasElement);
    
    // Log WebGL capabilities for debugging
    logPixiInfo();
    
    // Create PIXI Application with appropriate settings for performance
    app = new PIXI.Application({
      view: canvasElement,
      width: 3840,    // 4K width
      height: 2160,   // 4K height
      backgroundColor: 0x000000,
      resolution: 1,  // Adjust for device scaling
      autoDensity: true,
      antialias: false, // Disable for performance
      powerPreference: 'high-performance', // Request high performance GPU
      clearBeforeRender: true,
    });
    
    if (!app || !app.view) {
      console.error('Failed to initialize PIXI application or view is null');
      throw new Error('PIXI initialization failed');
    }
    
    // Set ticker to request animation frame mode for better performance
    app.ticker.maxFPS = 60; // Limit to 60 FPS max
    
    // Initialize state
    state.currentZoom = 1.0;
    state.targetZoom = 1.0;
    
    // If we reach this point, Pixi.js is available
    usePixi = true;
    
    console.log('Pixi.js initialized successfully');
    return true;
  } catch (error) {
    console.error('Error initializing Pixi.js:', error);
    console.log('Falling back to Canvas 2D API');
    usePixi = false;
    return false;
  }
}

// Initialize canvas 2D rendering loop (fallback when PIXI fails)
function initializeCanvas2DRenderingLoop() {
    try {
        console.log('Initializing Canvas 2D rendering loop');
        
        // Make sure we have the canvas 2D context
        if (!canvasContext) {
            const canvasElement = document.getElementById('main-canvas');
            canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
            
            if (!canvasContext) {
                throw new Error('Unable to get 2D context');
            }
        }
        
        // Cancel any existing animation frame
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        
        // Start the render loop
        function render() {
            try {
                // Clear canvas
                canvasContext.fillStyle = '#000000';
                canvasContext.fillRect(0, 0, canvasContext.canvas.width, canvasContext.canvas.height);
                
                // Skip rendering if video isn't ready
                if (!sourceVideo || sourceVideo.readyState < 2) { // HAVE_CURRENT_DATA
                    animationFrameId = requestAnimationFrame(render);
                    return;
                }
                
                // Interpolate towards target zoom smoothly
                const interpolationFactor = 0.1;
                state.currentZoom += (state.targetZoom - state.currentZoom) * interpolationFactor;
                state.currentCenterX += (state.targetCenterX - state.currentCenterX) * interpolationFactor;
                state.currentCenterY += (state.targetCenterY - state.currentCenterY) * interpolationFactor;
                
                // Calculate dimensions and positions
                const canvasWidth = canvasContext.canvas.width;
                const canvasHeight = canvasContext.canvas.height;
                const videoWidth = sourceVideo.videoWidth;
                const videoHeight = sourceVideo.videoHeight;
                
                if (videoWidth === 0 || videoHeight === 0) {
                    animationFrameId = requestAnimationFrame(render);
                    return;
                }
                
                // Calculate base scale to fit while maintaining aspect ratio
                const videoRatio = videoWidth / videoHeight;
                const canvasRatio = canvasWidth / canvasHeight;
                
                let baseScale;
                if (videoRatio > canvasRatio) {
                    baseScale = canvasHeight / videoHeight;
                } else {
                    baseScale = canvasWidth / videoWidth;
                }
                
                // Apply the zoom level
                const scale = baseScale * state.currentZoom;
                
                // Calculate the offset based on center
                const scaledVideoWidth = videoWidth * scale;
                const scaledVideoHeight = videoHeight * scale;
                
                // Center point in video coordinates
                const centerXNormalized = (state.currentCenterX / videoWidth);
                const centerYNormalized = (state.currentCenterY / videoHeight);
                
                // Calculate position to place video with centering offset
                const left = (canvasWidth / 2) - (scaledVideoWidth * centerXNormalized);
                const top = (canvasHeight / 2) - (scaledVideoHeight * centerYNormalized);
                
                // Draw the video
                canvasContext.drawImage(
                    sourceVideo,
                    left, top,
                    scaledVideoWidth, scaledVideoHeight
                );
                
                // Draw border effect
                drawBorderEffectCanvas2D();
                
                // Send periodic zoom state updates
                sendZoomStateUpdate();
                
                // Schedule next frame
                animationFrameId = requestAnimationFrame(render);
            } catch (error) {
                console.error('Error in Canvas 2D render loop:', error);
                // Continue rendering despite errors
                animationFrameId = requestAnimationFrame(render);
            }
        }
        
        // Start the render loop
        render();
        
        return true;
    } catch (error) {
        console.error('Error initializing Canvas 2D rendering:', error);
        return false;
    }
}

// Function to draw the border effect with Canvas 2D
function drawBorderEffectCanvas2D() {
    if (!canvasContext) return;
    
    try {
        // Calculate visible portion of the video
        const zoom = state.currentZoom;
        const canvasW = canvasContext.canvas.width;
        const canvasH = canvasContext.canvas.height;
        
        // Calculate the visible portion of the video in canvas coordinates
        // This is the zoomed viewport (inner border)
        const visibleRectW = canvasW / zoom;
        const visibleRectH = canvasH / zoom;
        
        // Calculate the top-left position of the visible rect
        const visibleRectX = state.currentCenterX - (visibleRectW / 2);
        const visibleRectY = state.currentCenterY - (visibleRectH / 2);
        
        // Scale to canvas coordinates
        const canvasWidth = canvasContext.canvas.width;
        const canvasHeight = canvasContext.canvas.height;
        const videoWidth = sourceVideo.videoWidth;
        const videoHeight = sourceVideo.videoHeight;
        
        // Calculate base scale to fit while maintaining aspect ratio
        const videoRatio = videoWidth / videoHeight;
        const canvasRatio = canvasWidth / canvasHeight;
        
        let baseScale;
        if (videoRatio > canvasRatio) {
            baseScale = canvasHeight / videoHeight;
        } else {
            baseScale = canvasWidth / videoWidth;
        }
        
        // Apply the zoom level
        const scale = baseScale * state.currentZoom;
        
        // Calculate the offset based on center
        const centerXNormalized = (state.currentCenterX / videoWidth);
        const centerYNormalized = (state.currentCenterY / videoHeight);
        
        // Convert visible rect to canvas coordinates
        const innerRectX = (canvasWidth / 2) - (scale * videoWidth * centerXNormalized) + (visibleRectX * scale);
        const innerRectY = (canvasHeight / 2) - (scale * videoHeight * centerYNormalized) + (visibleRectY * scale);
        const innerRectW = visibleRectW * scale;
        const innerRectH = visibleRectH * scale;
        
        // Create the pulsing effect (value between 0.3 and 1.0)
        borderPulseTime += 0.016; // Approximate for 60fps
        const pulseAlpha = 0.3 + (Math.sin(borderPulseTime * 2) * 0.35 + 0.35);
        const lineWidth = 6; // Thicker line for better visibility
        
        // Define the 4 corners of the rectangle
        const corners = [
            { x: innerRectX, y: innerRectY }, // Top-left
            { x: innerRectX + innerRectW, y: innerRectY }, // Top-right
            { x: innerRectX + innerRectW, y: innerRectY + innerRectH }, // Bottom-right
            { x: innerRectX, y: innerRectY + innerRectH } // Bottom-left
        ];
        
        // Draw each side with a different color from the gradient
        for (let i = 0; i < 4; i++) {
            const ratio = i / 3; // 0, 0.33, 0.67, 1.0
            
            // Get color based on position in the gradient
            let color;
            if (ratio < 0.5) {
                const blendRatio = ratio * 2;
                color = blendColorsRgba(BORDER_COLORS[0], BORDER_COLORS[1], blendRatio, pulseAlpha);
            } else {
                const blendRatio = (ratio - 0.5) * 2;
                color = blendColorsRgba(BORDER_COLORS[1], BORDER_COLORS[2], blendRatio, pulseAlpha);
            }
            
            // Draw one side of the rectangle
            const startIdx = i;
            const endIdx = (i + 1) % 4;
            
            canvasContext.lineWidth = lineWidth;
            canvasContext.strokeStyle = color;
            canvasContext.beginPath();
            canvasContext.moveTo(corners[startIdx].x, corners[startIdx].y);
            canvasContext.lineTo(corners[endIdx].x, corners[endIdx].y);
            canvasContext.stroke();
        }
    } catch (error) {
        console.error('Error drawing Canvas 2D border effect:', error);
    }
}

// Helper function to blend between two colors for Canvas 2D (returns rgba string)
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

// Function to add crop region controls
function addCropControls(cropRegion) {
  // Create crop controls container
  const cropControlsContainer = document.createElement('div');
  cropControlsContainer.className = 'crop-controls';
  cropControlsContainer.innerHTML = `
    <h3>Region Selection</h3>
    <div class="control-row">
      <label>
        <input type="checkbox" id="enableCrop"> 
        Enable Region Selection
      </label>
    </div>
    <div class="control-group">
      <div class="control-row">
        <label>X: <input type="number" id="cropX" min="0" value="0"></label>
        <label>Y: <input type="number" id="cropY" min="0" value="0"></label>
      </div>
      <div class="control-row">
        <label>Width: <input type="number" id="cropWidth" min="10" value="1920"></label>
        <label>Height: <input type="number" id="cropHeight" min="10" value="1080"></label>
      </div>
    </div>
    <button id="resetCrop" class="btn">Reset to Full</button>
  `;
  
  // Add styles if they don't exist
  if (!document.getElementById('crop-controls-styles')) {
    const style = document.createElement('style');
    style.id = 'crop-controls-styles';
    style.textContent = `
      .crop-controls {
        max-width: 1200px;
        margin: 20px auto;
        padding: 15px;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      }
      .crop-controls h3 {
        margin-top: 0;
        color: #2c3e50;
        font-size: 16px;
      }
      .control-group {
        margin-top: 10px;
        padding: 10px;
        border: 1px solid #eee;
        border-radius: 4px;
      }
      .control-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .control-row label {
        display: flex;
        align-items: center;
        font-size: 14px;
      }
      .control-row input[type="number"] {
        width: 70px;
        margin-left: 5px;
        padding: 3px;
      }
    `;
    document.head.appendChild(style);
  }
  
  // Insert after zoom controls
  const zoomControls = document.querySelector('.zoom-controls');
  if (zoomControls && zoomControls.parentNode) {
    zoomControls.parentNode.insertBefore(cropControlsContainer, zoomControls.nextSibling);
  } else {
    const body = document.querySelector('body');
    body.appendChild(cropControlsContainer);
  }
  
  // Add event listeners
  const enableCropCheckbox = document.getElementById('enableCrop');
  const cropXInput = document.getElementById('cropX');
  const cropYInput = document.getElementById('cropY');
  const cropWidthInput = document.getElementById('cropWidth');
  const cropHeightInput = document.getElementById('cropHeight');
  const resetCropButton = document.getElementById('resetCrop');
  
  // Enable/disable crop
  enableCropCheckbox.addEventListener('change', (event) => {
    cropRegion.enabled = event.target.checked;
    console.log('Crop region enabled:', cropRegion.enabled);
  });
  
  // Update X coordinate
  cropXInput.addEventListener('change', (event) => {
    cropRegion.x = parseInt(event.target.value) || 0;
    console.log('Crop region X:', cropRegion.x);
  });
  
  // Update Y coordinate
  cropYInput.addEventListener('change', (event) => {
    cropRegion.y = parseInt(event.target.value) || 0;
    console.log('Crop region Y:', cropRegion.y);
  });
  
  // Update width
  cropWidthInput.addEventListener('change', (event) => {
    cropRegion.width = parseInt(event.target.value) || 1920;
    console.log('Crop region width:', cropRegion.width);
  });
  
  // Update height
  cropHeightInput.addEventListener('change', (event) => {
    cropRegion.height = parseInt(event.target.value) || 1080;
    console.log('Crop region height:', cropRegion.height);
  });
  
  // Reset crop region
  resetCropButton.addEventListener('click', () => {
    if (sourceVideo) {
      cropRegion.x = 0;
      cropRegion.y = 0;
      cropRegion.width = sourceVideo.videoWidth;
      cropRegion.height = sourceVideo.videoHeight;
      
      // Update input values
      cropXInput.value = cropRegion.x;
      cropYInput.value = cropRegion.y;
      cropWidthInput.value = cropRegion.width;
      cropHeightInput.value = cropRegion.height;
      
      console.log('Crop region reset to full frame');
    }
  });
}

// Function to create source selection dialog
async function showSourceSelectionDialog() {
  try {
    // Get sources from main process
    const sources = await window.electronAPI.captureDesktop();
    console.log('Got sources for dialog:', sources.length);
    
    // Create a modal dialog
    const dialog = document.createElement('div');
    dialog.className = 'source-dialog-overlay';
    dialog.innerHTML = `
      <div class="source-dialog">
        <h2>Select Source to Record</h2>
        <div class="notice-box warning">
          <strong>Warning:</strong> Avoid selecting the "Magic Window" application itself as this will cause a recursive display.
        </div>
        <div class="source-grid" id="sourceGrid"></div>
        <div class="dialog-buttons">
          <button id="cancelSourceDialog" class="btn">Cancel</button>
        </div>
      </div>
    `;
    
    // Add to body
    document.body.appendChild(dialog);
    
    // Add styles if they don't exist
    if (!document.getElementById('source-dialog-styles')) {
      const style = document.createElement('style');
      style.id = 'source-dialog-styles';
      style.textContent = `
        .source-dialog-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .source-dialog {
          background: white;
          border-radius: 8px;
          padding: 20px;
          width: 80%;
          max-width: 800px;
          max-height: 80vh;
          overflow-y: auto;
        }
        .source-dialog h2 {
          margin-top: 0;
          color: #2c3e50;
          text-align: center;
        }
        .notice-box {
          margin: 15px 0;
          padding: 10px;
          border-radius: 5px;
          font-size: 14px;
        }
        .notice-box.warning {
          background-color: #fff3cd;
          border: 1px solid #ffeeba;
          color: #856404;
        }
        .source-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 15px;
          margin: 20px 0;
        }
        .source-item {
          border: 2px solid #ddd;
          border-radius: 4px;
          padding: 10px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .source-item:hover {
          border-color: #3498db;
          background: #f8f9fa;
        }
        .source-item.self-app {
          border-color: #e74c3c;
          background: #f8d7da;
          position: relative;
        }
        .source-item.self-app::before {
          content: "⚠️ This is Magic Window";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          background: #e74c3c;
          color: white;
          font-size: 12px;
          padding: 2px 0;
        }
        .source-item img {
          width: 100%;
          height: auto;
          margin-bottom: 10px;
          border: 1px solid #eee;
        }
        .source-item p {
          margin: 5px 0;
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .source-type {
          font-size: 12px;
          color: #6c757d;
          background: #e9ecef;
          border-radius: 3px;
          padding: 2px 5px;
          display: inline-block;
        }
        .dialog-buttons {
          text-align: center;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Populate sources
    const sourceGrid = document.getElementById('sourceGrid');
    sources.forEach(source => {
      const sourceItem = document.createElement('div');
      sourceItem.className = 'source-item';
      
      // Check if this is the Magic Window app itself
      const isSelfApp = source.name && (
        source.name.includes('Magic Window') || 
        source.name.includes('Electron')
      );
      
      if (isSelfApp) {
        sourceItem.className += ' self-app';
      }
      
      const sourceType = source.id.includes('screen') ? 'Screen' : 'Window';
      
      sourceItem.innerHTML = `
        <img src="${source.thumbnail}" alt="${source.name}">
        <p title="${source.name}">${source.name}</p>
        <span class="source-type">${sourceType}</span>
      `;
      
      // Add click handler to select this source
      sourceItem.addEventListener('click', () => {
        // If this is the Magic Window app, show a confirmation
        if (isSelfApp) {
          if (!confirm('WARNING: You are selecting the Magic Window application itself. This will cause a recursive display. Are you sure you want to continue?')) {
            return;
          }
        }
        
        // Remove dialog
        document.body.removeChild(dialog);
        
        // Resolve the promise with the selected ID
        dialogResolve(source.id);
      });
      
      sourceGrid.appendChild(sourceItem);
    });
    
    // Add cancel button handler
    document.getElementById('cancelSourceDialog').addEventListener('click', () => {
      document.body.removeChild(dialog);
      dialogReject(new Error('Source selection canceled'));
    });
    
    // Return a promise that resolves when a source is selected
    return new Promise((resolve, reject) => {
      dialogResolve = resolve;
      dialogReject = reject;
    });
  } catch (error) {
    console.error('Error showing source selection dialog:', error);
    throw error;
  }
}

// Variables for the dialog promise
let dialogResolve = null;
let dialogReject = null;

// Function to get media stream from a source
async function getSourceStream(sourceId) {
  try {
    console.log('Getting stream for source:', sourceId);
    
    // Show source selection dialog to get specific ID
    let selectedId = sourceId;
    
    if (!selectedId) {
      try {
        console.log('Showing source selection dialog');
        selectedId = await showSourceSelectionDialog();
        console.log('User selected source:', selectedId);
      } catch (dialogError) {
        console.error('Error from source dialog:', dialogError);
        throw dialogError;
      }
    }
    
    if (!selectedId) {
      throw new Error('No source selected');
    }
    
    // Try to check if the user selected the app itself
    try {
      // Get the sources to check if the user selected the app itself
      const sources = await window.electronAPI.getScreenSources();
      
      if (sources && sources.length > 0) {
        const selectedSource = sources.find(source => source.id === selectedId);
        
        // Check if the selected source is this application
        if (selectedSource && selectedSource.name && 
            (selectedSource.name.includes('Magic Window') || 
             selectedSource.name.includes('Electron'))) {
          const result = confirm(
            'WARNING: You appear to be capturing the Magic Window application itself, ' +
            'which may cause display recursion. It is recommended to capture a different ' +
            'window or screen. Do you want to continue anyway?'
          );
          
          if (!result) {
            throw new Error('Source selection canceled');
          }
        }
      }
    } catch (sourceCheckError) {
      // If we can't check the source, just log and continue
      console.warn('Could not check if selected source is the app itself:', sourceCheckError);
    }
    
    // Get the stream using the navigator.mediaDevices.getUserMedia API
    // which is better supported in Electron
    let streamAttempts = 0;
    const maxAttempts = 3;
    
    while (streamAttempts < maxAttempts) {
      try {
        streamAttempts++;
        console.log(`Attempt ${streamAttempts} to get stream for source ${selectedId}`);
        
        // Try main approach first with mandatory options
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedId,
                minWidth: 1280,
                minHeight: 720
              }
            }
          });
          
          // Check if we have a valid video track
          const videoTracks = stream.getVideoTracks();
          if (videoTracks.length === 0) {
            throw new Error('No video track in the captured stream');
          }
          
          // Log information about the captured stream
          const videoTrack = videoTracks[0];
          console.log('Video track:', videoTrack.label);
          console.log('Track settings:', videoTrack.getSettings());
          
          console.log('Successfully obtained media stream');
          return stream;
        } catch (mandatoryError) {
          console.warn('Error with mandatory constraints, trying alternative approach:', mandatoryError);
          
          // Try alternative approach with simpler constraints
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedId
              }
            }
          });
          
          console.log('Successfully obtained media stream with alternative constraints');
          return stream;
        }
      } catch (err) {
        console.error(`Stream attempt ${streamAttempts} failed:`, err);
        
        if (streamAttempts >= maxAttempts) {
          throw err;
        }
        
        // Wait a bit before trying again
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error('Failed to get media stream after multiple attempts');
  } catch (error) {
    console.error('Error getting source stream:', error);
    throw error;
  }
}

// Function to setup canvas rendering with the source stream
function setupCanvasRendering(stream) {
  try {
    console.log('Setting up canvas rendering with stream');
    console.log('Stream object:', stream);
    console.log('Stream active:', stream.active);
    console.log('Video tracks:', stream.getVideoTracks().length);
    
    // Check stream tracks and log details
    const streamVideoTracks = stream.getVideoTracks();
    if (streamVideoTracks.length > 0) {
      const settings = streamVideoTracks[0].getSettings();
      debugLog(`Source video settings: ${settings.width}x${settings.height} (${settings.frameRate}fps)`);
      debugLog(`Source video constraints:`, settings.width > 0);
    }
    
    // Make sure source video exists
    if (!sourceVideo) {
      sourceVideo = document.getElementById('source-video');
      if (!sourceVideo) {
        throw new Error('Source video element not found');
      }
    }
    
    // Reset video element before setting new source
    if (sourceVideo.srcObject) {
      console.log('Resetting previous video source');
      sourceVideo.srcObject = null;
      sourceVideo.load();
    }
    
    // Set basic video attributes for better playback
    sourceVideo.autoplay = true;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.controls = false;
    
    // Check stream validity
    if (!stream || !stream.active) {
      console.error('Stream is not active or is invalid');
      throw new Error('Invalid stream source');
    }
    
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      console.error('No video tracks in stream');
      throw new Error('Stream has no video tracks');
    }
    
    // Set the video source to the stream
    sourceVideo.srcObject = stream;
    console.log('Set stream to video element');
    
    // Log video element properties
    console.log('Video element:', sourceVideo);
    console.log('Video ready state:', sourceVideo.readyState);
    console.log('Video width/height:', sourceVideo.videoWidth, sourceVideo.videoHeight);
    
    // Handle metadata loaded event
    sourceVideo.onloadedmetadata = () => {
      console.log('Video metadata loaded, starting playback');
      console.log('Video dimensions after metadata:', sourceVideo.videoWidth, sourceVideo.videoHeight);
      
      if (sourceVideo.videoWidth === 0 || sourceVideo.videoHeight === 0) {
        console.warn('Warning: Video dimensions are zero after metadata loaded');
      }
      
      sourceVideo.play()
        .then(() => {
          console.log('Video playback started');
          console.log('Video is playing:', !sourceVideo.paused);
          console.log('Video dimensions:', sourceVideo.videoWidth, sourceVideo.videoHeight);
          
          // Send a PiP snapshot once the video is playing if PiP is enabled
          if (isPipVisible) {
            console.log('Video is playing and PiP is visible, sending initial snapshot');
            setTimeout(() => {
              sendPipSnapshot();
            }, 500);
          }
        })
        .catch(err => {
          console.error('Error starting video playback:', err);
          
          // Try playing again with a timeout and different settings
          setTimeout(() => {
            console.log('Retrying video playback after delay');
            sourceVideo.muted = true; // Ensure muted to improve chances of autoplay
            sourceVideo.playsInline = true;
            sourceVideo.play()
              .then(() => console.log('Video playback started on second attempt'))
              .catch(secondErr => console.error('Failed to play video on second attempt:', secondErr));
          }, 1000);
        });
    };
    
    // Add error event handlers
    sourceVideo.onerror = (err) => {
      console.error('Video element error:', err);
      console.error('Video error details:', sourceVideo.error);
    };
    
    // Add stalled event handler
    sourceVideo.onstalled = () => {
      console.warn('Video playback has stalled');
      
      // Try reloading the stream
      try {
        sourceVideo.load();
        sourceVideo.play()
          .then(() => console.log('Video playback resumed after stall'))
          .catch(err => console.error('Failed to resume after stall:', err));
      } catch (err) {
        console.error('Error recovering from stall:', err);
      }
    };
    
    // Wait for video to be ready
    return new Promise((resolve) => {
      console.log('Waiting for video to start playing');
      
      // This will ensure the video is actually playing before we try to use it
      sourceVideo.onplaying = () => {
        console.log('Video is now playing, setting up rendering');
        
        // Choose the rendering method based on initialization
        if (usePixi) {
          setupPixiRendering()
            .then(success => {
              // Send a PiP snapshot once the rendering is set up if PiP is enabled
              if (isPipVisible) {
                console.log('Pixi rendering set up and PiP is visible, sending initial snapshot');
                setTimeout(() => {
                  sendPipSnapshot();
                }, 500);
              }
              resolve(success);
            })
            .catch(err => {
              console.error('Error setting up PIXI rendering:', err);
              // Fallback to Canvas 2D
              usePixi = false;
              console.log('Falling back to Canvas 2D rendering');
              setupCanvas2DRendering()
                .then(success => {
                  // Send a PiP snapshot once the rendering is set up if PiP is enabled
                  if (isPipVisible) {
                    console.log('Canvas2D rendering set up and PiP is visible, sending initial snapshot');
                    setTimeout(() => {
                      sendPipSnapshot();
                    }, 500);
                  }
                  resolve(success);
                })
                .catch(canvas2dErr => {
                  console.error('Error setting up Canvas 2D rendering:', canvas2dErr);
                  resolve(false);
                });
            });
        } else {
          // Use Canvas 2D rendering
          setupCanvas2DRendering()
            .then(success => {
              // Send a PiP snapshot once the rendering is set up if PiP is enabled
              if (isPipVisible) {
                console.log('Canvas2D rendering set up and PiP is visible, sending initial snapshot');
                setTimeout(() => {
                  sendPipSnapshot();
                }, 500);
              }
              resolve(success);
            })
            .catch(err => {
              console.error('Error setting up Canvas 2D rendering:', err);
              resolve(false);
            });
        }
      };
      
      // In case the video is already playing
      if (sourceVideo.readyState >= 3) {
        console.log('Video is already playing, triggering onplaying handler');
        sourceVideo.onplaying();
      }
      
      // Set a timeout in case the video never plays
      setTimeout(() => {
        if (!canvasStream) {
          console.error('Timeout waiting for video to play');
          
          // Try one more time to start the video playback
          console.log('Trying once more to start video playback');
          sourceVideo.play()
            .then(() => {
              console.log('Video playback started after timeout');
              sourceVideo.onplaying();
            })
            .catch(err => {
              console.error('Failed to start video after timeout:', err);
              resolve(false);
            });
        }
      }, 5000);
    });
  } catch (error) {
    console.error('Error setting up canvas rendering:', error);
    return Promise.resolve(false);
  }
}

// Function to smoothly transition zoom and position
function setZoom(level, centerX, centerY, duration = 0.3) {
    try {
        // Constrain zoom level
        level = Math.max(1.0, Math.min(level, 4.0));
        
        // Update target values
        state.targetZoom = level;
        state.targetCenterX = centerX !== undefined ? centerX : state.currentCenterX;
        state.targetCenterY = centerY !== undefined ? centerY : state.currentCenterY;
        
        console.log(`Setting zoom: level=${level}, center=(${state.targetCenterX}, ${state.targetCenterY})`);
        
        // Animate the zoom change
        if (usePixi && videoSprite && app) {
            // Use GSAP for smooth animation
            gsap.to(state, {
                currentZoom: state.targetZoom,
                currentCenterX: state.targetCenterX,
                currentCenterY: state.targetCenterY,
                duration: duration,
                ease: "power2.out",
                onUpdate: () => {
                    // Update sprite scale and position based on current values
                    videoSprite.scale.set(state.currentZoom);
                    
                    // Calculate position to keep the center point fixed
                    const viewportWidth = app.renderer.width;
                    const viewportHeight = app.renderer.height;
                    
                    // Center of the sprite in the viewport
                    videoSprite.x = viewportWidth / 2 - (state.currentCenterX * state.currentZoom);
                    videoSprite.y = viewportHeight / 2 - (state.currentCenterY * state.currentZoom);
                },
                onComplete: () => {
                    // Send zoom level update to main process for floating panel
                    window.electronAPI.sendZoomLevelUpdate(state.currentZoom);
                    
                    // Send zoom state update for PiP
                    sendZoomStateUpdate();
                }
            });
        } else if (canvasContext) {
            // For Canvas2D fallback, just update immediately
            state.currentZoom = state.targetZoom;
            state.currentCenterX = state.targetCenterX;
            state.currentCenterY = state.targetCenterY;
            
            // Send zoom level update to main process for floating panel
            window.electronAPI.sendZoomLevelUpdate(state.currentZoom);
            
            // Send zoom state update for PiP
            try {
                sendZoomStateUpdate();
            } catch (err) {
                console.error('Error sending zoom state update:', err);
            }
        } else {
            console.warn('Cannot set zoom: Neither PIXI nor Canvas2D context is available');
        }
        
        // Update current preset index
        currentPresetIndex = findClosestPresetIndex(level);
    } catch (error) {
        console.error('Error in setZoom:', error);
    }
}

// Function to toggle FXAA
function toggleFXAA() {
    if (!videoSprite || !usePixi) return;
    
    fxaaEnabled = !fxaaEnabled;
    
    if (fxaaEnabled) {
        if (!fxaaFilter) {
            // Use PIXI.filters.FXAAFilter instead of imported FXAAFilter
            fxaaFilter = new PIXI.filters.FXAAFilter();
        }
        videoSprite.filters = [fxaaFilter];
    } else {
        videoSprite.filters = [];
    }
}

// Update setupPixiRendering to include FXAA setup and FPS monitoring
async function setupPixiRendering() {
  try {
    // Wait for source-video to have proper dimensions
    await waitForVideoMetadata(sourceVideo);
    
    const sourceWidth = sourceVideo.videoWidth;
    const sourceHeight = sourceVideo.videoHeight;
    const canvasWidth = app.screen.width;
    const canvasHeight = app.screen.height;
    
    console.log("Creating video texture with dimensions:", sourceWidth, "x", sourceHeight);
    console.log("Canvas dimensions:", canvasWidth, "x", canvasHeight);
    
    // Calculate aspect ratios
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = canvasWidth / canvasHeight;
    
    // Determine initial scale factor based on aspect ratios
    let initialScale;
    if (sourceAspect > canvasAspect) {
      // Source is wider - scale by width
      initialScale = canvasWidth / sourceWidth;
      console.log("Source is wider than canvas, scaling by width. Scale factor:", initialScale);
    } else {
      // Source is taller - scale by height
      initialScale = canvasHeight / sourceHeight;
      console.log("Source is taller than canvas, scaling by height. Scale factor:", initialScale);
    }
    
    // Initialize video sprite from source-video
    const videoTexture = PIXI.Texture.from(sourceVideo);
    videoSprite = new PIXI.Sprite(videoTexture);
    
    // Set initial sprite position and pivot point
    videoSprite.position.set(app.screen.width / 2, app.screen.height / 2);
    videoSprite.anchor.set(0.5); // Center the sprite's anchor point
    
    // Set initial state with calculated scale
    state.baseScale = initialScale;
    state.currentZoom = state.targetZoom = initialScale;
    videoSprite.scale.set(state.currentZoom);
    
    // Add video sprite to the stage
    app.stage.addChild(videoSprite);
    
    // Initialize borderGraphics and add it to the stage
    borderGraphics = new PIXI.Graphics();
    app.stage.addChild(borderGraphics);
    
    // Add FXAA filter
    if (!fxaaFilter) {
      fxaaFilter = new PIXI.filters.FXAAFilter();
      fxaaEnabled = false; // Don't enable by default
    }
    
    console.log('Video sprite and texture setup complete');
    
    // Performance variables for rendering optimization
    let lastTextureUpdateTime = 0;
    const TEXTURE_UPDATE_INTERVAL = 16; // ~60 FPS (16.67ms)
    
    // Frame skip counter for recording mode
    let frameSkipCounter = 0;
    
    // Set up a ticker to update the video sprite
    app.ticker.add(() => {
      try {
        // Performance optimization: Frame skipping during recording
        if (isRecording) {
          // Skip every nth frame during recording (adjust based on CPU usage)
          frameSkipCounter = (frameSkipCounter + 1) % 2;
          if (frameSkipCounter !== 0) {
            return; // Skip this frame
          }
        }
        
        // Performance optimization: Only update texture at ~60fps maximum
        const now = performance.now();
        if (now - lastTextureUpdateTime < TEXTURE_UPDATE_INTERVAL) {
          return;
        }
        lastTextureUpdateTime = now;
        
        // Only update the texture if the video is playing and has valid data
        if (sourceVideo && sourceVideo.readyState >= 2) {
          // Update the texture from the video element - critical for seeing video content!
          if (videoSprite && videoSprite.texture && videoSprite.texture.baseTexture) {
            videoSprite.texture.baseTexture.update();
          }
        }
        
        // Smoothly interpolate to target state
        const interpolationFactor = isRecording ? 0.2 : 0.1; // Faster interpolation during recording
                 
        state.currentZoom += (state.targetZoom - state.currentZoom) * interpolationFactor;
        state.currentCenterX += (state.targetCenterX - state.currentCenterX) * interpolationFactor;
        state.currentCenterY += (state.targetCenterY - state.currentCenterY) * interpolationFactor;
        
        // Apply updated position and scale
        videoSprite.scale.set(state.currentZoom);
        
        // Calculate position based on zoom center - improved positioning logic
        const centerOffsetX = (state.currentCenterX - sourceWidth / 2);
        const centerOffsetY = (state.currentCenterY - sourceHeight / 2);
        videoSprite.position.x = app.screen.width / 2 - centerOffsetX * state.currentZoom;
        videoSprite.position.y = app.screen.height / 2 - centerOffsetY * state.currentZoom;
        
        // Draw the border effect - throttle during recording to improve performance
        if (!isRecording || now % 3 === 0) {
          drawBorderEffect();
        }
        
        // Performance optimization: Only update PiP when visible and not too often
        if (isPipVisible && now - lastPipUpdateTime >= (isRecording ? 500 : PIP_UPDATE_INTERVAL)) {
          sendPipSnapshot();
          lastPipUpdateTime = now;
        }
        
        // Monitor performance during recording
        if (isRecording && window.performance && window.performance.memory) {
          const memoryInfo = window.performance.memory;
          if (memoryInfo.usedJSHeapSize > 1000000000) { // 1GB
            console.warn('High memory usage during recording:', 
                        (memoryInfo.usedJSHeapSize / 1024 / 1024).toFixed(2) + 'MB');
          }
        }
      } catch (error) {
        console.error('Error in Pixi ticker:', error);
      }
    });
    
    // Get the canvas stream for recording
    console.log('Getting stream from canvas with 60fps');
    const canvasElement = document.getElementById('main-canvas');
    canvasStream = canvasElement.captureStream(60);
    
    console.log('Pixi rendering setup complete');
    return true;
  } catch (error) {
    console.error('Error setting up Pixi rendering:', error);
    throw error;
  }
}

// Function to draw the border effect
function drawBorderEffect() {
    if (!borderGraphics || !videoSprite) return;
    
    try {
        // Clear previous graphics
        borderGraphics.clear();
        
        // Calculate visible portion of the video
        const zoom = state.currentZoom;
        const canvasW = app.screen.width;
        const canvasH = app.screen.height;
        
        // Calculate the visible portion of the video in canvas coordinates
        // This is the zoomed viewport (inner border)
        const visibleRectW = canvasW / zoom;
        const visibleRectH = canvasH / zoom;
        
        // Calculate the top-left position of the visible rect
        const visibleRectX = state.currentCenterX - (visibleRectW / 2);
        const visibleRectY = state.currentCenterY - (visibleRectH / 2);
        
        // Scale to canvas coordinates
        const innerRectX = app.screen.width / 2 - (state.currentCenterX - visibleRectX) * zoom;
        const innerRectY = app.screen.height / 2 - (state.currentCenterY - visibleRectY) * zoom;
        const innerRectW = visibleRectW * zoom;
        const innerRectH = visibleRectH * zoom;
        
        // Create the pulsing effect (value between 0.3 and 1.0)
        borderPulseTime += app.ticker.deltaMS / 1000;
        const pulseAlpha = 0.3 + (Math.sin(borderPulseTime * 2) * 0.35 + 0.35);
        const lineWidth = 6; // Thicker line for better visibility
        
        // Draw inner border (zoomed area) with gradient
        const gradientSteps = 10; // Number of steps for the gradient effect
        
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
            borderGraphics.lineStyle(lineWidth, color, pulseAlpha);
            
            // Calculate segment position - draw clockwise starting from top-left
            if (i < gradientSteps / 4) {
                // Top segment
                const segmentRatio = i / (gradientSteps / 4);
                const segmentX = innerRectX + innerRectW * segmentRatio;
                borderGraphics.moveTo(segmentX, innerRectY);
                borderGraphics.lineTo(Math.min(segmentX + innerRectW / (gradientSteps / 4), innerRectX + innerRectW), innerRectY);
            } else if (i < gradientSteps / 2) {
                // Right segment
                const segmentRatio = (i - gradientSteps / 4) / (gradientSteps / 4);
                const segmentY = innerRectY + innerRectH * segmentRatio;
                borderGraphics.moveTo(innerRectX + innerRectW, segmentY);
                borderGraphics.lineTo(innerRectX + innerRectW, Math.min(segmentY + innerRectH / (gradientSteps / 4), innerRectY + innerRectH));
            } else if (i < 3 * gradientSteps / 4) {
                // Bottom segment
                const segmentRatio = (i - gradientSteps / 2) / (gradientSteps / 4);
                const segmentX = innerRectX + innerRectW - innerRectW * segmentRatio;
                borderGraphics.moveTo(segmentX, innerRectY + innerRectH);
                borderGraphics.lineTo(Math.max(segmentX - innerRectW / (gradientSteps / 4), innerRectX), innerRectY + innerRectH);
            } else {
                // Left segment
                const segmentRatio = (i - 3 * gradientSteps / 4) / (gradientSteps / 4);
                const segmentY = innerRectY + innerRectH - innerRectH * segmentRatio;
                borderGraphics.moveTo(innerRectX, segmentY);
                borderGraphics.lineTo(innerRectX, Math.max(segmentY - innerRectH / (gradientSteps / 4), innerRectY));
            }
        }
    } catch (error) {
        console.error('Error drawing border effect:', error);
    }
}

// Helper function to blend between two colors
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

// Function to setup Canvas 2D rendering (fallback)
async function setupCanvas2DRendering() {
  try {
    console.log('Setting up Canvas 2D rendering');
    
    // Make sure we have a valid canvas context
    if (!canvasContext) {
      const canvasElement = document.getElementById('main-canvas');
      canvasContext = canvasElement.getContext('2d');
      if (!canvasContext) {
        throw new Error('Could not get 2D context from canvas');
      }
    }
    
    // Start the render loop
    initializeCanvas2DRenderingLoop();
    
    // Get the canvas stream for recording
    console.log('Getting stream from canvas');
    const canvasElement = document.getElementById('main-canvas');
    canvasStream = canvasElement.captureStream(60);
    
    console.log('Canvas 2D rendering setup complete');
    return true;
  } catch (error) {
    console.error('Error setting up Canvas 2D rendering:', error);
    throw error;
  }
}

// Function to setup media recorder with canvas stream
function setupMediaRecorder() {
  try {
    if (!canvasStream) {
      throw new Error('Canvas stream not available');
    }
    
    // Log available MIME types for debugging
    console.log('Available MIME types:');
    const types = [
      'video/mp4;codecs=hvc1',      // HEVC (Apple's naming)
      'video/mp4;codecs=hevc',      // HEVC (alternate naming)
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm;codecs=h264',
      'video/mp4;codecs=h264',
      'video/mp4;codecs=avc1'
    ];
    
    types.forEach(type => {
      console.log(`${type}: ${isCodecSupported(type)}`);
    });
    
    // Check for HEVC support first
    let mimeType = '';
    let hevcSupported = false;
    
    // Check for HEVC support (both common variants)
    if (isCodecSupported('video/mp4;codecs=hvc1')) {
      mimeType = 'video/mp4;codecs=hvc1';
      hevcSupported = true;
      console.log('HEVC encoding is supported (hvc1)! Using hardware-accelerated encoding.');
    } else if (isCodecSupported('video/mp4;codecs=hevc')) {
      mimeType = 'video/mp4;codecs=hevc';
      hevcSupported = true;
      console.log('HEVC encoding is supported (hevc)! Using hardware-accelerated encoding.');
    }
    
    // If HEVC not supported, fall back to H.264 or other formats
    if (!hevcSupported) {
      console.warn('HEVC (H.265) encoding is not supported by this browser. Falling back to H.264 or other codecs.');
      
      // Try H.264 in MP4 container
      if (isCodecSupported('video/mp4;codecs=h264') || 
          isCodecSupported('video/mp4;codecs=avc1')) {
        mimeType = isCodecSupported('video/mp4;codecs=h264') ? 
                  'video/mp4;codecs=h264' : 'video/mp4;codecs=avc1';
        console.log('Using H.264 codec for recording');
      }
      // WebM fallbacks if needed
      else if (isCodecSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
        console.log('Using VP9 codec for recording');
      } 
      else if (isCodecSupported('video/webm;codecs=h264')) {
        mimeType = 'video/webm;codecs=h264';
        console.log('Using WebM/H.264 codec for recording');
      }
      else if (isCodecSupported('video/webm;codecs=vp8')) {
        mimeType = 'video/webm;codecs=vp8';
        console.log('Using VP8 codec for recording');
      }
      else {
        // Use default
        mimeType = '';
        console.warn('No explicitly supported video codec found. Using browser default.');
      }
    }
    
    console.log(`Using MIME type: ${mimeType || 'default'}`);
    
    // Create media recorder options with high bitrate for 4K/60FPS
    // Using higher bitrate for H.264 to maintain quality, lower for HEVC due to better compression
    const options = {
      videoBitsPerSecond: hevcSupported ? 20000000 : 30000000 // 20 Mbps for HEVC, 30 Mbps for others
    };
    
    // Add mime type if we have a supported one
    if (mimeType) {
      options.mimeType = mimeType;
    }
    
    // Log the options for debugging
    console.log('MediaRecorder options:', options);
    
    // Create media recorder
    mediaRecorder = new MediaRecorder(canvasStream, options);
    
    // Tell main process what MIME type is being used for recording
    window.electronAPI.send('recordingMimeType', { mimeType: mediaRecorder.mimeType || 'unknown' });
    
    recordedChunks = [];
    
    // Handle data available event
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
        
        // Convert blob to ArrayBuffer for IPC
        event.data.arrayBuffer().then(buffer => {
          // Send the chunk to the main process
          window.electronAPI.sendBlobChunk({
            buffer: buffer,
            mimeType: mediaRecorder.mimeType || 'video/webm',
            isLastChunk: false
          });
        });
      }
    };
    
    // Handle recording stop event
    mediaRecorder.onstop = () => {
      console.log('MediaRecorder stopped, processing final data');
      
      // If there's a final chunk from recordedChunks that hasn't been sent yet
      if (recordedChunks.length > 0) {
        const lastBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
        
        // Convert blob to ArrayBuffer for IPC
        lastBlob.arrayBuffer().then(buffer => {
          // Send the final chunk to the main process
          window.electronAPI.sendBlobChunk({
            buffer: buffer,
            mimeType: mediaRecorder.mimeType || 'video/webm',
            isLastChunk: true
          });
          
          // Clear recorded chunks
          recordedChunks = [];
        });
      } else {
        // No chunks to send, signal end of recording
        window.electronAPI.stopRecording();
      }
    };
    
    // Handle recording error
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      window.electronAPI.send('recordingError', event.error.toString());
    };
    
    console.log('MediaRecorder setup complete');
    return true;
  } catch (error) {
    console.error('Error setting up MediaRecorder:', error);
    return false;
  }
}

// Function to start canvas recording
function startCanvasRecording() {
  try {
    // Check if there's an existing mediaRecorder
    if (mediaRecorder) {
      console.warn('MediaRecorder already exists, stopping it first');
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.error('Error stopping existing MediaRecorder:', e);
        // Continue with new setup
      }
    }
    
    if (!canvasStream) {
      console.error('Canvas stream not available');
      return false;
    }
    
    // Set up MediaRecorder with the canvas stream
    console.log('Setting up MediaRecorder for canvas recording');
    if (!setupMediaRecorder()) {
      console.error('Failed to set up MediaRecorder');
      return false;
    }
    
    // Start recording with optimized segment size
    // Use smaller segments (5 seconds) for more frequent saves and better recovery potential
    // Balance between too small (overhead) and too large (risk of losing more on crash)
    console.log('Starting canvas recording with 5-second segments');
    mediaRecorder.start(5000); // 5-second segments
    
    // Tell main process recording has started
    window.electronAPI.startCanvasRecording();
    
    return true;
  } catch (error) {
    console.error('Error starting canvas recording:', error);
    return false;
  }
}

// Function to stop recording
function stopCanvasRecording() {
  try {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      console.warn('MediaRecorder not active, nothing to stop');
      return false;
    }
    
    console.log('Stopping canvas recording');
    mediaRecorder.stop();
    
    // Notify main process that recording is stopping
    window.electronAPI.stopRecording();
    console.log('Sent stop recording notification to main process');
    
    return true;
  } catch (error) {
    console.error('Error stopping canvas recording:', error);
    return false;
  }
}

// Function to pause recording
function pauseCanvasRecording() {
  try {
    if (!mediaRecorder) {
      console.warn('MediaRecorder not initialized, cannot pause');
      return false;
    }
    
    if (mediaRecorder.state !== 'recording') {
      console.warn(`MediaRecorder not recording (current state: ${mediaRecorder.state}), cannot pause`);
      return false;
    }
    
    console.log('Pausing canvas recording');
    mediaRecorder.pause();
    
    // Pause the timer
    pauseTimer();
    
    // Update local state (UI will be updated via main process state update)
    isPaused = true;
    
    // Notify main process about pause
    window.electronAPI.pauseRecording();
    
    // Log MediaRecorder state after pause
    console.log(`MediaRecorder state after pause: ${mediaRecorder.state}`);
    
    return true;
  } catch (error) {
    console.error('Error pausing canvas recording:', error);
    return false;
  }
}

// Function to resume recording
function resumeCanvasRecording() {
  try {
    if (!mediaRecorder) {
      console.warn('MediaRecorder not initialized, cannot resume');
      return false;
    }
    
    if (mediaRecorder.state !== 'paused') {
      console.warn(`MediaRecorder not paused (current state: ${mediaRecorder.state}), cannot resume`);
      return false;
    }
    
    console.log('Resuming canvas recording');
    mediaRecorder.resume();
    
    // Resume the timer
    startTimer();
    
    // Update local state (UI will be updated via main process state update)
    isPaused = false;
    
    // Notify main process about resume
    window.electronAPI.resumeRecording();
    
    // Log MediaRecorder state after resume
    console.log(`MediaRecorder state after resume: ${mediaRecorder.state}`);
    
    return true;
  } catch (error) {
    console.error('Error resuming canvas recording:', error);
    return false;
  }
}

// Function to populate the sources dropdown
async function populateSources() {
  const sourceSelect = document.getElementById('sourceSelect');
  const statusEl = document.getElementById('status');
  
  try {
    // Update status
    statusEl.textContent = 'Loading available sources...';
    statusEl.className = 'status pending';
    
    // Get sources from main process
    const sources = await window.electronAPI.getSources();
    
    // Clear current options (except the first placeholder option)
    while (sourceSelect.options.length > 1) {
      sourceSelect.options.remove(1);
    }
    
    // Add each source to the dropdown
    sources.forEach(source => {
      const option = document.createElement('option');
      option.value = source.id;
      option.text = source.name;
      sourceSelect.appendChild(option);
    });
    
    // Update status
    statusEl.textContent = `Found ${sources.length} available sources`;
    statusEl.className = 'status success';
  } catch (error) {
    console.error('Error getting sources:', error);
    statusEl.textContent = 'Error loading sources';
    statusEl.className = 'status error';
  }
}

// Function to update UI based on recording state
function updateUIState(state) {
  console.log('updateUIState called with state:', state);
  // Update local state
  isRecording = state.isRecording;
  isPaused = state.isPaused;
  
  const sourceSelect = document.getElementById('sourceSelect');
  const refreshButton = document.getElementById('refreshSources');
  const startRecordingBtn = document.getElementById('startRecording');
  const pauseRecordingBtn = document.getElementById('pauseRecording');
  const resumeRecordingBtn = document.getElementById('resumeRecording');
  const stopRecordingBtn = document.getElementById('stopRecording');
  const timerDisplay = document.getElementById('timer-display');
  const recordingMessageEl = document.getElementById('recordingMessage');
  
  // Source selection controls
  sourceSelect.disabled = isRecording;
  refreshButton.disabled = isRecording;
  
  // Recording controls
  startRecordingBtn.disabled = isRecording || !sourceSelect.value;
  pauseRecordingBtn.disabled = !isRecording || isPaused;
  resumeRecordingBtn.disabled = !isRecording || !isPaused;
  stopRecordingBtn.disabled = !isRecording;
  
  // Update timer
  if (isRecording && !isPaused) {
    // Start or resume timer
    startTimer();
    
    // Update recording message
    recordingMessageEl.textContent = 'Recording in progress...';
    recordingMessageEl.className = 'recording';
  } else if (isRecording && isPaused) {
    // Pause timer
    pauseTimer();
    
    // Update recording message
    recordingMessageEl.textContent = 'Recording paused';
    recordingMessageEl.className = 'paused';
  } else {
    // Reset timer and message
    resetTimer();
    
    if (recordingMessageEl.textContent === 'Recording in progress...' || 
        recordingMessageEl.textContent === 'Recording paused') {
      recordingMessageEl.textContent = '';
      recordingMessageEl.className = '';
    }
  }
}

// Function to get direct screen capture and display it in the canvas
async function captureScreenDirectly() {
  const recordingMessageEl = document.getElementById('recordingMessage');
  
  try {
    // Show a loading message
    recordingMessageEl.textContent = 'Attempting to capture screen directly...';
    recordingMessageEl.className = 'pending';
    
    // Request direct screen capture from the main process
    const captureResult = await window.electronAPI.captureScreenDirectly();
    console.log('Direct screen capture successful:', captureResult);
    
    // Set the captured screenshot as the background of the canvas
    const canvasElement = document.getElementById('main-canvas');
    if (!canvasElement) {
      throw new Error('Canvas element not found');
    }
    
    if (!canvasContext) {
      canvasContext = canvasElement.getContext('2d');
      if (!canvasContext) {
        throw new Error('Could not get 2D context from canvas');
      }
    }
    
    // Create an image from the thumbnail data URL
    const img = new Image();
    img.onload = () => {
      // Draw the image on the canvas
      canvasContext.drawImage(img, 0, 0, canvasElement.width, canvasElement.height);
      console.log('Screenshot drawn to canvas');
      
      // Also show it in the video preview for debugging
      if (sourceVideo) {
        // Create a temporary canvas to use as video source
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 1280;
        tempCanvas.height = 720;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // Convert the canvas to a MediaStream
        try {
          const stream = tempCanvas.captureStream(30);
          sourceVideo.srcObject = stream;
          sourceVideo.play()
            .then(() => console.log('Video preview started with screenshot'))
            .catch(err => console.error('Error starting video preview:', err));
        } catch (streamErr) {
          console.error('Error creating stream from canvas:', streamErr);
        }
      }
      
      // Update the status
      recordingMessageEl.textContent = 'Screen captured successfully (Static Screenshot). Note: This is a workaround for screen recording permission issues.';
      recordingMessageEl.className = 'success';
    };
    
    img.onerror = (error) => {
      console.error('Error loading image:', error);
      recordingMessageEl.textContent = 'Error loading screenshot';
      recordingMessageEl.className = 'error';
    };
    
    // Set the image source to the thumbnail data URL
    img.src = captureResult.thumbnail;
    
  } catch (error) {
    console.error('Error capturing screen directly:', error);
    recordingMessageEl.textContent = `Error capturing screen: ${error.message}. Please grant screen recording permission in System Settings.`;
    recordingMessageEl.className = 'error';
  }
}

// Function to create a simple test pattern and display it on the canvas
function showTestPattern() {
  const recordingMessageEl = document.getElementById('recordingMessage');
  
  try {
    // Show a loading message
    recordingMessageEl.textContent = 'Creating test pattern...';
    recordingMessageEl.className = 'pending';
    
    // Get the canvas element and context
    const canvasElement = document.getElementById('main-canvas');
    if (!canvasElement) {
      throw new Error('Canvas element not found');
    }
    
    if (!canvasContext) {
      canvasContext = canvasElement.getContext('2d');
      if (!canvasContext) {
        throw new Error('Could not get 2D context from canvas');
      }
    }
    
    // Create a simple gradient test pattern
    const width = canvasElement.width;
    const height = canvasElement.height;
    
    // Create linear gradient
    const gradient = canvasContext.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#2980b9');
    gradient.addColorStop(0.5, '#27ae60');
    gradient.addColorStop(1, '#f39c12');
    
    // Fill background
    canvasContext.fillStyle = gradient;
    canvasContext.fillRect(0, 0, width, height);
    
    // Draw grid pattern
    canvasContext.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    canvasContext.lineWidth = 1;
    
    // Draw horizontal lines
    for (let y = 0; y < height; y += 100) {
      canvasContext.beginPath();
      canvasContext.moveTo(0, y);
      canvasContext.lineTo(width, y);
      canvasContext.stroke();
    }
    
    // Draw vertical lines
    for (let x = 0; x < width; x += 100) {
      canvasContext.beginPath();
      canvasContext.moveTo(x, 0);
      canvasContext.lineTo(x, height);
      canvasContext.stroke();
    }
    
    // Draw text
    canvasContext.fillStyle = 'white';
    canvasContext.font = 'bold 48px Arial';
    canvasContext.textAlign = 'center';
    canvasContext.textBaseline = 'middle';
    canvasContext.fillText('Magic Window Test Pattern', width / 2, height / 2);
    
    // Draw timestamp
    const timestamp = new Date().toLocaleString();
    canvasContext.font = '24px Arial';
    canvasContext.fillText(timestamp, width / 2, height / 2 + 50);
    
    // Draw resolution text
    canvasContext.font = '18px Arial';
    canvasContext.fillText(`Resolution: ${width}x${height}`, width / 2, height / 2 + 90);
    
    // Update video preview
    if (sourceVideo) {
      try {
        // Create a stream from the canvas
        const stream = canvasElement.captureStream(30);
        sourceVideo.srcObject = stream;
        sourceVideo.play()
          .then(() => console.log('Video preview started with test pattern'))
          .catch(err => console.error('Error starting video preview:', err));
      } catch (streamErr) {
        console.error('Error creating stream from canvas:', streamErr);
      }
    }
    
    console.log('Test pattern drawn to canvas');
    recordingMessageEl.textContent = 'Test pattern displayed successfully. Canvas is working correctly.';
    recordingMessageEl.className = 'success';
    
  } catch (error) {
    console.error('Error creating test pattern:', error);
    recordingMessageEl.textContent = `Error creating test pattern: ${error.message}`;
    recordingMessageEl.className = 'error';
  }
}

// Add the button to the UI
function addDirectCaptureButton() {
  const container = document.querySelector('.recording-controls .button-group');
  if (!container) return;
  
  // Create a new button
  const directCaptureBtn = document.createElement('button');
  directCaptureBtn.textContent = 'Capture Screen (macOS Fix)';
  directCaptureBtn.className = 'btn warning';
  directCaptureBtn.id = 'directCaptureBtn';
  
  // Add event listener
  directCaptureBtn.addEventListener('click', captureScreenDirectly);
  
  // Add test pattern button
  const testPatternBtn = document.createElement('button');
  testPatternBtn.textContent = 'Show Test Pattern';
  testPatternBtn.className = 'btn info';
  testPatternBtn.id = 'testPatternBtn';
  testPatternBtn.addEventListener('click', showTestPattern);
  
  // Add to container
  container.appendChild(directCaptureBtn);
  container.appendChild(testPatternBtn);
  
  console.log('Added direct capture button to UI');
}

// Function to initialize UI event handlers after DOM loaded
window.addEventListener('DOMContentLoaded', async () => {
  // Initialize existing UI handlers
  const statusEl = document.getElementById('status');
  const sourceSelect = document.getElementById('sourceSelect');
  const refreshButton = document.getElementById('refreshSources');
  const startRecordingBtn = document.getElementById('startRecording');
  const pauseRecordingBtn = document.getElementById('pauseRecording');
  const resumeRecordingBtn = document.getElementById('resumeRecording');
  const stopRecordingBtn = document.getElementById('stopRecording');
  const recordingMessageEl = document.getElementById('recordingMessage');
  const currentSavePathEl = document.getElementById('currentSavePath');
  const changeSaveLocationBtn = document.getElementById('changeSaveLocation');
  const diskSpaceEl = document.getElementById('disk-space-status');
  
  console.log('Renderer process started');
  
  // Initialize Pixi.js
  if (!initializePixi()) {
    statusEl.textContent = 'Error initializing canvas rendering';
    statusEl.className = 'status error';
    return;
  }
  
  // Add direct capture button for macOS users
  if (navigator.platform.includes('Mac')) {
    addDirectCaptureButton();
  }
  
  // Initialize zoom controls
  initializeZoomControls();
  
  // Initialize performance monitoring
  requestAnimationFrame(trackFrameTime);
  console.log('Performance monitoring initialized');
  
  // Set up PiP and zoom event listeners
  window.electronAPI.onTogglePip(() => {
    console.log('Toggle PiP command received from main process');
    togglePip();
  });
  
  window.electronAPI.onSetZoomCenter((coords) => {
    console.log('Set zoom center command received:', coords);
    if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
      setZoom(state.currentZoom, coords.x, coords.y);
    }
  });
  
  // Add listener for zoom presets
  window.electronAPI.onZoomPreset && window.electronAPI.onZoomPreset((data) => {
    console.log('Zoom preset received:', data);
    if (data && typeof data.preset === 'number') {
      setZoom(data.preset, undefined, undefined);
    }
  });
  
  // Test initial communication
  statusEl.textContent = 'Sending ping to main process...';
  statusEl.className = 'status pending';
  
  // Send ping to main process
  window.electronAPI.send('ping');
  console.log('Sent ping to main process');
  
  // Initialize save path display
  try {
    const settings = await window.electronAPI.getSettings();
    currentSavePathEl.textContent = settings.savePath;
  } catch (error) {
    console.error('Error getting settings:', error);
    currentSavePathEl.textContent = 'Error loading save location';
  }
  
  // Listen for pong from main process
  window.electronAPI.on('pong', () => {
    console.log('pong received in renderer process');
    statusEl.textContent = 'Communication test successful! (ping-pong completed)';
    statusEl.className = 'status success';
    
    // Load sources after successful communication
    populateSources();
  });
  
  // Setup change save location button
  changeSaveLocationBtn.addEventListener('click', async () => {
    try {
      const path = await window.electronAPI.showSaveDialog();
      if (path) {
        currentSavePathEl.textContent = path;
      }
    } catch (error) {
      console.error('Error changing save location:', error);
      statusEl.textContent = 'Error changing save location';
      statusEl.className = 'status error';
    }
  });
  
  // Setup refresh button
  refreshButton.addEventListener('click', () => {
    populateSources();
  });
  
  // Setup source selection change handler
  sourceSelect.addEventListener('change', async (event) => {
    const selectedSourceId = event.target.value;
    if (selectedSourceId) {
      console.log('Source selected:', selectedSourceId);
      statusEl.textContent = `Selected source: ${event.target.options[event.target.selectedIndex].text}`;
      statusEl.className = 'status pending';
      
      // Send source ID to main process for reference
      window.electronAPI.sourceSelected(selectedSourceId);
      
      // Enable start recording button now that a source is selected
      startRecordingBtn.disabled = false;
      
      statusEl.textContent = `Ready to select display source when recording starts`;
      statusEl.className = 'status success';
    } else {
      // Disable start recording button when no source is selected
      startRecordingBtn.disabled = true;
    }
  });
  
  // Setup start recording button
  startRecordingBtn.addEventListener('click', async () => {
    console.log('Start Recording button clicked');
    recordingMessageEl.textContent = 'Preparing to record...';
    recordingMessageEl.className = 'pending';
    
    try {
      // Get the selected source ID from the dropdown or open dialog
      const sourceSelect = document.getElementById('sourceSelect');
      const selectedSourceId = sourceSelect.value;
      
      // Get stream for the selected source
      console.log('Getting stream for selected source:', selectedSourceId);
      
      try {
        const stream = await getSourceStream(selectedSourceId);
        
        // Update message after successful stream capture
        recordingMessageEl.textContent = 'Setting up recording with selected source...';
        
        // Setup canvas rendering with the stream
        console.log('Setting up canvas rendering');
        if (!await setupCanvasRendering(stream)) {
          throw new Error('Failed to setup canvas rendering');
        }
        
        // Setup media recorder
        console.log('Setting up media recorder');
        if (!setupMediaRecorder()) {
          throw new Error('Failed to setup media recorder');
        }
        
        // Start canvas recording
        console.log('Starting canvas recording');
        if (startCanvasRecording()) {
          console.log('Canvas recording started successfully');
        } else {
          throw new Error('Failed to start canvas recording');
        }
      } catch (streamError) {
        // If the error is because the user canceled the source selection,
        // just reset the state without showing an error
        if (streamError.message === 'Source selection canceled') {
          recordingMessageEl.textContent = 'Recording canceled';
          recordingMessageEl.className = '';
          setTimeout(() => {
            recordingMessageEl.textContent = '';
          }, 2000);
          return;
        }
        
        // Otherwise rethrow
        throw streamError;
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      recordingMessageEl.textContent = `Error: ${error.message}`;
      recordingMessageEl.className = 'error';
    }
  });
  
  // Setup stop recording button
  stopRecordingBtn.addEventListener('click', async () => {
    console.log('Stop Recording button clicked');
    recordingMessageEl.textContent = 'Stopping recording...';
    recordingMessageEl.className = 'pending';
    
    if (stopCanvasRecording()) {
      statusEl.textContent = 'Recording stopped, processing video...';
      statusEl.className = 'status pending';
    } else {
      statusEl.textContent = 'Error stopping recording';
      statusEl.className = 'status error';
      recordingMessageEl.textContent = 'Error stopping recording';
      recordingMessageEl.className = 'error';
    }
  });
  
  // Setup pause recording button
  pauseRecordingBtn.addEventListener('click', async () => {
    console.log('Pause Recording button clicked');
    
    if (pauseCanvasRecording()) {
      // UI will be updated via the state update from main process
      window.electronAPI.pauseRecording(); // Notify main process
    } else {
      statusEl.textContent = 'Error pausing recording';
      statusEl.className = 'status error';
    }
  });
  
  // Setup resume recording button
  resumeRecordingBtn.addEventListener('click', async () => {
    console.log('Resume Recording button clicked');
    
    if (resumeCanvasRecording()) {
      // UI will be updated via the state update from main process
      window.electronAPI.resumeRecording(); // Notify main process
    } else {
      statusEl.textContent = 'Error resuming recording';
      statusEl.className = 'status error';
    }
  });
  
  // Listen for hotkey-triggered recording start/pause/resume
  window.electronAPI.on('hotkey-start-recording', async () => {
    console.log('Hotkey-triggered cycle: Start→Pause→Resume→Pause...');
    
    // Check current recording state to determine next action
    if (!isRecording) {
      // STATE: Not recording -> Start recording
      console.log('Hotkey action: START recording');
      
      // Check if we have a source selected
      const selectedSourceId = sourceSelect.value;
      if (!selectedSourceId) {
        statusEl.textContent = 'Please select a source first';
        statusEl.className = 'status error';
        return;
      }
      
      // Start recording
      startRecordingBtn.click();
    } 
    else if (isRecording && !isPaused) {
      // STATE: Recording and not paused -> Pause recording
      console.log('Hotkey action: PAUSE recording');
      pauseRecordingBtn.click();
    }
    else if (isRecording && isPaused) {
      // STATE: Recording and paused -> Resume recording
      console.log('Hotkey action: RESUME recording');
      resumeRecordingBtn.click();
    }
  });
  
  // Listen for recording MIME type information
  window.electronAPI.on('recordingMimeType', ({ mimeType }) => {
    console.log('Recording MIME type:', mimeType);
    
    // Update recording message with format information
    let formatLabel = 'MP4/H.264';
    if (mimeType.includes('webm')) {
      if (mimeType.includes('vp9')) {
        formatLabel = 'WebM/VP9';
      } else if (mimeType.includes('h264')) {
        formatLabel = 'WebM/H.264';
      } else {
        formatLabel = 'WebM';
      }
    } else if (mimeType.includes('hvc1')) {
      formatLabel = 'MP4/HEVC';
    }
    
    if (recordingMessageEl.textContent.includes('Recording in progress')) {
      recordingMessageEl.textContent = `Recording in progress... (${formatLabel})`;
    }
  });
  
  // Listen for state updates from main process
  window.electronAPI.on('updateState', (state) => {
    console.log('State update received:', state);
    updateUIState(state);
  });
  
  // Listen for disk space warnings
  window.electronAPI.onDiskSpaceWarning((data) => {
    console.log('Disk space warning:', data);
    updateDiskSpaceUI(data);
  });
  
  // Listen for concatenation status updates
  window.electronAPI.onConcatenationStatus((data) => {
    console.log('Concatenation status update:', data);
    updateConcatenationUI(data);
  });
  
  // Listen for recording limit reached
  window.electronAPI.onRecordingLimitReached(() => {
    console.log('Recording limit reached (2 hours)');
    
    // Update UI to show limit reached message
    statusEl.textContent = 'Recording stopped: 2-hour limit reached';
    statusEl.className = 'status warning';
    
    recordingMessageEl.textContent = 'Recording stopped automatically after reaching the 2-hour limit';
    recordingMessageEl.className = 'warning';
    
    // Stop the recording
    stopCanvasRecording();
  });
  
  // Listen for recording errors
  window.electronAPI.on('recordingError', (error) => {
    console.error('Recording error:', error);
    
    statusEl.textContent = `Recording error: ${error}`;
    statusEl.className = 'status error';
    
    recordingMessageEl.textContent = `Error: ${error}`;
    recordingMessageEl.className = 'error';
    
    // Reset UI state to not recording
    updateUIState({ isRecording: false, isPaused: false });
  });
  
  // Listen for recording saved notification
  window.electronAPI.on('recordingSaved', async (filePath) => {
    console.log('Recording saved:', filePath);
    
    // Update UI
    statusEl.textContent = 'Recording saved successfully';
    statusEl.className = 'status success';
    
    recordingMessageEl.textContent = `Recording saved to: ${filePath}`;
    recordingMessageEl.className = 'success';
    
    // Add a button to open the file
    const openButton = document.createElement('button');
    openButton.textContent = 'Open Recording';
    openButton.className = 'btn primary open-file-btn';
    openButton.onclick = () => {
      window.electronAPI.openFile(filePath);
    };
    
    // Add the button to the recording message element
    recordingMessageEl.appendChild(document.createElement('br'));
    recordingMessageEl.appendChild(openButton);
  });
});

// Function to initialize zoom control buttons
function initializeZoomControls() {
    const zoomInButton = document.getElementById('zoom-in');
    const zoomOutButton = document.getElementById('zoom-out');
    const resetZoomButton = document.getElementById('reset-zoom');
    
    if (zoomInButton) {
        zoomInButton.addEventListener('click', () => {
            zoomIn();
        });
    }
    
    if (zoomOutButton) {
        zoomOutButton.addEventListener('click', () => {
            zoomOut();
        });
    }
    
    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', () => {
            currentPresetIndex = 0;
            setZoom(zoomPresets[currentPresetIndex], 1920, 1080);
        });
    }
    
    // Add wheel zoom event listener to the document
    document.addEventListener('wheel', (event) => {
        // Check if Command (Meta) key is pressed on macOS
        if (event.metaKey) {
            // Prevent default scroll behavior
            event.preventDefault();
            
            // Get canvas element for position calculation
            const canvas = app ? app.view : document.getElementById('canvas');
            if (!canvas) return;
            
            // Get canvas bounding rect to convert screen coordinates to canvas coordinates
            const canvasRect = canvas.getBoundingClientRect();
            
            // Calculate cursor position relative to the canvas
            const cursorX = event.clientX - canvasRect.left;
            const cursorY = event.clientY - canvasRect.top;
            
            // Convert cursor position to video coordinates
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const videoWidth = sourceVideo && sourceVideo.videoWidth > 0 ? sourceVideo.videoWidth : 3840;
            const videoHeight = sourceVideo && sourceVideo.videoHeight > 0 ? sourceVideo.videoHeight : 2160;
            
            // Calculate the scale to convert canvas coordinates to video coordinates
            const scaleX = videoWidth / canvasWidth;
            const scaleY = videoHeight / canvasHeight;
            
            // Convert cursor position to video coordinates
            const videoCursorX = cursorX * scaleX;
            const videoCursorY = cursorY * scaleY;
            
            // Determine zoom direction based on wheel delta
            if (event.deltaY < 0) {
                // Wheel up - zoom in
                zoomIn(videoCursorX, videoCursorY);
            } else {
                // Wheel down - zoom out
                zoomOut(videoCursorX, videoCursorY);
            }
        }
    }, { passive: false }); // passive: false is required to be able to call preventDefault()
}

// Function to find the closest preset based on the current zoom level
function findClosestPresetIndex(currentZoom) {
    let closestIndex = 0;
    let minDiff = Math.abs(zoomPresets[0] - currentZoom);
    
    for (let i = 1; i < zoomPresets.length; i++) {
        const diff = Math.abs(zoomPresets[i] - currentZoom);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }
    
    return closestIndex;
}

// Function to zoom in using presets
function zoomIn(centerX, centerY) {
    // Find the current index based on the closest preset
    currentPresetIndex = findClosestPresetIndex(state.currentZoom);
    
    // Move to the next preset if not already at max
    if (currentPresetIndex < zoomPresets.length - 1) {
        currentPresetIndex++;
    }
    
    // Apply the zoom
    const newZoom = zoomPresets[currentPresetIndex];
    
    // If centerX and centerY are provided, use them, otherwise keep the current center
    const targetX = (centerX !== undefined) ? centerX : state.currentCenterX;
    const targetY = (centerY !== undefined) ? centerY : state.currentCenterY;
    
    setZoom(newZoom, targetX, targetY);
    console.log(`Zoomed in to preset: ${newZoom}x at (${targetX}, ${targetY})`);
}

// Function to zoom out using presets
function zoomOut(centerX, centerY) {
    // Find the current index based on the closest preset
    currentPresetIndex = findClosestPresetIndex(state.currentZoom);
    
    // Move to the previous preset if not already at min
    if (currentPresetIndex > 0) {
        currentPresetIndex--;
    }
    
    // Apply the zoom
    const newZoom = zoomPresets[currentPresetIndex];
    
    // If centerX and centerY are provided, use them, otherwise keep the current center
    // For zoom out to 1.0, always return to the center of the video
    let targetX, targetY;
    if (newZoom === 1.0) {
        // Return to center when zooming back to 1.0
        const videoWidth = sourceVideo && sourceVideo.videoWidth > 0 ? sourceVideo.videoWidth : 3840;
        const videoHeight = sourceVideo && sourceVideo.videoHeight > 0 ? sourceVideo.videoHeight : 2160;
        targetX = videoWidth / 2;
        targetY = videoHeight / 2;
    } else {
        targetX = (centerX !== undefined) ? centerX : state.currentCenterX;
        targetY = (centerY !== undefined) ? centerY : state.currentCenterY;
    }
    
    setZoom(newZoom, targetX, targetY);
    console.log(`Zoomed out to preset: ${newZoom}x at (${targetX}, ${targetY})`);
}

// After the DOMContentLoaded block, add global keyboard shortcut
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    console.log('Escape key pressed - attempting to stop recording');
    const recordingMessageEl = document.getElementById('recordingMessage');
    recordingMessageEl.textContent = 'Stopping recording via keyboard shortcut...';
    recordingMessageEl.className = 'pending';
    
    // Force trigger the stop recording
    window.electronAPI.stopRecording();
  }
}); 

// Add listeners for zoom commands from main process (near the initializeZoomControls function)
// This can be placed at the end of the file or in an initialization function

function initializeZoomControls() {
    const zoomInButton = document.getElementById('zoom-in');
    const zoomOutButton = document.getElementById('zoom-out');
    const resetZoomButton = document.getElementById('reset-zoom');
    
    if (zoomInButton) {
        zoomInButton.addEventListener('click', () => {
            const newZoom = state.currentZoom * 1.2;
            setZoom(newZoom, state.currentCenterX, state.currentCenterY);
        });
    }
    
    if (zoomOutButton) {
        zoomOutButton.addEventListener('click', () => {
            const newZoom = state.currentZoom / 1.2;
            setZoom(newZoom, state.currentCenterX, state.currentCenterY);
        });
    }
    
    if (resetZoomButton) {
        resetZoomButton.addEventListener('click', () => {
            setZoom(1.0, 1920, 1080);
        });
    }
}

// Add listeners for IPC commands from panel window
window.electronAPI.on('zoom-in', () => {
    console.log('Received zoom-in command from panel');
    zoomIn();
});

window.electronAPI.on('zoom-out', () => {
    console.log('Received zoom-out command from panel');
    zoomOut();
});

window.electronAPI.on('toggle-pip', () => {
    console.log('Received toggle-pip command from panel');
    togglePip();
});

// Function to toggle Picture-in-Picture mode
function togglePip() {
  try {
    console.log(`Toggling PiP. Current state: ${isPipVisible}`);
    
    // Toggle PiP state
    isPipVisible = !isPipVisible;
    console.log(`New PiP state: ${isPipVisible}`);
    
    // Update the PiP state in main process
    window.electronAPI.sendPipStateUpdate(isPipVisible);
    console.log('Sent PiP state update to main process');
    
    if (isPipVisible) {
      console.log('PiP activated - setting up snapshot interval');
      
      // Clear any existing interval
      if (pipSnapshotInterval) {
        clearInterval(pipSnapshotInterval);
        pipSnapshotInterval = null;
      }
      
      // Send an immediate snapshot to initialize the display
      setTimeout(() => {
        console.log('Sending immediate PiP snapshot');
        const result = sendPipSnapshot();
        console.log('Initial PiP snapshot sent result:', result);
      }, 100);
      
      // Start regular updates with appropriate interval
      const updateInterval = isRecording ? 750 : PIP_UPDATE_INTERVAL;
      console.log(`Starting PiP updates with interval ${updateInterval}ms`);
      
      pipSnapshotInterval = setInterval(() => {
        try {
          sendPipSnapshot();
        } catch (err) {
          console.error('Error in PiP snapshot interval:', err);
        }
      }, updateInterval);
    } else {
      console.log('PiP deactivated - cleaning up');
      
      // Stop sending snapshots
      if (pipSnapshotInterval) {
        console.log('Clearing PiP snapshot interval');
        clearInterval(pipSnapshotInterval);
        pipSnapshotInterval = null;
      }
      
      // Clear last update time
      lastPipUpdateTime = 0;
    }
    
    return true;
  } catch (error) {
    console.error('Error toggling PiP mode:', error);
    return false;
  }
}

// Function to send a snapshot to the PiP window
function sendPipSnapshot() {
  try {
    // Skip if PiP is not visible
    if (!isPipVisible) {
      console.log('PiP not visible, skipping snapshot');
      return false;
    }
    
    // Throttle updates to improve performance
    const now = Date.now();
    const updateInterval = isRecording ? 750 : PIP_UPDATE_INTERVAL; // More aggressive throttling during recording
    if (now - lastPipUpdateTime < updateInterval) {
      console.log('Throttling PiP snapshot, too soon since last update');
      return false;
    }
    
    lastPipUpdateTime = now;
    
    // Debug log to track PiP snapshot generation
    console.log('Generating PiP snapshot');
    
    // Get canvas element - ensure it exists
    const canvasElement = document.getElementById('main-canvas');
    if (!canvasElement) {
      console.error('Cannot find main-canvas element for PiP snapshot');
      return false;
    }
    
    console.log('Canvas element found for snapshot, dimensions:', canvasElement.width, 'x', canvasElement.height);
    
    // Make sure we have a valid source video
    if (!sourceVideo) {
      sourceVideo = document.getElementById('source-video');
      if (!sourceVideo) {
        console.error('Source video element not found for PiP snapshot');
        return false;
      }
    }
    
    // Check if source video is ready
    if (!sourceVideo.videoWidth || !sourceVideo.videoHeight) {
      console.warn('Source video dimensions not available. Video readyState:', sourceVideo.readyState);
      
      // If video isn't ready but we have a direct reference to the element with content,
      // try to use it directly
      const visibleVideo = document.getElementById('source-video');
      if (visibleVideo && visibleVideo.videoWidth && visibleVideo.videoHeight) {
        console.log('Found visible source video element with dimensions:', visibleVideo.videoWidth, 'x', visibleVideo.videoHeight);
        sourceVideo = visibleVideo;
      } else if (visibleVideo && visibleVideo.srcObject) {
        console.log('Found visible source video with srcObject, but no dimensions yet');
        sourceVideo = visibleVideo;
      } else {
        console.warn('No valid source video found for PiP snapshot');
        
        // Create a test pattern instead
        return sendTestPatternToPip(canvasElement.width, canvasElement.height);
      }
    }
    
    console.log('Source video ready, dimensions:', sourceVideo.videoWidth, 'x', sourceVideo.videoHeight);
    
    // Create a temporary canvas for the snapshot
    // Using a scaled-down version to improve performance
    const tempCanvas = document.createElement('canvas');
    const scale = isRecording ? 0.25 : 0.4; // Balance between performance and quality
    
    // Use source video dimensions if canvas dimensions are not available
    let baseWidth = canvasElement.width;
    let baseHeight = canvasElement.height;
    
    // If canvas dimensions are zero, try to use the source video dimensions
    if (baseWidth === 0 || baseHeight === 0) {
      if (sourceVideo.videoWidth && sourceVideo.videoHeight) {
        baseWidth = sourceVideo.videoWidth;
        baseHeight = sourceVideo.videoHeight;
        console.log('Using source video dimensions for snapshot:', baseWidth, 'x', baseHeight);
      } else {
        // Fallback to default dimensions
        baseWidth = 3840;
        baseHeight = 2160;
        console.log('Using default dimensions for snapshot:', baseWidth, 'x', baseHeight);
      }
    }
    
    tempCanvas.width = Math.floor(baseWidth * scale);
    tempCanvas.height = Math.floor(baseHeight * scale);
    
    console.log('Created temp canvas for snapshot, dimensions:', tempCanvas.width, 'x', tempCanvas.height);
    
    // Get 2D context, falling back to standard options if creation fails
    let tempCtx;
    try {
      tempCtx = tempCanvas.getContext('2d', { alpha: false });
      // Use medium quality interpolation for better visuals while maintaining performance
      tempCtx.imageSmoothingQuality = isRecording ? 'low' : 'medium';
    } catch (e) {
      console.warn('Failed to create optimized canvas context, using default:', e);
      tempCtx = tempCanvas.getContext('2d');
    }
    
    if (!tempCtx) {
      console.error('Failed to get 2D context for PiP canvas');
      return false;
    }
    
    // Use a simpler approach - draw directly from source video for reliability
    try {
      // Fill with black background first
      tempCtx.fillStyle = '#000';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      
      let drawSucceeded = false;
      
      // Try multiple methods to get content for PiP, in order of preference:
      
      // 1. Try drawing from the main PIXI canvas first if it's available
      if (usePixi && app && app.view) {
        try {
          console.log('Drawing from Pixi canvas to PiP snapshot');
          tempCtx.drawImage(app.view, 0, 0, tempCanvas.width, tempCanvas.height);
          
          // Check if drawing succeeded by examining non-black pixels
          const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          const data = imageData.data;
          
          // Check a sample of pixels to see if canvas has content
          for (let i = 0; i < data.length; i += 16) {
            // If we find any non-black pixel, consider the drawing successful
            if (data[i] > 5 || data[i+1] > 5 || data[i+2] > 5) {
              drawSucceeded = true;
              break;
            }
          }
          
          if (!drawSucceeded) {
            console.warn('Drawing from Pixi canvas yielded a blank image, trying source video instead');
          }
        } catch (err) {
          console.error('Failed to draw from Pixi canvas:', err);
          drawSucceeded = false;
        }
      }
      
      // 2. If Pixi drawing failed or resulted in blank canvas, try drawing from source video
      if (!drawSucceeded && sourceVideo) {
        try {
          console.log('Drawing from source video to PiP snapshot');
          
          // Check if source video has actual content
          if (sourceVideo.videoWidth && sourceVideo.videoHeight) {
            tempCtx.drawImage(sourceVideo, 0, 0, tempCanvas.width, tempCanvas.height);
            drawSucceeded = true;
          } else {
            console.warn('Source video has no dimensions (videoWidth/Height)');
          }
        } catch (err) {
          console.error('Failed to draw from source video:', err);
          drawSucceeded = false;
        }
      }
      
      // 3. If all above methods failed, generate a test pattern
      if (!drawSucceeded) {
        console.warn('All drawing methods failed, generating test pattern');
        drawTestPattern(tempCtx, tempCanvas.width, tempCanvas.height);
        drawSucceeded = true;
      }
      
      // Overlay zoom rectangle if we're zoomed in
      if (state.currentZoom > 1.0) {
        // Calculate visible area
        const visibleWidth = tempCanvas.width / state.currentZoom;
        const visibleHeight = tempCanvas.height / state.currentZoom;
        
        // Center point
        const centerX = tempCanvas.width / 2;
        const centerY = tempCanvas.height / 2;
        
        // Draw rectangle around visible area
        tempCtx.strokeStyle = 'rgba(255, 95, 31, 0.8)'; // Orange from the border colors
        tempCtx.lineWidth = 2;
        tempCtx.strokeRect(
          centerX - visibleWidth/2,
          centerY - visibleHeight/2,
          visibleWidth,
          visibleHeight
        );
      }
      
      // Convert to data URL (JPEG for better performance compared to PNG)
      // Use medium quality for better visuals
      const jpegQuality = isRecording ? 0.7 : 0.8;
      const dataURL = tempCanvas.toDataURL('image/jpeg', jpegQuality);
      
      // Debug - log data size
      console.log(`PiP snapshot generated: ${Math.round(dataURL.length / 1024)}KB | Dimensions: ${tempCanvas.width}x${tempCanvas.height} | Quality: ${jpegQuality} | Update interval: ${updateInterval}ms`);
      
      // Send to main process
      window.electronAPI.sendPipFrameUpdate(dataURL);
      console.log('PiP snapshot sent to main process');
      
      return true;
    } catch (err) {
      console.error('Error drawing to PiP canvas:', err);
      return false;
    }
  } catch (error) {
    console.error('Error sending PiP snapshot:', error);
    return false;
  }
}

// Helper function to generate and send a test pattern for PiP
function sendTestPatternToPip(width, height) {
  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 210;  // Set appropriate dimensions for PiP
    tempCanvas.height = 118;
    
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return false;
    
    // Draw test pattern
    drawTestPattern(tempCtx, tempCanvas.width, tempCanvas.height);
    
    // Convert to data URL
    const dataURL = tempCanvas.toDataURL('image/jpeg', 0.8);
    
    // Send to main process
    window.electronAPI.sendPipFrameUpdate(dataURL);
    console.log('Test pattern PiP snapshot sent to main process');
    
    return true;
  } catch (error) {
    console.error('Error creating test pattern for PiP:', error);
    return false;
  }
}

// Helper function to draw a test pattern
function drawTestPattern(ctx, width, height) {
  // Fill background
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, width, height);
  
  // Draw gradient border
  const borderWidth = 10;
  
  // Top gradient
  const topGradient = ctx.createLinearGradient(0, 0, width, 0);
  topGradient.addColorStop(0, '#FF5F1F');
  topGradient.addColorStop(0.5, '#FF1F8E');
  topGradient.addColorStop(1, '#8A2BE2');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, width, borderWidth);
  
  // Bottom gradient
  const bottomGradient = ctx.createLinearGradient(0, 0, width, 0);
  bottomGradient.addColorStop(0, '#8A2BE2');
  bottomGradient.addColorStop(0.5, '#FF1F8E');
  bottomGradient.addColorStop(1, '#FF5F1F');
  ctx.fillStyle = bottomGradient;
  ctx.fillRect(0, height - borderWidth, width, borderWidth);
  
  // Left gradient
  const leftGradient = ctx.createLinearGradient(0, 0, 0, height);
  leftGradient.addColorStop(0, '#FF5F1F');
  leftGradient.addColorStop(0.5, '#FF1F8E');
  leftGradient.addColorStop(1, '#8A2BE2');
  ctx.fillStyle = leftGradient;
  ctx.fillRect(0, 0, borderWidth, height);
  
  // Right gradient
  const rightGradient = ctx.createLinearGradient(0, 0, 0, height);
  rightGradient.addColorStop(0, '#8A2BE2');
  rightGradient.addColorStop(0.5, '#FF1F8E');
  rightGradient.addColorStop(1, '#FF5F1F');
  ctx.fillStyle = rightGradient;
  ctx.fillRect(width - borderWidth, 0, borderWidth, height);
  
  // Add text
  ctx.fillStyle = '#FFF';
  ctx.font = `${Math.max(12, Math.floor(width/20))}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Waiting for video...', width/2, height/2);
  
  // Draw checkerboard pattern in the corners for visual interest
  const squareSize = 10;
  const cornerSize = 50;
  
  // Top-left corner
  drawCheckerboard(ctx, 0, 0, cornerSize, cornerSize, squareSize, '#444', '#333');
  
  // Top-right corner
  drawCheckerboard(ctx, width - cornerSize, 0, cornerSize, cornerSize, squareSize, '#444', '#333');
  
  // Bottom-left corner
  drawCheckerboard(ctx, 0, height - cornerSize, cornerSize, cornerSize, squareSize, '#444', '#333');
  
  // Bottom-right corner
  drawCheckerboard(ctx, width - cornerSize, height - cornerSize, cornerSize, cornerSize, squareSize, '#444', '#333');
}

// Helper function to draw a checkerboard pattern
function drawCheckerboard(ctx, x, y, width, height, squareSize, color1, color2) {
  for (let i = 0; i < width; i += squareSize) {
    for (let j = 0; j < height; j += squareSize) {
      ctx.fillStyle = (Math.floor(i / squareSize) + Math.floor(j / squareSize)) % 2 === 0 ? color1 : color2;
      ctx.fillRect(x + i, y + j, squareSize, squareSize);
    }
  }
}

// Function to send current zoom state to the panel
function sendZoomStateUpdate() {
    if (!isPipVisible) return;
    
    try {
        // Get canvas dimensions in a safe way
        let canvasWidth = 3840;  // Default to 4K width
        let canvasHeight = 2160; // Default to 4K height
        
        if (app) {
            // PIXI rendering mode
            canvasWidth = app.renderer.width;
            canvasHeight = app.renderer.height;
        } else if (canvasContext && canvasContext.canvas) {
            // Canvas2D rendering mode
            canvasWidth = canvasContext.canvas.width;
            canvasHeight = canvasContext.canvas.height;
        }
        
        const zoomState = {
            zoom: state.currentZoom,
            centerX: state.currentCenterX,
            centerY: state.currentCenterY,
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight
        };
        
        window.electronAPI.sendZoomStateUpdate(zoomState);
        
        // Also send video dimensions if we have a source video
        if (sourceVideo) {
            window.electronAPI.sendVideoSizeUpdate(sourceVideo.videoWidth, sourceVideo.videoHeight);
        }
    } catch (err) {
        console.error('Error sending zoom state update:', err);
    }
}

// Function to wait for video metadata to be loaded
function waitForVideoMetadata(videoElement) {
    return new Promise((resolve) => {
        if (videoElement.readyState >= 1) { // HAVE_METADATA or better
            resolve();
        } else {
            videoElement.addEventListener('loadedmetadata', () => {
                resolve();
            }, { once: true });
        }
    });
}

// Helper function to safely check codec support
function isCodecSupported(mimeType) {
  try {
    return MediaRecorder.isTypeSupported(mimeType);
  } catch (err) {
    console.warn(`Error checking support for ${mimeType}:`, err);
    return false;
  }
}

// Helper function to log performance metrics
function logPerformanceMetrics() {
  const now = performance.now();
  
  // Only log periodically to reduce console spam
  if (now - lastPerformanceLog < PERFORMANCE_LOG_INTERVAL) return;
  lastPerformanceLog = now;
  
  // Calculate fps from frame time history
  if (frameTimeHistory.length < 2) return;
  
  // Calculate average frame time
  let totalTime = 0;
  let droppedFrames = 0;
  
  for (let i = 1; i < frameTimeHistory.length; i++) {
    const frameTime = frameTimeHistory[i] - frameTimeHistory[i-1];
    totalTime += frameTime;
    
    // Count frames taking more than 20ms (< 50fps) as "dropped"
    if (frameTime > 20) {
      droppedFrames++;
    }
  }
  
  const avgFrameTime = totalTime / (frameTimeHistory.length - 1);
  const fps = 1000 / avgFrameTime;
  const dropRate = (droppedFrames / (frameTimeHistory.length - 1)) * 100;
  
  console.log(
    `Performance: ${fps.toFixed(1)} FPS, ` +
    `Avg frame time: ${avgFrameTime.toFixed(2)}ms, ` +
    `Dropped frames: ${dropRate.toFixed(2)}% (${droppedFrames}/${frameTimeHistory.length - 1})`
  );
  
  // Check against target thresholds from 14.md
  if (isRecording) {
    if (dropRate > 0.5) {
      console.warn(`WARNING: Dropped frame rate (${dropRate.toFixed(2)}%) exceeds target threshold (0.5%)`);
    }
    
    if (fps < 59.5) {
      console.warn(`WARNING: FPS (${fps.toFixed(1)}) is below target threshold (59.5)`);
    }
    
    // Memory usage monitoring
    if (window.performance && window.performance.memory) {
      const memUsageMB = window.performance.memory.usedJSHeapSize / (1024 * 1024);
      console.log(`Memory usage: ${memUsageMB.toFixed(2)} MB`);
    }
  }
  
  // Reset history after logging to only track recent performance
  frameTimeHistory = frameTimeHistory.slice(-MAX_FRAME_HISTORY/2);
}

// Function to track frame times for performance monitoring
function trackFrameTime() {
  const now = performance.now();
  frameTimeHistory.push(now);
  
  // Keep history limited to MAX_FRAME_HISTORY entries
  if (frameTimeHistory.length > MAX_FRAME_HISTORY) {
    frameTimeHistory.shift();
  }
  
  // Log metrics periodically
  if (isRecording) {
    logPerformanceMetrics();
  }
  
  // Schedule next tracking
  requestAnimationFrame(trackFrameTime);
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded - setting up app');
  
  // Start tracking frame times for performance monitoring
  trackFrameTime();
  
  // Set up IPC listeners
  setupIpcListeners();
  
  // Initialize UI and canvas
  initializeUI();
});

// Set up IPC event listeners
function setupIpcListeners() {
  console.log('Setting up IPC event listeners');
  
  // Listen for toggle-pip event from main process
  window.electronAPI.on('toggle-pip', () => {
    console.log('Received toggle-pip event from main process');
    togglePip();
  });
  
  // Listen for zoom-in event from main process
  window.electronAPI.on('zoom-in', () => {
    console.log('Received zoom-in event from main process');
    zoomIn();
  });
  
  // Listen for zoom-out event from main process
  window.electronAPI.on('zoom-out', () => {
    console.log('Received zoom-out event from main process');
    zoomOut();
  });
  
  // Listen for set-zoom-center event from main process
  window.electronAPI.on('set-zoom-center', (coords) => {
    console.log(`Received set-zoom-center event: (${coords.x}, ${coords.y})`);
    setZoom(state.currentZoom, coords.x, coords.y);
  });
}

// Initialize UI elements and event handlers
function initializeUI() {
  // Add UI initialization here if needed
  console.log('Initializing UI components');
  
  // Set up test pattern button for debugging
  addDirectCaptureButton();
  
  // Add event listener for PiP toggle button
  const togglePipBtn = document.getElementById('togglePipBtn');
  if (togglePipBtn) {
    togglePipBtn.addEventListener('click', () => {
      console.log('Toggle PiP button clicked');
      togglePip();
    });
  }
}

// Function to handle zoom controls (both UI and keyboard/mouse)
function handleZoom(direction, intensity = 1, mouseX = null, mouseY = null) {
  if (!videoSprite || !sourceVideo || sourceVideo.readyState < 2) {
    console.warn('Cannot zoom: Video not ready');
    return;
  }
  
  const sourceWidth = sourceVideo.videoWidth;
  const sourceHeight = sourceVideo.videoHeight;
  
  // Get current scale
  const currentScale = state.targetZoom;
  
  // Calculate new zoom level based on direction and intensity
  let newScale = currentScale;
  if (direction === 'in') {
    newScale *= (1 + 0.15 * intensity);
  } else if (direction === 'out') {
    newScale /= (1 + 0.15 * intensity);
  } else if (direction === 'reset') {
    // Reset to original calculated scale based on aspect ratio
    newScale = state.baseScale;
  }
  
  // Enforce min/max zoom constraints
  newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
  
  // Update zoom UI indicator
  updateZoomPercentage(newScale);
  
  // Determine zoom center (where we're zooming into or out from)
  let zoomCenterX, zoomCenterY;
  
  if (mouseX !== null && mouseY !== null) {
    // Convert mouse coordinates to video coordinates
    const canvasRect = app.view.getBoundingClientRect();
    const mouseCanvasX = mouseX - canvasRect.left;
    const mouseCanvasY = mouseY - canvasRect.top;
    
    // Convert canvas coordinates to video texture coordinates
    const videoXRatio = (mouseCanvasX - (app.screen.width / 2 - videoSprite.width / 2)) / videoSprite.width;
    const videoYRatio = (mouseCanvasY - (app.screen.height / 2 - videoSprite.height / 2)) / videoSprite.height;
    
    // Calculate the actual coordinates in the video
    zoomCenterX = videoXRatio * sourceWidth;
    zoomCenterY = videoYRatio * sourceHeight;
  } else {
    // Use current center if no mouse coordinates provided
    zoomCenterX = state.targetCenterX;
    zoomCenterY = state.targetCenterY;
  }
  
  // Ensure the zoom center stays within the video bounds
  zoomCenterX = Math.max(0, Math.min(sourceWidth, zoomCenterX));
  zoomCenterY = Math.max(0, Math.min(sourceHeight, zoomCenterY));
  
  // Update target state for smooth transition
  state.targetZoom = newScale;
  state.targetCenterX = zoomCenterX;
  state.targetCenterY = zoomCenterY;
  
  console.log(`Zoom: ${newScale.toFixed(2)}x, Center: (${zoomCenterX.toFixed(0)}, ${zoomCenterY.toFixed(0)})`);
}

// Function to handle camera panning
function handlePan(deltaX, deltaY) {
  if (!videoSprite || !sourceVideo) return;
  
  const sourceWidth = sourceVideo.videoWidth;
  const sourceHeight = sourceVideo.videoHeight;
  
  // Convert delta in screen pixels to delta in video coordinates based on current zoom
  const videoFrameDeltaX = deltaX / state.currentZoom;
  const videoFrameDeltaY = deltaY / state.currentZoom;
  
  // Calculate new center position
  let newCenterX = state.targetCenterX - videoFrameDeltaX;
  let newCenterY = state.targetCenterY - videoFrameDeltaY;
  
  // Calculate bounds for panning to keep video visible at current zoom level
  const currentScaledWidth = sourceWidth * state.currentZoom;
  const currentScaledHeight = sourceHeight * state.currentZoom;
  
  // Calculate the maximum distance we can move the center point
  // This ensures a portion of the video always stays visible
  const maxOffsetX = Math.max(0, (currentScaledWidth - app.screen.width) / (2 * state.currentZoom));
  const maxOffsetY = Math.max(0, (currentScaledHeight - app.screen.height) / (2 * state.currentZoom));
  
  // Center of video
  const videoCenterX = sourceWidth / 2;
  const videoCenterY = sourceHeight / 2;
  
  // Limit the bounds of panning to keep video partially visible
  newCenterX = Math.max(videoCenterX - maxOffsetX, Math.min(videoCenterX + maxOffsetX, newCenterX));
  newCenterY = Math.max(videoCenterY - maxOffsetY, Math.min(videoCenterY + maxOffsetY, newCenterY));
  
  // Update target state for smooth transition
  state.targetCenterX = newCenterX;
  state.targetCenterY = newCenterY;
}

// Animation/rendering loop
function animate() {
  // Track frame performance
  trackFrameTime('render');
  
  // Existing animation code
  requestAnimationFrame(animate);
  
  if (videoSprite && sourceVideo && sourceVideo.readyState >= 2) {
    const sourceWidth = sourceVideo.videoWidth;
    const sourceHeight = sourceVideo.videoHeight;
    const canvasWidth = app.screen.width;
    const canvasHeight = app.screen.height;
    
    // Smoothly interpolate currentZoom towards targetZoom
    if (Math.abs(state.currentZoom - state.targetZoom) > 0.001) {
      state.currentZoom += (state.targetZoom - state.currentZoom) * 0.1;
    } else {
      state.currentZoom = state.targetZoom;
    }
    
    // Smoothly interpolate currentCenter towards targetCenter
    if (Math.abs(state.currentCenterX - state.targetCenterX) > 0.05 ||
        Math.abs(state.currentCenterY - state.targetCenterY) > 0.05) {
      state.currentCenterX += (state.targetCenterX - state.currentCenterX) * 0.1;
      state.currentCenterY += (state.targetCenterY - state.currentCenterY) * 0.1;
    } else {
      state.currentCenterX = state.targetCenterX;
      state.currentCenterY = state.targetCenterY;
    }
    
    // Get the center point of the video
    const videoCenterX = sourceWidth / 2;
    const videoCenterY = sourceHeight / 2;
    
    // Calculate offset from center (how much we've panned)
    const offsetX = state.currentCenterX - videoCenterX;
    const offsetY = state.currentCenterY - videoCenterY;
    
    // Calculate the scale based on current zoom level and base scale
    const scaleFactor = state.currentZoom;
    
    // Calculate the width and height of the video sprite at the current scale
    const scaledWidth = sourceWidth * scaleFactor;
    const scaledHeight = sourceHeight * scaleFactor;
    
    // Update sprite scale
    videoSprite.scale.x = scaleFactor;
    videoSprite.scale.y = scaleFactor;
    
    // Update sprite position to center in canvas with offset applied
    videoSprite.x = canvasWidth / 2 - (offsetX * scaleFactor);
    videoSprite.y = canvasHeight / 2 - (offsetY * scaleFactor);
    
    // Force PIXI to update the texture from the video source
    if (videoTexture) {
      videoTexture.update();
    }
  }
  
  // Render the scene
  app.renderer.render(app.stage);
}

// Function to initialize mouse and keyboard controls for zooming and panning
function initializeZoomPanControls() {
  const canvas = document.getElementById('main-canvas');
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let panningEnabled = true;
  
  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    // Check if the video is loaded and ready
    if (!videoSprite || !sourceVideo || sourceVideo.readyState < 2) return;
    
    // Determine zoom direction based on wheel delta
    const direction = e.deltaY < 0 ? 'in' : 'out';
    
    // Calculate intensity based on wheel delta
    const intensity = Math.min(1.5, Math.abs(e.deltaY) / 100);
    
    // Call zoom function with mouse position for center point
    handleZoom(direction, intensity, e.clientX, e.clientY);
    
    // Track performance metrics when zooming
    trackFrameTime('wheel_zoom');
  }, { passive: false });
  
  // Mouse down for panning
  canvas.addEventListener('mousedown', (e) => {
    if (!panningEnabled || !videoSprite) return;
    
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
  });
  
  // Mouse move for panning
  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !panningEnabled || !videoSprite) return;
    
    const deltaX = e.clientX - lastX;
    const deltaY = e.clientY - lastY;
    
    // Only pan if there's significant movement (reduces jitter)
    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      handlePan(deltaX, deltaY);
      trackFrameTime('mouse_pan');
    }
    
    lastX = e.clientX;
    lastY = e.clientY;
  });
  
  // Mouse up to stop panning
  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'default';
    }
  });
  
  // Mouse leave to stop panning
  canvas.addEventListener('mouseleave', () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'default';
    }
  });
  
  // Keyboard zoom controls
  window.addEventListener('keydown', (e) => {
    // Skip if inside an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    // Cmd/Ctrl + Plus = Zoom In
    if (e.key === '=' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleZoom('in', 1);
      trackFrameTime('keyboard_zoom_in');
    }
    // Cmd/Ctrl + Minus = Zoom Out
    else if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleZoom('out', 1);
      trackFrameTime('keyboard_zoom_out');
    }
    // Cmd/Ctrl + 0 = Reset Zoom
    else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleZoom('reset');
      trackFrameTime('keyboard_zoom_reset');
    }
    // Arrow keys for panning when zoomed in
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (state.currentZoom > state.baseScale * 1.05) {
        e.preventDefault();
        const panSpeed = 10;
        const deltaX = e.key === 'ArrowLeft' ? panSpeed : (e.key === 'ArrowRight' ? -panSpeed : 0);
        const deltaY = e.key === 'ArrowUp' ? panSpeed : (e.key === 'ArrowDown' ? -panSpeed : 0);
        handlePan(deltaX, deltaY);
        trackFrameTime('keyboard_pan');
      }
    }
  });
  
  // Toggle panning with 'p' key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      panningEnabled = !panningEnabled;
      canvas.style.cursor = panningEnabled ? 'default' : 'not-allowed';
      console.log(`Panning ${panningEnabled ? 'enabled' : 'disabled'}`);
    }
  });
  
  // Double-click to reset zoom and position
  canvas.addEventListener('dblclick', () => {
    handleZoom('reset');
    trackFrameTime('dblclick_reset');
  });
  
  console.log('Zoom and pan controls initialized');
}

// Function to update the zoom percentage display in the UI
function updateZoomPercentage(scale) {
  const percentElement = document.getElementById('zoom-percentage');
  if (percentElement) {
    const percent = Math.round(scale * 100);
    percentElement.textContent = `${percent}%`;
  }
}

// Function to start recording
function startRecording() {
  if (recording) return;
  recording = true;
  
  // Start performance monitoring with recording flag
  startPerformanceMonitoring(true);
  performanceMetrics.isRecording = true;

  // Reset performance counters
  lastPerformanceLog = performance.now();
  
  // ... existing recording start code ...
}

// Function to stop recording
function stopRecording() {
  if (!recording) return;
  recording = false;
  
  // Stop recording mode in performance monitoring
  performanceMetrics.isRecording = false;
  
  // Log final performance metrics
  const stats = getPerformanceStats();
  console.log('Recording performance summary:', stats);
  
  // ... existing recording stop code ...
}

// Initialize application when document is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Start performance monitoring
  startPerformanceMonitoring();
  
  // Initialize codec selection
  initializeCodecSelection();
  
  // Initialize zoom and pan controls
  initializeZoomPanControls();
  
  // ... existing initialization code ...
  
  // Start animation loop
  animate();
});

// Function to initialize codec selection
function initializeCodecSelection() {
  // Create codec selection UI
  const codecSelector = document.createElement('div');
  codecSelector.id = 'codec-selector';
  codecSelector.className = 'codec-selector';
  
  const codecOptions = [
    { value: 'h264', label: 'H.264 (Compatibility)' },
    { value: 'hevc', label: 'HEVC (Higher Quality/Smaller Size)', default: true },
    { value: 'vp9', label: 'VP9 (Alternative)' }
  ];
  
  // Create HTML for codec selector
  codecSelector.innerHTML = `
    <span>Codec:</span>
    <select id="codec-select">
      ${codecOptions.map(codec => 
        `<option value="${codec.value}" ${codec.default ? 'selected' : ''}>${codec.label}</option>`
      ).join('')}
    </select>
  `;
  
  // Add to document
  document.body.appendChild(codecSelector);
  
  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .codec-selector {
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px;
      border-radius: 4px;
      font-family: sans-serif;
      font-size: 12px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .codec-selector select {
      background: #333;
      color: white;
      border: 1px solid #555;
      border-radius: 3px;
      padding: 3px;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
  
  // Add event listener to update codec preference
  document.getElementById('codec-select').addEventListener('change', (e) => {
    const selectedCodec = e.target.value;
    // Send to main process
    if (window.electronAPI && window.electronAPI.send) {
      window.electronAPI.send('set-codec', selectedCodec);
      console.log(`Codec set to: ${selectedCodec}`);
    } else {
      console.warn('electronAPI.send not available for set-codec');
    }
  });
  
  // Send initial codec preference
  const initialCodec = document.getElementById('codec-select').value;
  if (window.electronAPI && window.electronAPI.send) {
    window.electronAPI.send('set-codec', initialCodec);
  } else {
    console.warn('electronAPI.send not available for set-codec initial value');
  }
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error);
  
  try {
    // Report error to main process if electronAPI is available
    if (window.electronAPI && window.electronAPI.reportError) {
      window.electronAPI.reportError({
        message: event.error ? event.error.message : 'Unknown renderer error',
        stack: event.error ? event.error.stack : '',
        timestamp: new Date().toISOString()
      });
    }
    
    // Show error to user
    const errorMessage = event.error ? event.error.message : 'An unknown error occurred';
    showErrorMessage(errorMessage);
  } catch (error) {
    console.error('Error in error handler:', error);
  }
});

// Show error message to user
function showErrorMessage(message) {
  try {
    const recordingMessage = document.getElementById('recordingMessage');
    if (recordingMessage) {
      recordingMessage.textContent = `Error: ${message}`;
      recordingMessage.classList.add('error');
    }
  } catch (error) {
    console.error('Error showing error message:', error);
  }
}

// Performance monitoring
let performanceWarningTimeout = null;
let lastFpsDropTime = 0;
const PERFORMANCE_WARNING_THRESHOLD = 59; // FPS
const PERFORMANCE_WARNING_INTERVAL = 5000; // ms
const PERFORMANCE_WARNING_DURATION = 3000; // ms

// Function to show/hide performance warning
function togglePerformanceWarning(show) {
  try {
    const warningElement = document.getElementById('performance-warning');
    if (!warningElement) return;
    
    if (show) {
      warningElement.style.display = 'block';
      
      // Auto-hide after a few seconds
      if (performanceWarningTimeout) {
        clearTimeout(performanceWarningTimeout);
      }
      
      performanceWarningTimeout = setTimeout(() => {
        warningElement.style.display = 'none';
        performanceWarningTimeout = null;
      }, PERFORMANCE_WARNING_DURATION);
    } else {
      warningElement.style.display = 'none';
      if (performanceWarningTimeout) {
        clearTimeout(performanceWarningTimeout);
        performanceWarningTimeout = null;
      }
    }
  } catch (error) {
    console.error('Error toggling performance warning:', error);
  }
}

// Function to check FPS and show warning if needed
function checkPerformance(fps) {
  try {
    const now = Date.now();
    
    // Only show warning if it's been a while since the last one
    if (fps < PERFORMANCE_WARNING_THRESHOLD && 
        now - lastFpsDropTime > PERFORMANCE_WARNING_INTERVAL) {
      console.warn(`Performance issue detected: ${fps.toFixed(1)} FPS`);
      togglePerformanceWarning(true);
      lastFpsDropTime = now;
    }
  } catch (error) {
    console.error('Error checking performance:', error);
  }
}

// Safe MediaRecorder creation
function createMediaRecorder(stream, options) {
  try {
    const recorder = new MediaRecorder(stream, options);
    
    // Set up error handler
    recorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
      
      // Report to main process
      if (window.electronAPI && window.electronAPI.reportError) {
        window.electronAPI.reportError({
          message: event.error ? event.error.message : 'Unknown MediaRecorder error',
          stack: 'MediaRecorder.onerror',
          timestamp: new Date().toISOString()
        });
      }
      
      // Show error to user
      showErrorMessage(event.error ? event.error.message : 'Recording error occurred');
      
      // Stop recording if it's still active
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (stopError) {
          console.error('Error stopping recorder after error:', stopError);
        }
      }
    };
    
    return recorder;
  } catch (error) {
    console.error('Error creating MediaRecorder:', error);
    
    // Report to main process
    if (window.electronAPI && window.electronAPI.reportError) {
      window.electronAPI.reportError({
        message: error.message || 'Failed to create MediaRecorder',
        stack: error.stack || '',
        timestamp: new Date().toISOString()
      });
    }
    
    // Show error to user
    showErrorMessage(error.message || 'Failed to create recorder');
    throw error;
  }
}
