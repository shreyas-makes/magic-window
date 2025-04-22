// This file runs in the renderer process
// Import path module from Node.js through the preload script
const path = { sep: '/' }; // Simple path separator for use in the renderer

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

// Zoom variables
let zoomLevel = 1.0; // Default zoom level
let zoomCenterX = 1920; // Default center X (assuming 3840x2160 canvas)
let zoomCenterY = 1080; // Default center Y (assuming 3840x2160 canvas)

// Timer variables
let timerInterval = null;
let secondsElapsed = 0;

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
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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

// Initialize Pixi.js
function initializePixi() {
  try {
    // Get canvas element
    const canvasElement = document.getElementById('main-canvas');
    if (!canvasElement) {
      throw new Error('Canvas element not found');
    }
    
    // Get video element
    sourceVideo = document.getElementById('source-video');
    if (!sourceVideo) {
      throw new Error('Source video element not found');
    }
    
    // Set canvas size to match desired dimensions (4K)
    canvasElement.width = 3840;
    canvasElement.height = 2160;
    
    // Log actual display size vs internal resolution
    console.log(`Canvas display size: ${canvasElement.clientWidth}x${canvasElement.clientHeight}`);
    console.log(`Canvas internal resolution: ${canvasElement.width}x${canvasElement.height}`);
    
    // First try to initialize Canvas 2D as fallback
    try {
      console.log('Trying to initialize Canvas 2D context first');
      canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
      
      if (!canvasContext) {
        console.error('Failed to get 2D context - this is unusual');
      } else {
        console.log('Canvas 2D context initialized successfully');
        // Fill with black initially
        canvasContext.fillStyle = '#000000';
        canvasContext.fillRect(0, 0, canvasElement.width, canvasElement.height);
      }
    } catch (canvas2dError) {
      console.error('Error initializing 2D context:', canvas2dError);
    }
    
    // Try to initialize PIXI
    try {
      // Create a new PIXI Application with compatibility options
      const options = {
        view: canvasElement,
        width: canvasElement.width,
        height: canvasElement.height,
        backgroundColor: 0x000000,
        resolution: 1,
        autoDensity: true,
        antialias: false, // Better performance without antialiasing
        forceCanvas: true // Force Canvas renderer for better compatibility
      };
      
      // Create the application
      app = new PIXI.Application(options);
      
      // Log PIXI information
      logPixiInfo();
      
      // PIXI initialization was successful
      usePixi = true;
      console.log('PIXI.js initialized successfully');
    } catch (pixiError) {
      console.error('Error initializing PIXI.js:', pixiError);
      console.log('Falling back to regular Canvas 2D rendering');
      
      // Fallback to Canvas 2D API
      usePixi = false;
      
      // Check if we already have a valid 2D context
      if (!canvasContext) {
        console.log('Attempting to get 2D context again');
        try {
          canvasContext = canvasElement.getContext('2d');
          if (!canvasContext) {
            throw new Error('Could not get 2D context from canvas');
          }
          console.log('Canvas 2D context initialized on second attempt');
        } catch (secondAttemptError) {
          console.error('Failed to get 2D context on second attempt:', secondAttemptError);
          throw new Error('Could not initialize any rendering method');
        }
      }
    }
    
    // If using Canvas 2D, set up the render loop immediately
    if (!usePixi && canvasContext) {
      console.log('Setting up Canvas 2D render loop');
      initializeCanvas2DRenderingLoop();
    }
    
    console.log(`${usePixi ? 'Pixi.js' : 'Canvas 2D'} initialized successfully`);
    return true;
  } catch (error) {
    console.error('Error initializing rendering:', error);
    return false;
  }
}

