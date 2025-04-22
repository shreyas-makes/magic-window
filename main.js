const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Simple settings storage implementation
class Settings {
  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.data = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        this.data = JSON.parse(data);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  }

  get(key, defaultValue) {
    return key in this.data ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}

// Initialize settings
const store = new Settings();

// Recording state variables
let sourceId = null;
let isRecording = false;
let isPaused = false;
let recordingWindow = null;
let mainWindow = null; // Global reference to main window
let currentSavePath = null;
let tempSessionDir = null; // For storing temporary session directory
let segmentIndex = 0; // For tracking segment numbers

function createWindow() {
  // Get the primary display's work area dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Calculate window dimensions (80% of screen size)
  const windowWidth = Math.floor(width * 0.8);
  const windowHeight = Math.floor(height * 0.8);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Center the window on the screen
  mainWindow.center();

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();

  // Log when the window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window loaded and ready');
  });
}

// Helper function to send UI state updates to renderer
function sendStateUpdate() {
  console.log('Sending UI state update to renderer, isRecording:', isRecording, 'isPaused:', isPaused);
  // Use the global mainWindow reference
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('Using mainWindow reference to send state update');
    mainWindow.webContents.send('updateState', { isRecording, isPaused });
  } else {
    console.warn('mainWindow not available for state update');
  }
}

// Toggle recording function for hotkey
function toggleRecording() {
  if (!isRecording) {
    // If not recording, start
    if (sourceId) {
      mainWindow.webContents.send('hotkey-start-recording');
    } else {
      console.warn('No source selected for recording.');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', 'Please select a source first.');
      }
    }
  } else if (isPaused) {
    // If paused, resume
    resumeRecording();
  } else {
    // If recording, pause
    pauseRecording();
  }
}

// Pause recording
function pauseRecording() {
  if (isRecording && !isPaused && recordingWindow) {
    console.log('Pausing recording');
    isPaused = true;
    
    // Send pause command to recording window
    recordingWindow.webContents.send('pause-recording');
    
    sendStateUpdate();
  }
}

// Resume recording
function resumeRecording() {
  if (isRecording && isPaused && recordingWindow) {
    console.log('Resuming recording');
    isPaused = false;
    
    // Send resume command to recording window
    recordingWindow.webContents.send('resume-recording');
    
    sendStateUpdate();
  }
}

// Get or initialize save path
function initializeSavePath() {
  try {
    // Try to get saved path from store
    let savedPath = store.get('savePath');
    if (!savedPath) {
      // Default to Movies directory
      savedPath = app.getPath('videos');
      store.set('savePath', savedPath);
    }
    currentSavePath = savedPath;
    console.log('Save path initialized to:', currentSavePath);
    return currentSavePath;
  } catch (error) {
    console.error('Error initializing save path:', error);
    // Fallback to app data directory if there's an error
    const fallbackPath = app.getPath('userData');
    currentSavePath = fallbackPath;
    return fallbackPath;
  }
}

