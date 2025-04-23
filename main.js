const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static').path;
const checkDiskSpace = require('check-disk-space').default;

// Enable Electron sandbox for security
app.enableSandbox();

// Set up error logging
function logError(source, error) {
  console.error(`[ERROR] ${source}:`, error);
  // Could add electron-log here for file logging
}

// Set ffmpeg and ffprobe paths to the static binaries
try {
  ffmpeg.setFfmpegPath(ffmpegStatic);
  console.log('FFmpeg path set to:', ffmpegStatic);
} catch (err) {
  logError('FFmpeg Setup', err);
}

try {
  // Try to set ffprobe path
  if (fs.existsSync(ffprobeStatic)) {
    ffmpeg.setFfprobePath(ffprobeStatic);
    console.log('FFprobe path set to:', ffprobeStatic);
  } else {
    console.warn('FFprobe not found at expected path:', ffprobeStatic);
    console.warn('Will attempt concatenation without ffprobe');
  }
} catch (err) {
  logError('FFprobe Setup', err);
}

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
      logError('Settings Load', err);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      logError('Settings Save', err);
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
let floatingPanelWindow = null; // Global reference to floating panel window
let currentSavePath = null;
let tempSessionDir = null; // For storing temporary session directory
let segmentIndex = 0; // For tracking segment numbers
let diskSpaceInterval = null; // For disk space checking interval
let recordingTimer = null; // For tracking recording duration
let recordingSeconds = 0; // For counting recording seconds
const MAX_RECORDING_SECONDS = 7200; // 2 hours (7200 seconds)

// Disk space thresholds
const DISK_SPACE_LOW_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB
const DISK_SPACE_CRITICAL_THRESHOLD = 100 * 1024 * 1024; // 100MB

const createWindow = () => {
  try {
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
        nodeIntegration: false,
        enableRemoteModule: false,
        webSecurity: true,
        sandbox: true // Enable sandbox for renderer process
      }
    });

    // Set permissions for media devices and screen capture
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media' || 
          permission === 'display-capture' || 
          permission === 'mediaKeySystem' ||
          permission === 'geolocation' || 
          permission === 'notifications') {
        callback(true);
      } else {
        console.log(`Denied permission request: ${permission}`);
        callback(false);
      }
    });

    // Set permissions for media access
    mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
      return permission === 'media' || 
             permission === 'display-capture' || 
             permission === 'mediaKeySystem';
    });

    // Center the window on the screen
    mainWindow.center();

    // Load the index.html file
    mainWindow.loadFile('index.html').catch(err => {
      logError('Window Load', err);
      dialog.showErrorBox('Application Error', 'Failed to load application interface.');
    });

    // Open DevTools for debugging
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }

    // Handle window errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      logError('Window Load Failed', `${errorCode}: ${errorDescription}`);
      dialog.showErrorBox('Load Error', `Failed to load the application: ${errorDescription}`);
    });

    // Log when the window is ready
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('Window loaded and ready');
      
      // Check for recoverable recordings after window is loaded
      checkForPreviousRecordings();
    });
    
    // Handle crashed renders
    mainWindow.webContents.on('crashed', (event, killed) => {
      logError('Renderer Crash', `Renderer process ${killed ? 'was killed' : 'crashed'}`);
      dialog.showErrorBox(
        'Application Crashed', 
        'The application window crashed. Any in-progress recording may be recoverable on next startup.'
      );
    });
    
    // Handle unresponsive window
    mainWindow.on('unresponsive', () => {
      logError('Renderer Unresponsive', 'Application window is not responding');
      dialog.showMessageBox({
        type: 'warning',
        title: 'Application Not Responding',
        message: 'The application is not responding. Wait for it to recover or restart the application.',
        buttons: ['Wait', 'Force Quit'],
        defaultId: 0
      }).then(result => {
        if (result.response === 1) {
          app.exit(1);
        }
      }).catch(err => {
        logError('Unresponsive Dialog', err);
      });
    });
    
    // Handle window closed
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (error) {
    logError('Create Window', error);
    dialog.showErrorBox('Application Error', 'Failed to create application window.');
    app.quit();
  }
};

