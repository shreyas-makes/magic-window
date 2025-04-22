const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static').path;
const checkDiskSpace = require('check-disk-space').default;

// Set ffmpeg and ffprobe paths to the static binaries
ffmpeg.setFfmpegPath(ffmpegStatic);
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
  console.error('Error setting ffprobe path:', err);
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
let diskSpaceInterval = null; // For disk space checking interval
let recordingTimer = null; // For tracking recording duration
let recordingSeconds = 0; // For counting recording seconds
const MAX_RECORDING_SECONDS = 7200; // 2 hours (7200 seconds)

// Disk space thresholds
const DISK_SPACE_LOW_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB
const DISK_SPACE_CRITICAL_THRESHOLD = 100 * 1024 * 1024; // 100MB

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
async function concatenateSegments(tempDir) {
  if (!tempDir || !fs.existsSync(tempDir)) {
    throw new Error('Temporary directory does not exist');
  }
  
  try {
    // Get list of segment files
    const segmentFiles = await listSegments(tempDir);
    
    if (!segmentFiles || segmentFiles.length === 0) {
      throw new Error('No segment files found');
    }
    
    // Ensure target directory exists
    const outputDir = getCurrentRecordingDir(currentSavePath);
    ensureDirExists(outputDir);
    
    // Create output file name with timestamp
    const timestamp = getFormattedTimestamp();
    const outputFileName = `Magic Window Recording - ${timestamp}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);
    
    console.log(`Concatenating ${segmentFiles.length} segments to: ${outputPath}`);
    
    return new Promise((resolve, reject) => {
      try {
        // Always use concat demuxer method for better reliability
        // Create a concat file that lists all segments
        const concatFilePath = path.join(tempDir, 'concat_list.txt');
        const concatContent = segmentFiles
          .map(segment => `file '${segment.path.replace(/'/g, "'\\''")}'`)
          .join('\n');
          
        fs.writeFileSync(concatFilePath, concatContent);
        console.log('Created concat file with content:', concatContent);
        
        // Create a new ffmpeg command using the demuxer method
        const command = ffmpeg()
          .input(concatFilePath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions('-c copy') // Copy both video and audio codec without re-encoding
          .output(outputPath);
        
        // Set event handlers
        command
          .on('start', cmdLine => {
            console.log('FFmpeg started with command:', cmdLine);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', { status: 'started' });
            }
          })
          .on('progress', progress => {
            console.log(`FFmpeg processing: ${JSON.stringify(progress)}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', { 
                status: 'progress', 
                progress 
              });
            }
          })
          .on('error', async error => {
            console.error('Error concatenating segments with FFmpeg:', error);
            
            // Try fallback method for very small segments
            console.log('Attempting fallback method for concatenation...');
            
            try {
              // Simple binary file concatenation
              const writeStream = fs.createWriteStream(outputPath);
              
              for (const segment of segmentFiles) {
                console.log(`Concatenating segment: ${segment.name}`);
                
                if (segment.size > 0) {
                  // Read segment data and write to output file
                  const segmentData = fs.readFileSync(segment.path);
                  writeStream.write(segmentData);
                } else {
                  console.warn(`Skipping zero-byte segment: ${segment.name}`);
                }
              }
              
              writeStream.end();
              
              // Wait for write to complete
              await new Promise((res) => writeStream.on('finish', res));
              
              console.log('Fallback concatenation complete');
              
              // Clean up temporary directory
              try {
                fs.rmSync(tempDir, { recursive: true, force: true });
                console.log(`Temporary directory ${tempDir} removed`);
              } catch (cleanupError) {
                console.error('Error cleaning up temporary directory:', cleanupError);
              }
              
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('concatenationStatus', { 
                  status: 'complete', 
                  outputPath,
                  note: 'Used fallback method due to FFmpeg error'
                });
              }
              
              resolve(outputPath);
            } catch (fallbackError) {
              console.error('Fallback concatenation failed:', fallbackError);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('concatenationStatus', { 
                  status: 'error', 
                  error: `Both FFmpeg and fallback methods failed: ${fallbackError.message}` 
                });
                dialog.showErrorBox(
                  'Error Saving Recording', 
                  `Failed to process recording segments. Temporary files are preserved at: ${tempDir}`
                );
              }
              reject(fallbackError);
            }
          })
          .on('end', () => {
            console.log('FFmpeg concatenation complete');
            
            // Clean up temporary directory
            try {
              fs.rmSync(tempDir, { recursive: true, force: true });
              console.log(`Temporary directory ${tempDir} removed`);
            } catch (cleanupError) {
              console.error('Error cleaning up temporary directory:', cleanupError);
            }
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('concatenationStatus', { 
                status: 'complete', 
                outputPath 
              });
            }
            
            resolve(outputPath);
          });
        
        // Run the command
        command.run();
      } catch (error) {
        console.error('FFmpeg command setup error:', error);
        reject(error);
      }
    });
  } catch (error) {
    console.error('Error in concatenation setup:', error);
    throw error;
  }
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
      // Check disk space before starting
      await checkDiskSpaceAvailable();
      
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
      
      // Start disk space monitoring
      startDiskSpaceMonitoring();
      
      // Start recording timer
      startRecordingTimer();
      
      console.log('Recording started, updated UI state');
      
      // Handle window close
      recordingWindow.on('closed', () => {
        recordingWindow = null;
        if (isRecording) {
          isRecording = false;
          isPaused = false;
          sendStateUpdate();
          
          // Stop disk space monitoring
          stopDiskSpaceMonitoring();
          
          // Stop recording timer
          stopRecordingTimer();
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
      
      // Skip segments with zero size (completely empty frames)
      if (!buffer || buffer.byteLength === 0) {
        console.warn(`Skipping segment ${segmentNumber} - empty (0 bytes)`);
        return;
      }
      
      // Log small segments but don't skip them
      if (buffer.byteLength < 1000) {
        console.warn(`Small segment ${segmentNumber} detected (${buffer.byteLength} bytes) - will try to process anyway`);
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
      
      // Verify the file was written correctly
      const stats = fs.statSync(segmentPath);
      console.log(`Segment ${segmentNumber} saved to: ${segmentPath} (${stats.size} bytes)`);
      
      if (stats.size === 0) {
        console.warn(`Warning: Segment ${segmentNumber} has zero bytes`);
      }
    } catch (error) {
      console.error('Error saving segment:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', error.toString());
      }
    }
  });
  
  // Handle listing segment files for the UI
  ipcMain.handle('listSegments', async (event, dirPath) => {
    try {
      return await listSegments(dirPath);
    } catch (error) {
      console.error('Error handling listSegments:', error);
      throw error;
    }
  });
  
  // Handle recording complete notification
  ipcMain.on('recording-complete', async () => {
    console.log('Recording completed, ready for concatenation');
    console.log(`All segments stored in: ${tempSessionDir}`);
    
    isRecording = false;
    isPaused = false;
    if (recordingWindow) {
      recordingWindow.close();
      recordingWindow = null;
    }
    sendStateUpdate();
    
    // Stop disk space monitoring
    stopDiskSpaceMonitoring();
    
    // Process and concatenate segments
    try {
      // Check if we have valid segments to process
      const segments = await listSegments(tempSessionDir);
      
      if (!segments || segments.length === 0) {
        throw new Error('No recording segments found. The recording may be empty.');
      }
      
      // Consider all non-zero segments as valid (even small ones)
      const validSegments = segments.filter(segment => segment.size > 0);
      
      if (validSegments.length === 0) {
        throw new Error('All recording segments are empty. No valid video data was captured.');
      }
      
      console.log(`Found ${validSegments.length} valid segments out of ${segments.length} total`);
      
      // Log warning about small segments
      const smallSegments = validSegments.filter(segment => segment.size < 10000);
      if (smallSegments.length > 0) {
        console.warn(`Warning: ${smallSegments.length} segments are smaller than 10KB and may have limited content`);
      }
      
      // If we only have one segment, just copy it instead of concatenating
      if (validSegments.length === 1) {
        console.log('Only one valid segment found, copying directly without concatenation');
        
        // Ensure target directory exists
        const outputDir = getCurrentRecordingDir(currentSavePath);
        ensureDirExists(outputDir);
        
        // Create output file name with timestamp
        const timestamp = getFormattedTimestamp();
        const outputFileName = `Magic Window Recording - ${timestamp}.mp4`;
        const outputPath = path.join(outputDir, outputFileName);
        
        // Copy the file
        fs.copyFileSync(validSegments[0].path, outputPath);
        console.log(`Copied segment to final recording at: ${outputPath}`);
        
        // Notify renderer that recording is saved
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recordingSaved', outputPath);
        }
        
        // Clean up temporary directory
        try {
          fs.rmSync(tempSessionDir, { recursive: true, force: true });
          console.log(`Temporary directory ${tempSessionDir} removed`);
        } catch (cleanupError) {
          console.error('Error cleaning up temporary directory:', cleanupError);
        }
      } else {
        // Proceed with concatenation
        const outputPath = await concatenateSegments(tempSessionDir);
        
        // Notify renderer that recording is saved
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recordingSaved', outputPath);
        }
      }
    } catch (error) {
      console.error('Error processing recording:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('recordingError', `Error processing recording: ${error.toString()}`);
      }
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
      
      // Stop disk space monitoring
      stopDiskSpaceMonitoring();
      
      // Stop recording timer
      stopRecordingTimer();
      
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