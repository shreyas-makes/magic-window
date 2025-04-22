const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Send a message to the main process
  send: (channel, data) => {
    // Only allow certain channels to be sent
    let validChannels = ['ping', 'sourceSelected', 'startRecording', 'stopRecording', 'open-file', 'pauseRecording', 'resumeRecording'];
    if (validChannels.includes(channel)) {
      console.log('Sending IPC message:', channel);
      ipcRenderer.send(channel, data);
    } else {
      console.warn('Attempted to send message on invalid channel:', channel);
    }
  },
  // Register handler for IPC events from main process
  on: (channel, func) => {
    // Only allow certain channels to be received
    let validChannels = ['pong', 'updateState', 'recordingError', 'recordingSaved', 'recordingMimeType', 'hotkey-start-recording', 'diskSpaceWarning', 'concatenationStatus', 'recordingLimitReached'];
    if (validChannels.includes(channel)) {
      console.log('Registering handler for channel:', channel);
      
      // Add special logging for recordingSaved
      if (channel === 'recordingSaved') {
        ipcRenderer.on(channel, (event, ...args) => {
          console.log('PRELOAD: Received recordingSaved event with data:', args);
          func(...args);
        });
      } else {
        // Deliberately strip event as it includes `sender`
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    } else {
      console.warn('Attempted to register handler for invalid channel:', channel);
    }
  },
  // Get sources (screen/windows) for recording
  getSources: () => ipcRenderer.invoke('getSources'),
  // Get settings from main process
  getSettings: () => ipcRenderer.invoke('getSettings'),
  // Show save dialog
  showSaveDialog: () => ipcRenderer.invoke('showSaveDialog'),
  // Get list of segments in a directory
  listSegments: (dirPath) => ipcRenderer.invoke('listSegments', dirPath),
  // Send source selected event
  sourceSelected: (sourceId) => ipcRenderer.send('sourceSelected', sourceId),
  // Start recording
  startRecording: () => {
    console.log('Start recording called from renderer');
    ipcRenderer.send('startRecording');
  },
  // Stop recording
  stopRecording: () => {
    console.log('Stop recording called from renderer');
    ipcRenderer.send('stopRecording');
  },
  // Pause recording
  pauseRecording: () => {
    console.log('Pause recording called from renderer');
    ipcRenderer.send('pauseRecording');
  },
  // Resume recording
  resumeRecording: () => {
    console.log('Resume recording called from renderer');
    ipcRenderer.send('resumeRecording');
  },
  // Add openFile method
  openFile: (filePath) => {
    console.log('Opening file:', filePath);
    ipcRenderer.send('open-file', filePath);
  },
  // Disk space warning handler
  onDiskSpaceWarning: (callback) => {
    ipcRenderer.on('diskSpaceWarning', (event, data) => callback(data));
  },
  // Concatenation status handler
  onConcatenationStatus: (callback) => {
    ipcRenderer.on('concatenationStatus', (event, data) => callback(data));
  },
  // Recording limit reached handler
  onRecordingLimitReached: (callback) => {
    ipcRenderer.on('recordingLimitReached', (event) => callback());
  }
}); 