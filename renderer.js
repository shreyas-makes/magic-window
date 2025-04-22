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
let usePixi = true; // Whether to use PIXI.js or fallback to canvas API
let canvasContext = null; // Canvas 2D context (for fallback renderer)
let animationFrameId = null; // For cancelAnimationFrame in fallback renderer

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
    
    // Set canvas size to match desired dimensions (4K)
    canvasElement.width = 3840;
    canvasElement.height = 2160;
    
    try {
      // Create a new PIXI Application with compatibility options
      const options = {
        view: canvasElement,
        width: canvasElement.width,
        height: canvasElement.height,
        backgroundColor: 0x000000,
        resolution: 1,
        autoDensity: true,
        antialias: false // Better performance without antialiasing
      };
      
      // Create the application
      app = new PIXI.Application(options);
      
      // Log PIXI information
      logPixiInfo();
      
      // PIXI initialization was successful
      usePixi = true;
    } catch (pixiError) {
      console.error('Error initializing PIXI.js:', pixiError);
      console.log('Falling back to regular Canvas 2D rendering');
      
      // Fallback to Canvas 2D API
      usePixi = false;
      canvasContext = canvasElement.getContext('2d');
      if (!canvasContext) {
        throw new Error('Could not get 2D context from canvas');
      }
      
      console.log('Canvas 2D context initialized successfully');
    }
    
    // Get video element
    sourceVideo = document.getElementById('source-video');
    if (!sourceVideo) {
      throw new Error('Source video element not found');
    }
    
    // If using PIXI, configure the ticker
    if (usePixi) {
      try {
        // Try to set FPS (compatible with newer Pixi.js versions)
        if (app.ticker && typeof app.ticker.maxFPS !== 'undefined') {
          app.ticker.maxFPS = 60;
        } 
        // For older versions, adjust the update frequency
        else if (app.ticker && app.ticker.update) {
          // Use the default ticker settings
          app.ticker.autoStart = true;
          app.ticker.shared.autoStart = true;
        }
      } catch (tickerError) {
        console.warn('Non-critical error configuring ticker:', tickerError);
        // Continue anyway since this is not critical
      }
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
  }
  
  // Simple render loop to draw video to canvas
  function render() {
    if (sourceVideo && canvasContext) {
      // Draw video frame to canvas
      canvasContext.drawImage(
        sourceVideo, 
        0, 0, 
        canvasContext.canvas.width, 
        canvasContext.canvas.height
      );
    }
    
    // Continue the loop
    animationFrameId = requestAnimationFrame(render);
  }
  
  // Start the render loop
  animationFrameId = requestAnimationFrame(render);
  console.log('Canvas 2D rendering loop started');
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
      sourceItem.innerHTML = `
        <img src="${source.thumbnail}" alt="${source.name}">
        <p title="${source.name}">${source.name}</p>
      `;
      
      // Add click handler to select this source
      sourceItem.addEventListener('click', () => {
        selectedSourceId = source.id;
        
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
    
    // Get the stream using the older navigator.mediaDevices.getUserMedia API
    // which is better supported in Electron
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedId,
            minWidth: 1920,
            minHeight: 1080,
            maxWidth: 3840,
            maxHeight: 2160
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
    } catch (err) {
      console.error('Failed to get media stream:', err);
      throw err;
    }
  } catch (error) {
    console.error('Error getting source stream:', error);
    throw error;
  }
}

// Function to setup canvas rendering with the source stream
function setupCanvasRendering(stream) {
  try {
    console.log('Setting up canvas rendering with stream');
    
    // Set the video source to the stream
    sourceVideo.srcObject = stream;
    console.log('Set stream to video element');
    
    sourceVideo.onloadedmetadata = () => {
      console.log('Video metadata loaded, starting playback');
      sourceVideo.play()
        .then(() => console.log('Video playback started'))
        .catch(err => console.error('Error starting video playback:', err));
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
          resolve(false);
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
    
    // Set sprite properties to fill the canvas
    videoSprite.width = canvasWidth;
    videoSprite.height = canvasHeight;
    console.log(`Set video sprite dimensions: ${videoSprite.width}x${videoSprite.height}`);
    
    // Center the sprite
    videoSprite.position.set(0, 0);
    
    // Add the sprite to the stage
    app.stage.addChild(videoSprite);
    
    // Set up a ticker to ensure the texture updates
    // This helps with video rendering performance
    try {
      console.log('Setting up ticker for texture updates');
      const tickerCallback = () => {
        // Just having the ticker active helps with updates
        if (videoSprite && videoSprite.texture) {
          // Force texture update if needed
          if (videoSprite.texture.baseTexture) {
            videoSprite.texture.baseTexture.update();
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

// When the page has loaded
document.addEventListener('DOMContentLoaded', async () => {
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
});

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