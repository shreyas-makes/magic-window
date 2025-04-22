// This file runs in the renderer process
// Import path module from Node.js through the preload script
const path = { sep: '/' }; // Simple path separator for use in the renderer

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
  sourceSelect.addEventListener('change', (event) => {
    const selectedSourceId = event.target.value;
    if (selectedSourceId) {
      console.log('Source selected:', selectedSourceId);
      window.electronAPI.sourceSelected(selectedSourceId);
      statusEl.textContent = `Selected source: ${event.target.options[event.target.selectedIndex].text}`;
      
      // Enable start recording button when a source is selected
      startRecordingBtn.disabled = false;
    } else {
      // Disable start recording button when no source is selected
      startRecordingBtn.disabled = true;
    }
  });
  
  // Setup start recording button
  startRecordingBtn.addEventListener('click', () => {
    console.log('Start Recording button clicked');
    recordingMessageEl.textContent = 'Starting recording...';
    recordingMessageEl.className = 'pending';
    
    // Send start recording request to main process
    window.electronAPI.startRecording();
  });
  
  // Setup pause recording button
  pauseRecordingBtn.addEventListener('click', () => {
    console.log('Pause Recording button clicked');
    window.electronAPI.pauseRecording();
  });
  
  // Setup resume recording button
  resumeRecordingBtn.addEventListener('click', () => {
    console.log('Resume Recording button clicked');
    window.electronAPI.resumeRecording();
  });
  
  // Setup stop recording button
  stopRecordingBtn.addEventListener('click', () => {
    console.log('Stop Recording button clicked');
    recordingMessageEl.textContent = 'Stopping recording...';
    recordingMessageEl.className = 'pending';
    
    // Send stop recording request to main process
    window.electronAPI.stopRecording();
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
    
    // Make sure these elements are available in this scope
    const statusEl = document.getElementById('status');
    const recordingMessageEl = document.getElementById('recordingMessage');
    
    // Update status
    statusEl.textContent = 'Recording saved successfully';
    statusEl.className = 'status success';
    
    // Update recording message
    recordingMessageEl.innerHTML = `
      <div>Recording saved successfully!</div>
      <div class="file-path">Location: <span class="path">${filePath}</span></div>
      <button id="openVideoBtn" class="open-file-btn">Play Recording</button>
      <button id="openDirBtn" class="open-file-btn">Open Directory</button>
    `;
    recordingMessageEl.className = 'success';
    
    // Add click handler for buttons
    setTimeout(() => {
      const openVideoBtn = document.getElementById('openVideoBtn');
      const openDirBtn = document.getElementById('openDirBtn');
      
      if (openVideoBtn) {
        openVideoBtn.addEventListener('click', () => {
          console.log('Open video button clicked for:', filePath);
          window.electronAPI.openFile(filePath);
        });
      }
      
      if (openDirBtn) {
        openDirBtn.addEventListener('click', () => {
          // Get directory path from file path
          const dirPath = filePath.substring(0, filePath.lastIndexOf(path.sep));
          console.log('Open directory button clicked for:', dirPath);
          window.electronAPI.openFile(dirPath);
        });
      }
    }, 100); // Small timeout to ensure the DOM is updated
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