// Helper function to send UI state updates to renderer
function sendStateUpdate() {
  console.log('Sending UI state update to renderer, isRecording:', isRecording, 'isPaused:', isPaused);
  try {
    // Use the global mainWindow reference
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('Using mainWindow reference to send state update');
      mainWindow.webContents.send('updateState', { isRecording, isPaused });
    } else {
      console.warn('mainWindow not available for state update');
    }
  } catch (error) {
    logError('Send State Update', error);
  }
}

// Toggle recording function for hotkey
function toggleRecording() {
  try {
    if (!isRecording) {
      // If not recording, start
      // Check if we have a canvas renderer setup (not using recorder window anymore)
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Start canvas recording through the main window's renderer
        mainWindow.webContents.send('hotkey-start-recording');
      } else {
        console.warn('No main window available for recording.');
      }
    } else if (isPaused) {
      // If paused, resume
      resumeRecording();
    } else {
      // If recording, pause
      pauseRecording();
    }
  } catch (error) {
    logError('Toggle Recording', error);
  }
}

// Pause recording
function pauseRecording() {
  try {
    if (isRecording && !isPaused && recordingWindow) {
      console.log('Pausing recording');
      isPaused = true;
      
      // Send pause command to recording window
      recordingWindow.webContents.send('pause-recording');
      
      sendStateUpdate();
    }
  } catch (error) {
    logError('Pause Recording', error);
  }
}

// Resume recording
function resumeRecording() {
  try {
    if (isRecording && isPaused && recordingWindow) {
      console.log('Resuming recording');
      isPaused = false;
      
      // Send resume command to recording window
      recordingWindow.webContents.send('resume-recording');
      
      sendStateUpdate();
    }
  } catch (error) {
    logError('Resume Recording', error);
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

// Function to check disk space
async function checkDiskSpaceAvailable() {
  if (!currentSavePath) return;
  
  try {
    const diskSpace = await checkDiskSpace(currentSavePath);
    
    if (diskSpace.free < DISK_SPACE_CRITICAL_THRESHOLD) {
      // Critical disk space - stop recording and send warning
      console.warn('Critical disk space: stopping recording');
      if (isRecording) {
        ipcMain.emit('stopRecording');
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('diskSpaceWarning', { status: 'critical', free: diskSpace.free });
      }
    } else if (diskSpace.free < DISK_SPACE_LOW_THRESHOLD) {
      // Low disk space - send warning
      console.warn('Low disk space warning');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('diskSpaceWarning', { status: 'low', free: diskSpace.free });
      }
    } else {
      // Disk space OK
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('diskSpaceWarning', { status: 'ok', free: diskSpace.free });
      }
    }
  } catch (error) {
    console.error('Error checking disk space:', error);
  }
}

// Function to start disk space monitoring
function startDiskSpaceMonitoring() {
  if (diskSpaceInterval) {
    clearInterval(diskSpaceInterval);
  }
  
  // Check immediately
  checkDiskSpaceAvailable();
  
  // Then check every 30 seconds
  diskSpaceInterval = setInterval(checkDiskSpaceAvailable, 30000);
}

// Function to stop disk space monitoring
function stopDiskSpaceMonitoring() {
  if (diskSpaceInterval) {
    clearInterval(diskSpaceInterval);
    diskSpaceInterval = null;
  }
}