// Helper function to get formatted timestamp for file names (YYYY-MM-DD at HH.MM.SS)
function getFormattedTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} at ${hour}.${minute}.${second}`;
}

// Helper function to get current recording directory path
function getCurrentRecordingDir(basePath) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  return path.join(basePath, 'Magic Window', `${year}-${month}`);
}

// Create window when app is ready
app.whenReady().then(() => {
  createWindow();
  
  // Initialize save path
  initializeSavePath();
  
  // Register global shortcut
  globalShortcut.register('CommandOrControl+Shift+9', () => {
    console.log('Global hotkey triggered');
    toggleRecording();
  });

  // Handle IPC ping message from renderer
  ipcMain.on('ping', () => {
    console.log('ping received in main process');
    // Send pong back to renderer using mainWindow reference
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pong');
    } else {
      console.warn('mainWindow not available to respond to ping');
    }
  });
  
  // Handle request for screen and window sources
  ipcMain.handle('getSources', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      return sources;
    } catch (error) {
      console.error('Error getting sources:', error);
      throw error;
    }
  });
  
  // Handle source selection from renderer
  ipcMain.on('sourceSelected', (event, selectedSourceId) => {
    console.log('Source selected:', selectedSourceId);
    sourceId = selectedSourceId;
  });

  // Handle get settings request
  ipcMain.handle('getSettings', () => {
    console.log('getSettings handler called');
    return {
      savePath: currentSavePath || app.getPath('userData')
    };
  });
  
  // Handle show save dialog request
  ipcMain.handle('showSaveDialog', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: currentSavePath
      });
      
      if (!canceled && filePaths.length > 0) {
        currentSavePath = filePaths[0];
        store.set('savePath', currentSavePath);
        console.log('New save path set:', currentSavePath);
        return currentSavePath;
      }
      
      return null;
    } catch (error) {
      console.error('Error showing save dialog:', error);
      throw error;
    }
  });
  
  // Handle pause recording request
  ipcMain.on('pauseRecording', () => {
    pauseRecording();
  });
  
  // Handle resume recording request
  ipcMain.on('resumeRecording', () => {
    resumeRecording();
  });
  
  // Handle start recording request
  ipcMain.on('startRecording', async (event) => {
    if (isRecording) {
      console.warn('Already recording.');
      return;
    }
    
    if (!sourceId) {
      console.warn('No source selected for recording.');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', 'Please select a source first.');
      }
      return;
    }
    
    try {
      // Create a unique temporary directory for this recording session
      const tempBaseDir = path.join(os.tmpdir(), 'magic-window-recorder');
      fs.mkdirSync(tempBaseDir, { recursive: true });
      tempSessionDir = fs.mkdtempSync(path.join(tempBaseDir, 'recording-'));
      console.log(`Created temporary session directory: ${tempSessionDir}`);
      
      // Reset segment index
      segmentIndex = 0;
      
      // Create a new BrowserWindow to handle the recording
      recordingWindow = new BrowserWindow({
        width: 400,
        height: 300,
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      });
      
      // Load an HTML file for recording
      await recordingWindow.loadFile('recorder.html');
      
      // Pass the sourceId and tempSessionDir to the recording window
      recordingWindow.webContents.executeJavaScript(`
        window.sourceId = '${sourceId}';
        window.tempSessionDir = '${tempSessionDir.replace(/\\/g, '\\\\')}';
        document.dispatchEvent(new Event('sourceReady'));
      `);
      
      // Set recording state
      isRecording = true;
      isPaused = false;
      sendStateUpdate();
      
      console.log('Recording started, updated UI state');
      
      // Handle window close
      recordingWindow.on('closed', () => {
        recordingWindow = null;
        if (isRecording) {
          isRecording = false;
          isPaused = false;
          sendStateUpdate();
        }
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', error.toString());
      }
    }
  });
  
  // Handle segment data from the recording window
  ipcMain.on('segment-data', (event, { buffer, mimeType, segmentNumber }) => {
    try {
      // Ensure temp session directory exists
      if (!tempSessionDir) {
        throw new Error('No temporary session directory available');
      }
      
      // Determine file extension based on MIME type
      let fileExtension = '.mp4'; // Default
      if (mimeType && mimeType.includes('webm')) {
        fileExtension = '.webm';
      }
      
      // Create segment file name
      const segmentFileName = `segment_${segmentNumber}${fileExtension}`;
      const segmentPath = path.join(tempSessionDir, segmentFileName);
      
      // Write segment data to file
      fs.writeFileSync(segmentPath, Buffer.from(buffer));
      
      console.log(`Segment ${segmentNumber} saved to: ${segmentPath}`);
    } catch (error) {
      console.error('Error saving segment:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', error.toString());
      }
    }
  });
  
  // Handle listing segment files
  ipcMain.handle('listSegments', async (event, dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) {
        throw new Error('Directory does not exist');
      }
      
      // Get all files in the directory
      const files = fs.readdirSync(dirPath);
      
      // Filter for segment files and sort them
      const segmentFiles = files
        .filter(file => file.startsWith('segment_') && (file.endsWith('.mp4') || file.endsWith('.webm')))
        .sort((a, b) => {
          // Extract segment numbers for proper sorting
          const numA = parseInt(a.replace('segment_', '').split('.')[0]);
          const numB = parseInt(b.replace('segment_', '').split('.')[0]);
          return numA - numB;
        })
        .map(file => {
          const fullPath = path.join(dirPath, file);
          const stats = fs.statSync(fullPath);
          return {
            name: file,
            path: fullPath,
            size: stats.size,
            // Format size in KB or MB
            formattedSize: stats.size > 1024 * 1024 
              ? `${(stats.size / (1024 * 1024)).toFixed(2)} MB` 
              : `${(stats.size / 1024).toFixed(2)} KB`
          };
        });
      
      return segmentFiles;
    } catch (error) {
      console.error('Error listing segments:', error);
      throw error;
    }
  });
  
  // Handle recording complete notification
  ipcMain.on('recording-complete', () => {
    console.log('Recording completed, ready for concatenation');
    console.log(`All segments stored in: ${tempSessionDir}`);
    console.log(`Final path will be in: ${getCurrentRecordingDir(currentSavePath)}`);
    
    // Placeholder for future concatenation logic
    
    isRecording = false;
    isPaused = false;
    if (recordingWindow) {
      recordingWindow.close();
      recordingWindow = null;
    }
    sendStateUpdate();
    
    // Send just the path to the temporary directory, not a string with text and path
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recordingSaved', tempSessionDir);
    }
  });
  
  // Handle stop recording request
  ipcMain.on('stopRecording', (event) => {
    console.log('STOP RECORDING request received in main process');
    
    if (!isRecording) {
      console.warn('Not recording.');
      return;
    }
    
    try {
      // Set state first to ensure UI updates
      isRecording = false;
      isPaused = false;
      sendStateUpdate();
      
      if (recordingWindow) {
        console.log('Sending stop signal to recording window');
        try {
          recordingWindow.webContents.send('stop-recording');
        } catch (err) {
          console.error('Failed to send stop signal:', err);
        }
      } else {
        console.error('Recording window not found');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recordingError', 'Recording window not found');
        }
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', error.toString());
      }
    }
  });
  
  // Handle MIME type notification
  ipcMain.on('recording-mime-type', (event, { mimeType }) => {
    console.log('Recording using MIME type:', mimeType);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recordingMimeType', { mimeType });
    }
  });

  // Add handler for opening files
  ipcMain.on('open-file', (event, filePath) => {
    console.log('Opening file:', filePath);
    shell.openPath(filePath).then(result => {
      if (result) {
        console.error('Error opening file:', result);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recordingError', `Error opening file: ${result}`);
        }
      }
    });
  });

  app.on('activate', function () {
    // On macOS re-create a window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Unregister all shortcuts when app is about to quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
}); 