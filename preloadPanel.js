const { contextBridge, ipcRenderer } = require('electron');

// Error handling wrapper for IPC calls
const safeIpcSend = (channel, ...args) => {
  try {
    console.log(`Panel: Sending ${channel} command`);
    ipcRenderer.send(channel, ...args);
  } catch (error) {
    console.error(`Error in panel IPC send to ${channel}:`, error);
  }
};

// Expose protected methods for the panel
contextBridge.exposeInMainWorld('panelAPI', {
  // Send commands from panel to main process
  zoomIn: () => {
    safeIpcSend('panel-zoom-in');
  },
  zoomOut: () => {
    safeIpcSend('panel-zoom-out');
  },
  togglePip: () => {
    safeIpcSend('panel-toggle-pip');
  },
  collapse: () => {
    safeIpcSend('panel-collapse');
  },
  setZoomCenter: (x, y) => {
    console.log(`Panel: Sending setZoomCenter command: (${x}, ${y})`);
    safeIpcSend('panel-set-zoom-center', { x, y });
  },
  
  // Receive updates from main process
  onUpdateZoomLevel: (callback) => {
    try {
      ipcRenderer.on('update-zoom-level', (event, level) => {
        try {
          console.log('Panel: Received zoom level update:', level);
          callback(level);
        } catch (error) {
          console.error('Error in update-zoom-level handler:', error);
        }
      });
    } catch (error) {
      console.error('Error setting up update-zoom-level listener:', error);
    }
  },
  onUpdatePipState: (callback) => {
    try {
      ipcRenderer.on('update-pip-state', (event, isActive) => {
        try {
          console.log('Panel: Received PiP state update:', isActive);
          callback(isActive);
        } catch (error) {
          console.error('Error in update-pip-state handler:', error);
        }
      });
    } catch (error) {
      console.error('Error setting up update-pip-state listener:', error);
    }
  },
  onPipFrameUpdate: (callback) => {
    try {
      ipcRenderer.on('pip-frame-update', (event, dataURL) => {
        try {
          console.log(`Panel: Received PiP frame update: ${dataURL ? Math.round(dataURL.length / 1024) : 0}KB`);
          callback(dataURL);
        } catch (error) {
          console.error('Error in pip-frame-update handler:', error);
        }
      });
    } catch (error) {
      console.error('Error setting up pip-frame-update listener:', error);
    }
  },
  onVideoSizeUpdate: (callback) => {
    try {
      ipcRenderer.on('video-size-update', (event, width, height) => {
        try {
          callback(width, height);
        } catch (error) {
          console.error('Error in video-size-update handler:', error);
        }
      });
    } catch (error) {
      console.error('Error setting up video-size-update listener:', error);
    }
  },
  onZoomStateUpdate: (callback) => {
    try {
      ipcRenderer.on('zoom-state-update', (event, zoomState) => {
        try {
          console.log('Panel: Received zoom state update');
          callback(zoomState);
        } catch (error) {
          console.error('Error in zoom-state-update handler:', error);
        }
      });
    } catch (error) {
      console.error('Error setting up zoom-state-update listener:', error);
    }
  },
  // Report panel errors to main process
  reportError: (error) => {
    try {
      console.error('Panel: Reporting error to main process:', error);
      ipcRenderer.send('panel-error', {
        message: error.message || 'Unknown panel error',
        stack: error.stack || '',
        timestamp: new Date().toISOString()
      });
    } catch (sendError) {
      console.error('Error reporting panel error to main process:', sendError);
    }
  }
}); 