// Function to ensure directory exists
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Function to concatenate video segments
async function concatenateSegments(tempDir, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`Concatenating segments from ${tempDir} to ${outputPath}`);
      
      // Get segments
      const segments = await listSegments(tempDir);
      if (!segments || segments.length === 0) {
        const errorMsg = `No segments found in ${tempDir}`;
        console.error(errorMsg);
        return reject(new Error(errorMsg));
      }
      
      console.log(`Found ${segments.length} segments to concatenate`);
      
      // Create temporary file listing segments for ffmpeg
      const listFilePath = path.join(tempDir, 'segments.txt');
      let listContent = '';
      
      for (const segment of segments) {
        // Escape single quotes in paths for ffmpeg
        const escapedPath = segment.replace(/'/g, '\\\'');
        listContent += `file '${escapedPath}'\n`;
      }
      
      try {
        fs.writeFileSync(listFilePath, listContent);
        console.log('Created segment list file at:', listFilePath);
      } catch (err) {
        logError('Write Segment List', err);
        return reject(new Error(`Failed to create segment list: ${err.message}`));
      }
      
      // Check if output directory exists
      const outputDir = path.dirname(outputPath);
      ensureDirExists(outputDir);
      
      // If output file already exists, remove it
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          logError('Remove Existing Output', err);
          // Continue anyway
        }
      }
      
      // Use ffmpeg concat demuxer
      let command = ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy']) // Copy streams without re-encoding
        .output(outputPath);
      
      // Log progress
      command.on('progress', (progress) => {
        if (progress && progress.percent) {
          console.log(`Concatenation progress: ${Math.round(progress.percent)}%`);
          
          // Send progress to renderer
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('concatenationStatus', {
              status: 'progress',
              percent: Math.round(progress.percent),
              message: `Joining segments: ${Math.round(progress.percent)}%`
            });
          }
        }
      });
      
      // Handle completion
      command.on('end', () => {
        console.log('Concatenation completed successfully');
        
        // Check if file exists and has content
        try {
          const stats = fs.statSync(outputPath);
          if (stats.size === 0) {
            const errorMsg = 'Concatenation produced an empty file';
            console.error(errorMsg);
            
            // Send error to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', {
                status: 'error',
                message: errorMsg
              });
            }
            
            return reject(new Error(errorMsg));
          }
          
          console.log(`Output file size: ${stats.size} bytes`);
          resolve(outputPath);
        } catch (err) {
          logError('Check Output File', err);
          reject(err);
        }
      });
      
      // Handle errors
      command.on('error', (err) => {
        const errorMsg = `Concatenation error: ${err.message}`;
        logError('FFmpeg Concatenation', err);
        
        // Send error to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('concatenationStatus', {
            status: 'error',
            message: errorMsg
          });
        }
        
        reject(new Error(errorMsg));
      });
      
      // Start the process
      command.run();
      console.log('Started FFmpeg concatenation process');
      
    } catch (err) {
      logError('Concatenate Segments', err);
      reject(err);
    }
  });
}

// Function to list segments in a directory
async function listSegments(dirPath) {
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
}

// Function to start the recording timer
function startRecordingTimer() {
  // Reset the timer if it exists
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingSeconds = 0;
  }
  
  recordingSeconds = 0;
  
  // Start a timer that counts seconds
  recordingTimer = setInterval(() => {
    if (!isPaused) {
      recordingSeconds++;
      
      // If we've reached the 2-hour limit, stop recording
      if (recordingSeconds >= MAX_RECORDING_SECONDS) {
        console.log('Recording reached 2-hour limit. Stopping automatically.');
        
        // Send notification to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recordingLimitReached');
        }
        
        // Stop the recording
        ipcMain.emit('stopRecording');
      }
    }
  }, 1000);
}

// Function to stop the recording timer
function stopRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
    recordingSeconds = 0;
  }
}

// Function for setting up system permissions needed for screen capture
function setupSystemCapabilities() {
  if (process.platform === 'darwin') {
    // On macOS, request screen recording permission
    try {
      // This will trigger the system permission dialog if needed
      desktopCapturer.getSources({ types: ['screen'] })
        .then(sources => {
          console.log(`Found ${sources.length} screen sources during initial permission check`);
        })
        .catch(err => {
          console.error('Error during initial screen capture permission check:', err);
        });
    } catch (error) {
      console.error('Error setting up screen recording permissions:', error);
    }
  }
}

// Register global shortcuts
function registerGlobalShortcuts() {
  try {
    // Register Cmd+Shift+9 for recording cycle (Start->Pause->Resume)
    globalShortcut.register('CommandOrControl+Shift+9', () => {
      console.log('Cmd+Shift+9 pressed (toggle recording cycle)');
      toggleRecording();
    });
    
    // Register Cmd+1/Ctrl+1 for 1.0x zoom
    globalShortcut.register('CommandOrControl+1', () => {
      console.log('Cmd+1 pressed (1.0x zoom)');
      if (mainWindow) mainWindow.webContents.send('zoom-preset', { preset: 1.0 });
    });
    
    // Register Cmd+2/Ctrl+2 for 1.5x zoom
    globalShortcut.register('CommandOrControl+2', () => {
      console.log('Cmd+2 pressed (1.5x zoom)');
      if (mainWindow) mainWindow.webContents.send('zoom-preset', { preset: 1.5 });
    });
    
    // Register Cmd+3/Ctrl+3 for 2.0x zoom
    globalShortcut.register('CommandOrControl+3', () => {
      console.log('Cmd+3 pressed (2.0x zoom)');
      if (mainWindow) mainWindow.webContents.send('zoom-preset', { preset: 2.0 });
    });
    
    // Register Cmd+4/Ctrl+4 for 4.0x zoom
    globalShortcut.register('CommandOrControl+4', () => {
      console.log('Cmd+4 pressed (4.0x zoom)');
      if (mainWindow) mainWindow.webContents.send('zoom-preset', { preset: 4.0 });
    });
    
    // Add shortcut to toggle PiP
    const togglePipResult = globalShortcut.register('CommandOrControl+0', () => {
      console.log('Global shortcut: Cmd+0 pressed - toggling PiP');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toggle-pip');
      }
    });
    
    if (togglePipResult) {
      console.log('Registered Cmd+0 shortcut for toggling PiP');
    } else {
      console.error('Failed to register Cmd+0 shortcut');
    }
    
    console.log('Global shortcuts registered');
  } catch (err) {
    console.error('Failed to register global shortcuts:', err);
  }
}