// Initialize canvas 2D rendering loop (fallback when PIXI fails)
function initializeCanvas2DRenderingLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    console.log('Cancelled previous animation frame');
  }
  
  // Source cropping region (default to full frame)
  const cropRegion = {
    enabled: false,
    x: 0,
    y: 0,
    width: 0, // Will be set to video width
    height: 0 // Will be set to video height
  };
  
  // Add crop region controls to the canvas container
  addCropControls(cropRegion);
  
  // Simple render loop to draw video to canvas
  function render() {
    if (sourceVideo && canvasContext) {
      try {
        // Log dimensions and scaling occasionally to help debug issues
        const shouldLogDebug = Math.random() < 0.005; // Less frequent to reduce console spam
        
        // Only log occasionally to avoid flooding the console
        if (Math.random() < 0.01) {
          console.log("Rendering frame to canvas:", sourceVideo.videoWidth, "x", sourceVideo.videoHeight);
        }
        
        // Clear the canvas first
        canvasContext.fillStyle = '#000000';
        canvasContext.fillRect(0, 0, canvasContext.canvas.width, canvasContext.canvas.height);
        
        // Check if video has dimensions and is not paused
        if (sourceVideo.videoWidth > 0 && sourceVideo.videoHeight > 0 && !sourceVideo.paused) {
          // Use the full canvas dimensions
          const canvasWidth = canvasContext.canvas.width;
          const canvasHeight = canvasContext.canvas.height;
          
          if (shouldLogDebug) {
            debugLog(`Canvas: ${canvasWidth}x${canvasHeight}, Video: ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`);
          }
          
          // Save canvas state
          canvasContext.save();
          
          // Calculate scale to fill the canvas while maintaining aspect ratio
          const videoRatio = sourceVideo.videoWidth / sourceVideo.videoHeight;
          const canvasRatio = canvasWidth / canvasHeight;
          
          let scale, offsetX = 0, offsetY = 0;
          
          if (videoRatio > canvasRatio) {
            // Video is wider than canvas (relative to height)
            scale = canvasHeight / sourceVideo.videoHeight;
            offsetX = (canvasWidth - sourceVideo.videoWidth * scale) / 2;
            if (shouldLogDebug) debugLog(`Scaling based on height: ${scale}`);
          } else {
            // Video is taller than canvas (relative to width)
            scale = canvasWidth / sourceVideo.videoWidth;
            offsetY = (canvasHeight - sourceVideo.videoHeight * scale) / 2;
            if (shouldLogDebug) debugLog(`Scaling based on width: ${scale}`);
          }
          
          // Apply base transformations to center and scale the video
          canvasContext.translate(canvasWidth / 2, canvasHeight / 2);
          
          // Apply zoom if needed (multiply by the base scale)
          const finalScale = scale * zoomLevel;
          canvasContext.scale(finalScale, finalScale);
          
          if (shouldLogDebug) debugLog(`Final scale with zoom: ${finalScale}`);
          
          // Calculate proper offsets based on zoom center
          const zoomCenterOffsetX = (zoomCenterX - sourceVideo.videoWidth / 2) * (zoomLevel > 1 ? 1 : 0);
          const zoomCenterOffsetY = (zoomCenterY - sourceVideo.videoHeight / 2) * (zoomLevel > 1 ? 1 : 0);
          
          if (shouldLogDebug && zoomLevel > 1) {
            debugLog(`Zoom center offset: (${zoomCenterOffsetX}, ${zoomCenterOffsetY})`);
          }
          
          // Update crop region dimensions if they're not set
          if (cropRegion.width === 0 || cropRegion.height === 0) {
            cropRegion.width = sourceVideo.videoWidth;
            cropRegion.height = sourceVideo.videoHeight;
          }
          
          // Draw video frame to canvas - use video's natural dimensions or crop region
          if (cropRegion.enabled) {
            canvasContext.drawImage(
              sourceVideo, 
              cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height,
              -sourceVideo.videoWidth / 2 - zoomCenterOffsetX, 
              -sourceVideo.videoHeight / 2 - zoomCenterOffsetY,
              sourceVideo.videoWidth, sourceVideo.videoHeight
            );
          } else {
            canvasContext.drawImage(
              sourceVideo, 
              0, 0, sourceVideo.videoWidth, sourceVideo.videoHeight,
              -sourceVideo.videoWidth / 2 - zoomCenterOffsetX, 
              -sourceVideo.videoHeight / 2 - zoomCenterOffsetY,
              sourceVideo.videoWidth, sourceVideo.videoHeight
            );
          }
          
          // Restore canvas state
          canvasContext.restore();
          
          // Debug drawing to show canvas boundaries (uncomment if needed)
          // canvasContext.strokeStyle = 'red';
          // canvasContext.lineWidth = 4;
          // canvasContext.strokeRect(0, 0, canvasWidth, canvasHeight);
        }
      } catch (err) {
        console.error("Error rendering video to canvas:", err);
      }
    }
    
    // Continue the loop
    animationFrameId = requestAnimationFrame(render);
  }
  
  // Start the render loop
  animationFrameId = requestAnimationFrame(render);
  console.log('Canvas 2D rendering loop started');
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
            .then(success => resolve(success))
            .catch(err => {
              console.error('Error setting up PIXI rendering:', err);
              // Fallback to Canvas 2D
              usePixi = false;
              console.log('Falling back to Canvas 2D rendering');
              setupCanvas2DRendering()
                .then(success => resolve(success))
                .catch(canvas2dErr => {
                  console.error('Error setting up Canvas 2D rendering:', canvas2dErr);
                  resolve(false);
                });
            });
        } else {
          // Use Canvas 2D rendering
          setupCanvas2DRendering()
            .then(success => resolve(success))
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

// Function to setup PIXI.js rendering
async function setupPixiRendering() {
  try {
    console.log('Setting up PIXI rendering');
    
    // Make sure we have a valid app instance
    if (!app) {
      throw new Error('Pixi application not initialized');
    }
    
    // Clear the stage if we had a previous sprite
    if (videoSprite) {
      console.log('Removing previous video sprite');
      app.stage.removeChild(videoSprite);
      videoSprite.destroy();
    }
    
    // Create a texture from the video element
    console.log('Creating video texture');
    const videoTexture = PIXI.Texture.from(sourceVideo);
    
    // Explicitly set update properties on the texture
    videoTexture.baseTexture.autoUpdate = true;
    if (videoTexture.baseTexture.resource) {
      videoTexture.baseTexture.resource.autoPlay = true;
    }
    
    console.log('Creating sprite from texture');
    // Create a sprite from the texture
    videoSprite = new PIXI.Sprite(videoTexture);
    
    // Get canvas dimensions - compatible with all PIXI versions
    const canvasWidth = app.view.width || app.renderer.width || 3840;
    const canvasHeight = app.view.height || app.renderer.height || 2160;
    
    // Calculate proper scaling to maintain aspect ratio and fill canvas
    // Will be properly set in the ticker callback once video dimensions are available
    
    // Set anchor to center for easier positioning and scaling
    videoSprite.anchor.set(0.5, 0.5);
    
    // Position at center of canvas
    videoSprite.position.set(canvasWidth / 2, canvasHeight / 2);
    
    // Add the sprite to the stage
    app.stage.addChild(videoSprite);
    
    // Set up a ticker to ensure the texture updates
    // This helps with video rendering performance
    try {
      console.log('Setting up ticker for texture updates');
      const tickerCallback = () => {
        // Just having the ticker active helps with updates
        if (videoSprite && videoSprite.texture && sourceVideo.videoWidth > 0) {
          // Force texture update if needed
          if (videoSprite.texture.baseTexture) {
            videoSprite.texture.baseTexture.update();
          }
          
          // Calculate scale to fill the canvas while maintaining aspect ratio
          const videoRatio = sourceVideo.videoWidth / sourceVideo.videoHeight;
          const canvasRatio = canvasWidth / canvasHeight;
          
          let scale;
          if (videoRatio > canvasRatio) {
            // Video is wider than canvas (relative to height)
            scale = canvasHeight / sourceVideo.videoHeight;
          } else {
            // Video is taller than canvas (relative to width)
            scale = canvasWidth / sourceVideo.videoWidth;
          }
          
          // Apply the calculated scale, multiplied by zoom level
          videoSprite.scale.set(scale * zoomLevel);
          
          // Apply zoom center offset if zoomed in
          if (zoomLevel > 1) {
            // Calculate normalized zoom center (0-1 range)
            const normalizedZoomX = (zoomCenterX / sourceVideo.videoWidth) - 0.5;
            const normalizedZoomY = (zoomCenterY / sourceVideo.videoHeight) - 0.5;
            
            // Apply offset based on normalized positions multiplied by zoom factor
            videoSprite.position.x = canvasWidth / 2 - (normalizedZoomX * sourceVideo.videoWidth * scale * (zoomLevel - 1));
            videoSprite.position.y = canvasHeight / 2 - (normalizedZoomY * sourceVideo.videoHeight * scale * (zoomLevel - 1));
          } else {
            // Reset to center when not zoomed
            videoSprite.position.set(canvasWidth / 2, canvasHeight / 2);
          }
        }
      };
      
      // Add the ticker callback using a method that works with different Pixi versions
      if (app.ticker && app.ticker.add) {
        app.ticker.add(tickerCallback);
        console.log('Added ticker callback to app.ticker');
      } else if (PIXI.Ticker && PIXI.Ticker.shared) {
        PIXI.Ticker.shared.add(tickerCallback);
        console.log('Added ticker callback to PIXI.Ticker.shared');
      } else {
        // Fallback to requestAnimationFrame if ticker is not available
        console.log('Using requestAnimationFrame fallback for updates');
        const animate = () => {
          tickerCallback();
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    } catch (tickerError) {
      console.warn('Non-critical error setting up ticker:', tickerError);
      // Continue anyway as this is not critical
    }
    
    // Get the canvas stream for recording
    console.log('Getting stream from canvas');
    const canvasElement = document.getElementById('main-canvas');
    canvasStream = canvasElement.captureStream(60);
    
    console.log('PIXI.js rendering setup complete');
    return true;
  } catch (error) {
    console.error('Error setting up PIXI rendering:', error);
    throw error;
  }
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
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm;codecs=h264',
      'video/mp4;codecs=h264',
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=hvc1'
    ];
    
    types.forEach(type => {
      console.log(`${type}: ${MediaRecorder.isTypeSupported(type)}`);
    });
    
    // Check for best supported codec in order of preference
    // For better compatibility, prioritize WebM formats first
    let mimeType = '';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      mimeType = 'video/webm;codecs=vp9'; // VP9 (good quality/compression)
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      mimeType = 'video/webm;codecs=vp8'; // VP8 (widely supported)
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
      mimeType = 'video/webm;codecs=h264'; // WebM with H.264
    } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
      mimeType = 'video/mp4;codecs=h264'; // H.264 (good compatibility)
    } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=hvc1')) {
      mimeType = 'video/mp4;codecs=hvc1'; // HEVC (best quality/compression)
    } else {
      // Use default
      mimeType = ''; 
    }
    
    console.log(`Using MIME type: ${mimeType || 'default'}`);
    
    // Create media recorder options with high bitrate for 4K/60FPS
    const options = {
      videoBitsPerSecond: 20000000 // 20 Mbps for balance of quality and file size
    };
    
    // Add mime type if we have a supported one
    if (mimeType) {
      options.mimeType = mimeType;
    }
    
    // Create media recorder
    mediaRecorder = new MediaRecorder(canvasStream, options);
    
    // Clear recorded chunks array
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
    console.error('Error setting up media recorder:', error);
    return false;
  }
}

