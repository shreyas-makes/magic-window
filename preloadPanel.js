const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for the panel
contextBridge.exposeInMainWorld('panelAPI', {
  // Send commands from panel to main process
  zoomIn: () => {
    console.log('Panel: Sending zoomIn command');
    ipcRenderer.send('panel-zoom-in');
  },
  zoomOut: () => {
    console.log('Panel: Sending zoomOut command');
    ipcRenderer.send('panel-zoom-out');
  },
  togglePip: () => {
    console.log('Panel: Sending togglePip command');
    ipcRenderer.send('panel-toggle-pip');
  },
  collapse: () => {
    console.log('Panel: Sending collapse command');
    ipcRenderer.send('panel-collapse');
  },
  setZoomCenter: (x, y) => {
    console.log(`Panel: Sending setZoomCenter command: (${x}, ${y})`);
    ipcRenderer.send('panel-set-zoom-center', { x, y });
  },
  
  // Receive updates from main process
  onUpdateZoomLevel: (callback) => {
    ipcRenderer.on('update-zoom-level', (event, level) => {
      console.log('Panel: Received zoom level update:', level);
      callback(level);
    });
  },
  onUpdatePipState: (callback) => {
    ipcRenderer.on('update-pip-state', (event, isActive) => {
      console.log('Panel: Received PiP state update:', isActive);
      callback(isActive);
    });
  },
  onPipFrameUpdate: (callback) => {
    ipcRenderer.on('pip-frame-update', (event, dataURL) => {
      console.log(`Panel: Received PiP frame update: ${dataURL ? Math.round(dataURL.length / 1024) : 0}KB`);
      callback(dataURL);
    });
  },
  onVideoSizeUpdate: (callback) => {
    ipcRenderer.on('video-size-update', (event, width, height) => {
      callback(width, height);
    });
  },
  onZoomStateUpdate: (callback) => {
    ipcRenderer.on('zoom-state-update', (event, zoomState) => {
      console.log('Panel: Received zoom state update');
      callback(zoomState);
    });
  }
}); 