// Function to unregister global shortcuts
function unregisterGlobalShortcuts() {
  globalShortcut.unregisterAll();
}

// Main app lifecycle events

// App ready event
app.whenReady().then(() => {
  try {
    console.log('App is ready');
    // Create main window
    createWindow();
    
    // Register system capabilities
    setupSystemCapabilities();
    
    // Register global shortcuts
    registerGlobalShortcuts();
    
    // Setup IPC handlers
    setupIpcHandlers();
    
    // Handle window activation
    app.on('activate', () => {
      try {
        // On macOS, re-create window when dock icon is clicked and no windows are open
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      } catch (error) {
        logError('App Activate', error);
      }
    });
  } catch (error) {
    logError('App Ready', error);
    dialog.showErrorBox('Application Startup Error', 
      `Failed to start the application: ${error.message}`);
    app.quit();
  }
}).catch(error => {
  logError('App Ready Promise', error);
  dialog.showErrorBox('Application Startup Error', 
    `Failed to start the application: ${error.message}`);
  app.quit();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  try {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  } catch (error) {
    logError('Window All Closed', error);
    app.quit();
  }
});

// Clean up before quit
app.on('will-quit', (event) => {
  try {
    // Unregister global shortcuts
    unregisterGlobalShortcuts();
    
    // Check if recording is in progress
    if (isRecording) {
      console.log('Recording in progress, stopping for app quit');
      // Stop recording timer
      stopRecordingTimer();
      
      // Stop disk space monitoring
      stopDiskSpaceMonitoring();
      
      // Check if we have segments to save before quitting
      if (tempSessionDir && fs.existsSync(tempSessionDir)) {
        event.preventDefault(); // Prevent quitting while handling segments
        
        dialog.showMessageBox({
          type: 'question',
          title: 'Recording in Progress',
          message: 'Recording is still in progress. What would you like to do?',
          buttons: ['Save Recording', 'Discard Recording', 'Cancel'],
          defaultId: 0,
          cancelId: 2
        }).then(async ({ response }) => {
          if (response === 0) {
            // Save recording
            try {
              await handleQuickRecordingSave();
            } catch (err) {
              logError('Quick Recording Save', err);
            }
            app.quit();
          } else if (response === 1) {
            // Discard recording
            try {
              if (tempSessionDir && fs.existsSync(tempSessionDir)) {
                fs.rmSync(tempSessionDir, { recursive: true, force: true });
                console.log('Removed temporary session directory');
              }
            } catch (err) {
              logError('Remove Temp Dir', err);
            }
            app.quit();
          }
          // If response === 2 (Cancel), do nothing and allow user to continue
        }).catch(err => {
          logError('Recording Dialog', err);
          app.quit(); // Quit anyway if dialog fails
        });
      }
    }
  } catch (error) {
    logError('Will Quit', error);
  }
});