// Function to start recording
function startCanvasRecording() {
  try {
    if (!mediaRecorder) {
      throw new Error('MediaRecorder not initialized');
    }
    
    console.log('Starting canvas recording');
    
    // Start recording with segments
    // For 4K video, use larger segments (20 seconds) to reduce overhead
    // but small enough for reasonable concatenation times
    mediaRecorder.start(20000); // 20 second segments
    
    // Notify main process that recording has started
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
    
    return true;
  } catch (error) {
    console.error('Error stopping canvas recording:', error);
    return false;
  }
}

// Function to pause recording
function pauseCanvasRecording() {
  try {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      console.warn('MediaRecorder not recording, cannot pause');
      return false;
    }
    
    console.log('Pausing canvas recording');
    mediaRecorder.pause();
    
    return true;
  } catch (error) {
    console.error('Error pausing canvas recording:', error);
    return false;
  }
}

// Function to resume recording
function resumeCanvasRecording() {
  try {
    if (!mediaRecorder || mediaRecorder.state !== 'paused') {
      console.warn('MediaRecorder not paused, cannot resume');
      return false;
    }
    
    console.log('Resuming canvas recording');
    mediaRecorder.resume();
    
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
  const isRecording = state.isRecording;
  const isPaused = state.isPaused;
  
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
  
  // Setup pause recording button
  pauseRecordingBtn.addEventListener('click', () => {
    console.log('Pause Recording button clicked');
    
    // Pause canvas recording
    if (pauseCanvasRecording()) {
      window.electronAPI.pauseRecording();
    }
  });
  
  // Setup resume recording button
  resumeRecordingBtn.addEventListener('click', () => {
    console.log('Resume Recording button clicked');
    
    // Resume canvas recording
    if (resumeCanvasRecording()) {
      window.electronAPI.resumeRecording();
    }
  });
  
  // Setup stop recording button
  stopRecordingBtn.addEventListener('click', () => {
    console.log('Stop Recording button clicked');
    recordingMessageEl.textContent = 'Stopping recording...';
    recordingMessageEl.className = 'pending';
    
    // Stop canvas recording
    if (stopCanvasRecording()) {
      console.log('Canvas recording stopped successfully');
    } else {
      recordingMessageEl.textContent = 'Error stopping recording';
      recordingMessageEl.className = 'error';
    }
  });
  
  // Listen for hotkey-triggered start recording
  window.electronAPI.on('hotkey-start-recording', () => {
    console.log('Hotkey triggered start recording');
    if (!startRecordingBtn.disabled) {
      startRecordingBtn.click();
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

  // Initialize zoom control event handlers
  initializeZoomControls();
});

// Function to initialize zoom control buttons
function initializeZoomControls() {
  // Get zoom control buttons
  const zoomInButton = document.getElementById('zoomIn');
  const zoomOutButton = document.getElementById('zoomOut');
  const moveTopLeftButton = document.getElementById('moveTopLeft');
  const moveCenterButton = document.getElementById('moveCenter');
  
  // Add click event listeners
  if (zoomInButton) {
    zoomInButton.addEventListener('click', () => {
      zoomLevel = 2.0; // Set zoom to 2x
      console.log('Zoom in to 2x');
    });
  }
  
  if (zoomOutButton) {
    zoomOutButton.addEventListener('click', () => {
      zoomLevel = 1.0; // Reset zoom to 1x
      console.log('Reset zoom to 1x');
    });
  }
  
  if (moveTopLeftButton) {
    moveTopLeftButton.addEventListener('click', () => {
      // Move to top-left quarter (assuming 3840x2160 canvas)
      zoomCenterX = 960; // 1/4 of the width 
      zoomCenterY = 540; // 1/4 of the height
      console.log('Moved to top-left quarter');
    });
  }
  
  if (moveCenterButton) {
    moveCenterButton.addEventListener('click', () => {
      // Move back to center (assuming 3840x2160 canvas)
      zoomCenterX = 1920; // Half of the width
      zoomCenterY = 1080; // Half of the height
      console.log('Moved to center');
    });
  }
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