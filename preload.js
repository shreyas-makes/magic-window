const { contextBridge, ipcRenderer } = require('electron');

// Error handling wrapper for IPC calls
const safeIpcInvoke = async (channel, ...args) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    console.error(`Error in IPC invoke to ${channel}:`, error);
    throw error; // Rethrow so caller can handle it
  }
};

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send a message to the main process
  send: (channel, data) => {
    // Only allow certain channels to be sent
    let validChannels = [
      'ping', 
      'sourceSelected', 
      'startRecording', 
      'stopRecording', 
      'open-file', 
      'pauseRecording', 
      'resumeRecording', 
      'startCanvasRecording', 
      'sendBlobChunk', 
      'zoom-level-update',
      'pip-frame-update',
      'pip-state-update',
      'video-size-update',
      'zoom-state-update',
      'recordingMimeType',
      'renderer-error' // New channel for renderer error reporting
    ];
    if (validChannels.includes(channel)) {
      try {
        console.log('Sending IPC message:', channel);
        ipcRenderer.send(channel, data);
      } catch (error) {
        console.error(`Error sending message on channel ${channel}:`, error);
      }
    } else {
      console.warn('Attempted to send message on invalid channel:', channel);
    }
  },
  // Register handler for IPC events from main process
  on: (channel, func) => {
    // Only allow certain channels to be received
    let validChannels = [
      'pong', 
      'updateState', 
      'recordingError', 
      'recordingSaved', 
      'recordingMimeType', 
      'hotkey-start-recording', 
      'diskSpaceWarning', 
      'concatenationStatus', 
      'recordingLimitReached', 
      'zoom-in', 
      'zoom-out', 
      'toggle-pip',
      'set-zoom-center',
      'zoom-preset',
      'show-recovery-dialog' // New channel for recovery dialog
    ];
    if (validChannels.includes(channel)) {
      console.log('Registering handler for channel:', channel);
      
      try {
        // Add special logging for recordingSaved
        if (channel === 'recordingSaved') {
          ipcRenderer.on(channel, (event, ...args) => {
            console.log('PRELOAD: Received recordingSaved event with data:', args);
            try {
              func(...args);
            } catch (error) {
              console.error(`Error in handler for ${channel}:`, error);
            }
          });
        } else {
          // Deliberately strip event as it includes `sender`
          ipcRenderer.on(channel, (event, ...args) => {
            try {
              func(...args);
            } catch (error) {
              console.error(`Error in handler for ${channel}:`, error);
            }
          });
        }
      } catch (error) {
        console.error(`Error registering handler for ${channel}:`, error);
      }
    } else {
      console.warn('Attempted to register handler for invalid channel:', channel);
    }
  },
  // Get sources (screen/windows) for recording - use main process only approach
  getSources: () => safeIpcInvoke('getSources'),
  // Get direct desktop capture sources - use main process only approach
  captureDesktop: () => {
    console.log('Invoking captureDesktop from preload');
    return safeIpcInvoke('captureDesktop');
  },
  // Get screen sources - use main process only approach
  getScreenSources: async () => {
    try {
      console.log('Called getScreenSources from preload');
      return await safeIpcInvoke('getScreenSources');
    } catch (error) {
      console.error('Error in getScreenSources:', error);
      throw error;
    }
  },
  // Get screen capture directly from the main process (more reliable on macOS)
  captureScreenDirectly: async () => {
    try {
      console.log('Requesting direct screen capture from main process');
      return await safeIpcInvoke('captureScreenDirectly');
    } catch (error) {
      console.error('Error in captureScreenDirectly:', error);
      throw error;
    }
  },
  // Get settings from main process
  getSettings: () => safeIpcInvoke('getSettings'),
  // Show save dialog
  showSaveDialog: () => safeIpcInvoke('showSaveDialog'),
  // Get list of segments in a directory
  listSegments: (dirPath) => safeIpcInvoke('listSegments', dirPath),
  // Send source selected event
  sourceSelected: (sourceId) => {
    try {
      console.log('Source selected in renderer');
      ipcRenderer.send('sourceSelected', sourceId);
    } catch (error) {
      console.error('Error in sourceSelected:', error);
    }
  },
  // Start recording
  startRecording: () => {
    try {
      console.log('Start recording called from renderer');
      ipcRenderer.send('startRecording');
    } catch (error) {
      console.error('Error in startRecording:', error);
    }
  },
  // Start canvas recording (new method)
  startCanvasRecording: () => {
    try {
      console.log('Start canvas recording called from renderer');
      ipcRenderer.send('startCanvasRecording');
    } catch (error) {
      console.error('Error in startCanvasRecording:', error);
    }
  },
  // Send blob chunk to main process (new method)
  sendBlobChunk: (chunkData) => {
    try {
      ipcRenderer.send('sendBlobChunk', chunkData);
    } catch (error) {
      console.error('Error in sendBlobChunk:', error);
    }
  },
  // Stop recording
  stopRecording: () => {
    try {
      console.log('Stop recording called from renderer');
      ipcRenderer.send('stopRecording');
    } catch (error) {
      console.error('Error in stopRecording:', error);
    }
  },
  // Pause recording
  pauseRecording: () => {
    try {
      console.log('Pause recording called from renderer');
      ipcRenderer.send('pauseRecording');
    } catch (error) {
      console.error('Error in pauseRecording:', error);
    }
  },
  // Resume recording
  resumeRecording: () => {
    try {
      console.log('Resume recording called from renderer');
      ipcRenderer.send('resumeRecording');
    } catch (error) {
      console.error('Error in resumeRecording:', error);
    }
  },
  // Add openFile method
  openFile: (filePath) => {
    try {
      console.log('Opening file:', filePath);
      ipcRenderer.send('open-file', filePath);
    } catch (error) {
      console.error('Error in openFile:', error);
    }
  },
  // Disk space warning handler
  onDiskSpaceWarning: (callback) => {
    ipcRenderer.on('diskSpaceWarning', (event, data) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in diskSpaceWarning handler:', error);
      }
    });
  },
  // Concatenation status handler
  onConcatenationStatus: (callback) => {
    ipcRenderer.on('concatenationStatus', (event, data) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in concatenationStatus handler:', error);
      }
    });
  },
  // Recording limit reached handler
  onRecordingLimitReached: (callback) => {
    ipcRenderer.on('recordingLimitReached', (event) => {
      try {
        callback();
      } catch (error) {
        console.error('Error in recordingLimitReached handler:', error);
      }
    });
  },
  // Send zoom level update to main process
  sendZoomLevelUpdate: (level) => {
    try {
      console.log('Sending zoom level update:', level);
      ipcRenderer.send('zoom-level-update', level);
    } catch (error) {
      console.error('Error in sendZoomLevelUpdate:', error);
    }
  },
  // Add methods for PiP functionality
  sendPipFrameUpdate: (dataURL) => {
    try {
      console.log('Sending PiP frame update to main process');
      ipcRenderer.send('pip-frame-update', dataURL);
    } catch (error) {
      console.error('Error in sendPipFrameUpdate:', error);
    }
  },
  sendPipStateUpdate: (isActive) => {
    try {
      console.log('Sending PiP state update to main process:', isActive);
      ipcRenderer.send('pip-state-update', isActive);
    } catch (error) {
      console.error('Error in sendPipStateUpdate:', error);
    }
  },
  sendVideoSizeUpdate: (width, height) => {
    try {
      console.log(`Sending video size update to main process: ${width}x${height}`);
      ipcRenderer.send('video-size-update', width, height);
    } catch (error) {
      console.error('Error in sendVideoSizeUpdate:', error);
    }
  },
  sendZoomStateUpdate: (zoomState) => {
    try {
      console.log('Sending zoom state update to main process');
      ipcRenderer.send('zoom-state-update', zoomState);
    } catch (error) {
      console.error('Error in sendZoomStateUpdate:', error);
    }
  },
  // Add listeners for PiP commands
  onTogglePip: (callback) => {
    try {
      console.log('Registering handler for channel: toggle-pip');
      ipcRenderer.on('toggle-pip', (event) => {
        try {
          callback();
        } catch (error) {
          console.error('Error in toggle-pip handler:', error);
        }
      });
    } catch (error) {
      console.error('Error registering toggle-pip handler:', error);
    }
  },
  onSetZoomCenter: (callback) => {
    try {
      console.log('Registering handler for channel: set-zoom-center');
      ipcRenderer.on('set-zoom-center', (event, coords) => {
        try {
          callback(coords);
        } catch (error) {
          console.error('Error in set-zoom-center handler:', error);
        }
      });
    } catch (error) {
      console.error('Error registering set-zoom-center handler:', error);
    }
  },
  onZoomPreset: (callback) => {
    try {
      console.log('Registering handler for channel: zoom-preset');
      ipcRenderer.on('zoom-preset', (event, data) => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in zoom-preset handler:', error);
        }
      });
    } catch (error) {
      console.error('Error registering zoom-preset handler:', error);
    }
  },
  // Report a renderer error to the main process
  reportError: (error) => {
    try {
      console.error('Reporting error to main process:', error);
      ipcRenderer.send('renderer-error', {
        message: error.message || 'Unknown error',
        stack: error.stack || '',
        timestamp: new Date().toISOString()
      });
    } catch (sendError) {
      console.error('Error reporting error to main process:', sendError);
    }
  },
  // Recovery handler
  onShowRecoveryDialog: (callback) => {
    try {
      ipcRenderer.on('show-recovery-dialog', (event, tempDirs) => {
        try {
          callback(tempDirs);
        } catch (error) {
          console.error('Error in show-recovery-dialog handler:', error);
        }
      });
    } catch (error) {
      console.error('Error registering show-recovery-dialog handler:', error);
    }
  }
}); 