// Quick save of recording on app quit
async function handleQuickRecordingSave() {
  try {
    if (!tempSessionDir || !fs.existsSync(tempSessionDir)) {
      console.log('No temp directory to save from');
      return;
    }
    
    const segments = await listSegments(tempSessionDir);
    if (segments.length === 0) {
      console.log('No segments to save');
      return;
    }
    
    // Create output filename with timestamp
    const timestamp = new Date().toISOString()
      .replace(/:/g, '.')
      .replace(/T/, ' at ')
      .replace(/\..+/, '');
    
    const outputFilename = `Magic Window Recording - ${timestamp} - AUTO-SAVED.mp4`;
    
    // Get or initialize save path
    await initializeSavePath();
    
    // Create output directory
    const saveDir = getCurrentRecordingDir(currentSavePath);
    ensureDirExists(saveDir);
    
    const outputPath = path.join(saveDir, outputFilename);
    console.log('Quick save output path:', outputPath);
    
    // Concatenate segments
    await concatenateSegments(tempSessionDir, outputPath);
    
    console.log('Quick save completed successfully');
    
    // Clean up temp directory
    if (tempSessionDir && fs.existsSync(tempSessionDir)) {
      fs.rmSync(tempSessionDir, { recursive: true, force: true });
      console.log('Removed temporary session directory');
    }
  } catch (error) {
    logError('Handle Quick Recording Save', error);
    throw error;
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError('Uncaught Exception', error);
  // Show dialog only if app is ready
  if (app.isReady()) {
    dialog.showErrorBox('Application Error', 
      `An unexpected error occurred: ${error.message}\n\nThe application will now close.`);
  }
  
  // Force exit after showing dialog and logging
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logError('Unhandled Rejection', { reason, promise });
});

