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

// Initialize Pixi.js
function initializePixi() {
  try {
    // Get canvas element
    const canvasElement = document.getElementById('main-canvas');
    if (!canvasElement) {
      throw new Error('Canvas element not found');
    }
    
    // Create a new PIXI Application
    app = new PIXI.Application({
      view: canvasElement,
      width: 3840,
      height: 2160,
      backgroundColor: 0x000000,
      resolution: 1,
      autoDensity: true
    });
    
    // Get video element
    sourceVideo = document.getElementById('source-video');
    if (!sourceVideo) {
      throw new Error('Source video element not found');
    }
    
    console.log('Pixi.js initialized successfully');
    
    return true;
  } catch (error) {
    console.error('Error initializing Pixi.js:', error);
    return false;
  }
}

// Function to get media stream from a source
async function getSourceStream(sourceId) {
  try {
    console.log('Getting stream for source ID:', sourceId);
    
    // Use desktopCapturer directly in the renderer
    const sources = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 60 }
      }
    });
    
    console.log('Successfully got media stream');
    return sources;
  } catch (error) {
    console.error('Error getting source stream:', error);
    throw error;
  }
}

// Function to setup canvas rendering with the source stream
function setupCanvasRendering(stream) {
  try {
    // Set the video source to the stream
    sourceVideo.srcObject = stream;
    sourceVideo.play();
    
    // Make sure we have a valid app instance
    if (!app) {
      throw new Error('Pixi application not initialized');
    }
    
    // Clear the stage if we had a previous sprite
    if (videoSprite) {
      app.stage.removeChild(videoSprite);
    }
    
    // Create a texture from the video element
    const videoTexture = PIXI.Texture.from(sourceVideo);
    videoTexture.baseTexture.autoUpdate = true;
    
    // Create a sprite from the texture
    videoSprite = new PIXI.Sprite(videoTexture);
    
    // Set sprite properties to cover the entire canvas
    videoSprite.width = app.renderer.width;
    videoSprite.height = app.renderer.height;
    
    // Add the sprite to the stage
    app.stage.addChild(videoSprite);
    
    // Get the canvas stream for recording
    const canvasElement = document.getElementById('main-canvas');
    canvasStream = canvasElement.captureStream(60);
    
    console.log('Canvas rendering setup complete');
    
    return true;
  } catch (error) {
    console.error('Error setting up canvas rendering:', error);
    return false;
  }
}

// Function to setup media recorder with canvas stream
function setupMediaRecorder() {
  try {
    if (!canvasStream) {
      throw new Error('Canvas stream not available');
    }
    
    // Check if HEVC is supported
    const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs=hvc1') 
      ? 'video/mp4; codecs=hvc1' 
      : 'video/webm; codecs=h264';
    
    console.log(`Using MIME type: ${mimeType}`);
    
    // Create media recorder options with high bitrate for 4K/60FPS
    const options = {
      mimeType: mimeType,
      videoBitsPerSecond: 30000000 // 30 Mbps
    };
    
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
            mimeType: mimeType,
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
        const lastBlob = new Blob(recordedChunks, { type: mimeType });
        
        // Convert blob to ArrayBuffer for IPC
        lastBlob.arrayBuffer().then(buffer => {
          // Send the final chunk to the main process
          window.electronAPI.sendBlobChunk({
            buffer: buffer,
            mimeType: mimeType,
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
    
    // Start recording with 10-second segments
    mediaRecorder.start(10000); // 10 seconds per segment
    
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
      // Get stream for the selected source on recording start
      const stream = await getSourceStream();
      
      // Setup canvas rendering with the stream
      if (!setupCanvasRendering(stream)) {
        throw new Error('Failed to setup canvas rendering');
      }
      
      // Setup media recorder
      if (!setupMediaRecorder()) {
        throw new Error('Failed to setup media recorder');
      }
      
      // Start canvas recording
      if (startCanvasRecording()) {
        console.log('Canvas recording started successfully');
      } else {
        throw new Error('Failed to start canvas recording');
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