// Setup IPC handlers
function setupIpcHandlers() {
  try {
    // Setup IPC handlers for main process
    
    // Handle getSources request
    ipcMain.handle('getSources', async () => {
      try {
        console.log('getSources handler called');
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 150, height: 150 },
          fetchWindowIcons: true
        });
        console.log(`Found ${sources.length} capture sources`);
        return sources;
      } catch (error) {
        logError('Get Sources', error);
        throw error; // Re-throw to propagate to renderer
      }
    });
    
    // Handle getScreenSources request (backup method if renderer can't use desktopCapturer)
    ipcMain.handle('getScreenSources', async () => {
      try {
        console.log('getScreenSources handler called from main');
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 150, height: 150 },
          fetchWindowIcons: true
        });
        console.log(`Found ${sources.length} sources via main process`);
        return sources;
      } catch (error) {
        logError('Get Screen Sources', error);
        throw error;
      }
    });
    
    // Handle settings requests
    ipcMain.handle('getSettings', () => {
      try {
        return {
          savePath: store.get('savePath', app.getPath('videos')),
          // Add more settings as needed
        };
      } catch (error) {
        logError('Get Settings', error);
        // Return defaults if error
        return { savePath: app.getPath('videos') };
      }
    });
    
    // Handle show save dialog
    ipcMain.handle('showSaveDialog', async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: store.get('savePath', app.getPath('videos')),
          title: 'Choose Save Location for Recordings',
          buttonLabel: 'Select Folder'
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
          const selectedPath = result.filePaths[0];
          console.log('Selected save path:', selectedPath);
          
          // Save to settings
          store.set('savePath', selectedPath);
          return selectedPath;
        }
        
        // Return current setting if dialog canceled
        return store.get('savePath', app.getPath('videos'));
      } catch (error) {
        logError('Show Save Dialog', error);
        throw error;
      }
    });
    
    // Handle source selection
    ipcMain.on('sourceSelected', (event, id) => {
      try {
        console.log('Source selected:', id);
        sourceId = id;
      } catch (error) {
        logError('Source Selected', error);
      }
    });
    
    // Start recording from renderer
    ipcMain.on('startCanvasRecording', async (event) => {
      try {
        console.log('Start canvas recording request from renderer');
        
        if (isRecording) {
          console.log('Already recording, ignoring request');
          return;
        }
        
        // Set recording window to the sender's window
        recordingWindow = BrowserWindow.fromWebContents(event.sender);
        if (!recordingWindow) {
          console.error('Could not get recording window from event sender');
          return;
        }
        
        console.log('Setting up recording with window:', recordingWindow.id);
        
        // Get or initialize save path
        await initializeSavePath();
        
        // Create temporary directory for this recording session
        try {
          tempSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-window-recorder', 'recording-session-'));
          console.log('Created temporary session directory:', tempSessionDir);
        } catch (error) {
          logError('Create Temp Dir', error);
          // Create the parent directory if it doesn't exist
          const parentDir = path.join(os.tmpdir(), 'magic-window-recorder');
          fs.mkdirSync(parentDir, { recursive: true });
          tempSessionDir = fs.mkdtempSync(path.join(parentDir, 'recording-session-'));
          console.log('Created temporary session directory (second attempt):', tempSessionDir);
        }
        
        // Reset segment index
        segmentIndex = 0;
        
        // Start disk space monitoring
        startDiskSpaceMonitoring();
        
        // Set recording state
        isRecording = true;
        isPaused = false;
        
        // Start recording timer
        startRecordingTimer();
        
        // Notify renderer of recording state
        sendStateUpdate();
        
        // Create and show floating panel
        createOrShowFloatingPanel();
        
        console.log('Recording started successfully');
      } catch (error) {
        logError('Start Canvas Recording', error);
        // Reset state
        isRecording = false;
        isPaused = false;
        tempSessionDir = null;
        
        // Notify renderer of error
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('recordingError', {
            message: 'Failed to start recording',
            detail: error.message
          });
        }
      }
    });
    
    // Receive blob chunks from renderer
    ipcMain.on('sendBlobChunk', async (event, chunkData) => {
      try {
        if (!isRecording || !tempSessionDir) {
          console.warn('Received chunk but not in recording state, ignoring');
          return;
        }
        
        if (isPaused) {
          console.log('Recording paused, ignoring chunk');
          return;
        }
        
        // Write blob data to disk
        const segmentPath = path.join(tempSessionDir, `segment_${segmentIndex++}.mp4`);
        console.log(`Writing segment ${segmentIndex} to ${segmentPath}`);
        
        fs.writeFileSync(segmentPath, Buffer.from(chunkData));
        console.log(`Segment ${segmentIndex} saved, size: ${chunkData.byteLength} bytes`);
      } catch (error) {
        logError('Receive Blob Chunk', error);
      }
    });
    
    // Stop recording
    ipcMain.on('stopRecording', async () => {
      try {
        if (!isRecording) {
          console.log('Not recording, ignoring stop request');
          return;
        }
        
        console.log('Stopping recording');
        
        // Stop disk space monitoring
        stopDiskSpaceMonitoring();
        
        // Stop recording timer
        stopRecordingTimer();
        
        // Set recording state
        isRecording = false;
        isPaused = false;
        
        // Notify renderer of recording state
        sendStateUpdate();
        
        // Hide floating panel
        if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) {
          floatingPanelWindow.hide();
        }
        
        // Check if we have segments to concatenate
        if (tempSessionDir && fs.existsSync(tempSessionDir)) {
          const segments = await listSegments(tempSessionDir);
          
          if (segments.length === 0) {
            console.log('No segments to concatenate');
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', {
                status: 'error',
                message: 'Recording stopped but no video data was saved.'
              });
            }
            
            return;
          }
          
          console.log(`Found ${segments.length} segments to concatenate`);
          
          // Create output filename with timestamp
          const timestamp = new Date().toISOString()
            .replace(/:/g, '.')
            .replace(/T/, ' at ')
            .replace(/\..+/, '');
          
          const outputFilename = `Magic Window Recording - ${timestamp}.mp4`;
          
          // Create output directory
          const saveDir = getCurrentRecordingDir(currentSavePath);
          ensureDirExists(saveDir);
          
          const outputPath = path.join(saveDir, outputFilename);
          console.log('Output path:', outputPath);
          
          // Notify renderer that concatenation started
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('concatenationStatus', {
              status: 'started',
              message: 'Processing recording...'
            });
          }
          
          try {
            // Concatenate segments
            await concatenateSegments(tempSessionDir, outputPath);
            
            // Notify renderer that concatenation completed
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', {
                status: 'completed',
                message: 'Recording saved successfully!',
                outputPath
              });
              
              // Also send recordingSaved event
              mainWindow.webContents.send('recordingSaved', outputPath);
            }
            
            console.log('Concatenation completed and recording saved');
            
            // Clean up temp directory
            try {
              fs.rmSync(tempSessionDir, { recursive: true, force: true });
              console.log('Removed temporary session directory');
              tempSessionDir = null;
            } catch (err) {
              logError('Remove Temp Dir', err);
            }
          } catch (error) {
            logError('Concatenate Segments', error);
            
            // Notify renderer of error
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', {
                status: 'error',
                message: `Failed to process recording: ${error.message}`
              });
            }
          }
        } else {
          console.log('No temp directory or it does not exist');
          
          // Notify renderer of error
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('concatenationStatus', {
              status: 'error',
              message: 'Recording stopped but temporary files are missing.'
            });
          }
        }
      } catch (error) {
        logError('Stop Recording', error);
        
        // Notify renderer of error
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('concatenationStatus', {
            status: 'error',
            message: `Failed to stop recording: ${error.message}`
          });
        }
      }
    });
    
    // Handle renderer error reporting
    ipcMain.on('renderer-error', (event, errorData) => {
      logError('Renderer Reported', errorData);
      // Could log to file here
    });
    
    // Handle panel error reporting
    ipcMain.on('panel-error', (event, errorData) => {
      logError('Panel Reported', errorData);
      // Could log to file here
    });
    
    // Handle panel commands
    ipcMain.on('panel-toggle-pip', (event) => {
      try {
        console.log('Panel requested PiP toggle');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('toggle-pip');
        }
      } catch (error) {
        logError('Panel Toggle PiP', error);
      }
    });
    
    ipcMain.on('panel-zoom-in', (event) => {
      try {
        console.log('Panel requested zoom in');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('zoom-in');
        }
      } catch (error) {
        logError('Panel Zoom In', error);
      }
    });
    
    ipcMain.on('panel-zoom-out', (event) => {
      try {
        console.log('Panel requested zoom out');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('zoom-out');
        }
      } catch (error) {
        logError('Panel Zoom Out', error);
      }
    });
    
    ipcMain.on('panel-set-zoom-center', (event, coords) => {
      try {
        console.log(`Panel requested set zoom center: (${coords.x}, ${coords.y})`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('set-zoom-center', coords);
        }
      } catch (error) {
        logError('Panel Set Zoom Center', error);
      }
    });
    
    // Handle PiP state update
    ipcMain.on('pip-state-update', (event, isActive) => {
      try {
        console.log('PiP state update received:', isActive);
        
        // If there's a floating panel, relay the state to it
        if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) {
          floatingPanelWindow.webContents.send('update-pip-state', isActive);
        }
      } catch (error) {
        logError('PiP State Update', error);
      }
    });
    
    // Handle PiP frame update
    ipcMain.on('pip-frame-update', (event, dataURL) => {
      try {
        // If there's a floating panel, relay the frame to it
        if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) {
          floatingPanelWindow.webContents.send('pip-frame-update', dataURL);
        }
      } catch (error) {
        logError('PiP Frame Update', error);
      }
    });
    
    // Handle set-codec request
    ipcMain.on('set-codec', (event, codec) => {
      try {
        console.log('Codec preference set to:', codec);
        store.set('preferredCodec', codec);
      } catch (error) {
        logError('Set Codec', error);
      }
    });
  } catch (error) {
    logError('Setup IPC Handlers', error);
  }
}

// Function to check for previous unfinished recordings
async function checkForPreviousRecordings() {
  try {
    console.log('Checking for previous unfinished recordings...');
    const tempDir = path.join(os.tmpdir(), 'magic-window-recorder');
    
    // Check if temp directory exists
    if (!fs.existsSync(tempDir)) {
      console.log('No temporary recording directory found');
      return;
    }
    
    // Read directory contents
    const items = fs.readdirSync(tempDir);
    const tempSessionDirs = items.filter(item => {
      const fullPath = path.join(tempDir, item);
      return fs.statSync(fullPath).isDirectory() && 
             item.startsWith('recording-session-');
    });
    
    if (tempSessionDirs.length === 0) {
      console.log('No previous recording sessions found');
      return;
    }
    
    console.log(`Found ${tempSessionDirs.length} previous recording sessions`);
    
    // Ask user if they want to recover
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Recover Previous Recordings',
      message: 'Found previous recording sessions that may have been interrupted.',
      detail: `${tempSessionDirs.length} recording session(s) found. Would you like to attempt recovery?`,
      buttons: ['Yes, Recover', 'No, Delete'],
      defaultId: 0,
      cancelId: 1
    });
    
    if (response === 0) {
      // User wants to recover
      console.log('User chose to recover recordings');
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-recovery-dialog', tempSessionDirs);
      } else {
        await handleRecovery(tempSessionDirs);
      }
    } else {
      // User chose to delete without recovery
      console.log('User chose to delete previous recordings without recovery');
      for (const dir of tempSessionDirs) {
        const fullPath = path.join(tempDir, dir);
        try {
          console.log(`Removing directory: ${fullPath}`);
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch (err) {
          logError('Remove Temp Dir', err);
        }
      }
    }
  } catch (error) {
    logError('Check Previous Recordings', error);
  }
}

// Handle recovery of previous recordings
async function handleRecovery(tempSessionDirs) {
  try {
    console.log('Handling recovery...');
    // Initialize save path if needed
    await initializeSavePath();
    
    for (const dir of tempSessionDirs) {
      const fullPath = path.join(os.tmpdir(), 'magic-window-recorder', dir);
      console.log(`Attempting to recover from: ${fullPath}`);
      
      if (!fs.existsSync(fullPath)) {
        console.log(`Directory no longer exists: ${fullPath}`);
        continue;
      }
      
      const segments = await listSegments(fullPath);
      if (segments.length === 0) {
        console.log(`No segments found in ${fullPath}`);
        continue;
      }
      
      // Create recovery filename
      const timestamp = new Date().toISOString()
        .replace(/:/g, '.')
        .replace(/T/, ' at ')
        .replace(/\..+/, '');
      const saveName = `Magic Window Recording - ${timestamp} - RECOVERED.mp4`;
      
      // Get save directory
      const saveDir = getCurrentRecordingDir(currentSavePath);
      ensureDirExists(saveDir);
      
      const savePath = path.join(saveDir, saveName);
      
      // Send status message
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('concatenationStatus', {
          status: 'started',
          message: `Recovering ${segments.length} segments from interrupted recording...`
        });
      }
      
      // Concatenate using ffmpeg
      await concatenateSegments(fullPath, savePath);
      
      // Send completion message
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('concatenationStatus', {
          status: 'completed',
          message: 'Recovery completed successfully!',
          outputPath: savePath
        });
        
        // Send recordingSaved event
        mainWindow.webContents.send('recordingSaved', savePath);
      }
      
      try {
        // Remove temp directory
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch (err) {
        logError('Remove Temp Dir After Recovery', err);
      }
    }
  } catch (error) {
    logError('Handle Recovery', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('concatenationStatus', {
        status: 'error',
        message: `Recovery failed: ${error.message}`
      });
    }
  }
}

// Function to create or show the floating panel
function createOrShowFloatingPanel() {
  try {
    // If the panel already exists, just show it
    if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) {
      floatingPanelWindow.show();
      return;
    }
    
    // Create a new panel window
    floatingPanelWindow = new BrowserWindow({
      width: 240,
      height: 180,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      resizable: false,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preloadPanel.js'),
        contextIsolation: true,
        nodeIntegration: false,
        enableRemoteModule: false,
        webSecurity: true,
        sandbox: true // Enable sandbox for renderer process
      }
    });
    
    // Place it in a good position relative to main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds();
      floatingPanelWindow.setPosition(
        mainBounds.x + mainBounds.width - 260,
        mainBounds.y + 80
      );
    }
    
    // Set the window to ignore mouse events (for click-through)
    // We will set parts of the UI to intercept clicks in the renderer
    // floatingPanelWindow.setIgnoreMouseEvents(true, { forward: true });
    
    // Load panel HTML
    floatingPanelWindow.loadFile('panel.html').catch(err => {
      logError('Panel Window Load', err);
    });
    
    // Handle failed loading
    floatingPanelWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      logError('Panel Window Load Failed', `${errorCode}: ${errorDescription}`);
    });
    
    // Show panel when loaded
    floatingPanelWindow.once('ready-to-show', () => {
      floatingPanelWindow.show();
    });
    
    // Handle crashes
    floatingPanelWindow.webContents.on('crashed', (event, killed) => {
      logError('Panel Renderer Crash', `Panel renderer process ${killed ? 'was killed' : 'crashed'}`);
      
      // Recreate the panel
      setTimeout(() => {
        if (isRecording) {
          createOrShowFloatingPanel();
        }
      }, 1000);
    });
    
    // Clean up on closed
    floatingPanelWindow.on('closed', () => {
      floatingPanelWindow = null;
    });
    
    // Handle panel collapse request
    ipcMain.on('panel-collapse', () => {
      try {
        console.log('Panel collapse requested');
        if (floatingPanelWindow && !floatingPanelWindow.isDestroyed()) {
          floatingPanelWindow.minimize();
        }
      } catch (error) {
        logError('Panel Collapse', error);
      }
    });
  } catch (error) {
    logError('Create Floating Panel', error);
  }
} 