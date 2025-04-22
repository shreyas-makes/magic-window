Here's a more detailed checklist for building the Magic Window Screen Recorder:

Phase 1: Foundation & Core Recording
[x] Step 1: Basic Electron Project Setup
[x] Initialize Node.js project, add Electron v35 dependency
[x] Create main.js, index.html, renderer.js, preload.js
[x] Configure main.js to open a responsive BrowserWindow (80% of screen size)
[x] Implement basic app lifecycle handlers (ready, activate, window-all-closed)
[x] Set up preload.js with contextBridge to expose basic IPC
[x] Implement and test simple "ping-pong" IPC message
[x] Step 2: Screen/Window Source Selection
[x] Use desktopCapturer.getSources in main.js
[x] Create IPC handler (ipcMain.handle) to return sources
[x] Expose IPC invoker via preload.js
[x] Call IPC from renderer.js to get sources
[x] Populate a <select> dropdown in index.html with source names/IDs
[x] Add "Refresh" button to re-fetch sources
[x] Send selected source ID back to main process via IPC (ipcMain.on)
[x] Step 3: Basic Recording & Saving
[x] Get MediaStream from selected source ID (handle context: main/renderer/helper)
[x] Instantiate MediaRecorder with stream (video only, H.264 MP4 initially)
[x] Implement startRecording IPC handler
[x] Implement stopRecording IPC handler
[x] Set up mediaRecorder.ondataavailable to collect Blob chunks
[x] Set up mediaRecorder.onstop to combine chunks and save to a fixed temporary file (fs.writeFileSync)
[x] Add basic isRecording state in main process
[x] Send state updates (isRecording) to renderer via IPC
[x] Update renderer UI (e.g., disable buttons) based on state


Phase 2: UI & Basic Controls
[x] Step 4: Recording Controls (Hotkey, Timer, Save Location)
[x] Register globalShortcut (Cmd+Shift+9) in main.js
[x] Implement hotkey callback to toggle Start/Stop based on isRecording state
[x] Add "Start" / "Stop" buttons to index.html, wire to IPC
[x] Add timer display element to index.html
[x] Implement timer logic in renderer.js (start/stop/reset based on recording state)
[x] Add "Choose Save Folder" button and path display to index.html
[x] Implement dialog.showOpenDialog via IPC handler in main.js
[x] Install and use electron-store to persist the chosen save path
[x] Update saving logic to use the stored path (use basic timestamped filename for now)
[x] Add basic isPaused state variable (main) and placeholder Pause/Resume buttons/IPC (renderer/main)
[x] Step 5: Storage - File Naming, Structure, Segmentation
[x] Create helper function for final file naming (Magic Window Recording - YYYY-MM-DD at HH.MM.SS.mp4)
[x] Create helper function for directory structure ([BasePath]/Magic Window/YYYY-MM/), ensure directory creation
[x] Modify mediaRecorder.start() call to include timeslice (e.g., 10 minutes or 10 seconds for testing)
[x] On startRecording, create a unique temporary directory (fs.mkdtemp)
[x] Modify mediaRecorder.ondataavailable to save each chunk as segment_N.mp4 in the temp directory
[x] Step 6: Storage - Concatenation, Cleanup, Disk Check
[x] Install fluent-ffmpeg and ffmpeg-static
[x] Configure fluent-ffmpeg to use ffmpeg-static binary path
[x] In mediaRecorder.onstop, implement concatenation of segments using ffmpeg().mergeToFile() or concat demuxer
[x] Save concatenated file to final path/name/structure
[x] On successful concatenation, delete the temporary session directory (fs.rmSync)
[x] Add error handling for concatenation (log, notify user, do not delete temps)
[x] Install check-disk-space
[x] Implement periodic disk space check during recording (setInterval)
[x] Send IPC message to renderer for 'low' (<2GB) or 'critical' (<100MB) disk space
[x] Implement auto-stop recording on 'critical' disk space
[x] Update renderer UI to display disk space warnings



Phase 3/4: Zoom Engine & Rendering
[ ] Step 7: WebGL Canvas Setup & Frame Rendering
[ ] Install pixi.js
[ ] Add <canvas id="main-canvas"> (4K size, CSS scaled) and invisible <video id="source-video"> to index.html
[ ] Set up PIXI.Application attached to canvas in renderer.js
[ ] Modify renderer to get MediaStream via getUserMedia using source ID
[ ] Set stream as srcObject for invisible video element
[ ] Create PIXI.Texture and PIXI.Sprite from video, add sprite to Pixi stage
[ ] Get output stream from canvas (canvas.captureStream(60))
[ ] Refactor: Move MediaRecorder instantiation and ondataavailable handling to renderer.js, using the canvasStream
[ ] Create new IPC channel ('sendBlobChunk') for renderer to send Blob data to main
[ ] Modify main process to receive chunks via IPC and save them as segments
[ ] Adapt main process Start/Stop logic to be triggered by renderer IPC calls
[ ] Step 8: Basic Digital Zoom
[ ] Add state variables in renderer: zoomLevel, zoomCenterX, zoomCenterY
[ ] In Pixi update loop (app.ticker), apply videoSprite.scale, videoSprite.pivot, videoSprite.position based on state variables
[ ] Add temporary buttons/keys in renderer to test changing zoom state
[ ] Verify recorded output reflects the zoom seen on canvas
[ ] Step 9: Smooth Transitions & Advanced Filtering
[ ] Install gsap
[ ] Refactor state: use currentZoom/Center and targetZoom/Center
[ ] Create setZoom(level, x, y, duration) function using gsap.to() to animate current* variables
[ ] Update Pixi transforms in ticker based on animated current* values
[ ] Modify controls to call setZoom()
[ ] Confirm LINEAR filtering is used (defer Lanczos)
[ ] (Optional) Install @pixi/filter-fxaa, implement toggleable FXAA filter (sprite.filters)
[ ] Implement FPS calculation in ticker (app.ticker.FPS)
[ ] Log console warnings if FPS drops below threshold (~59 FPS)


Phase 5: Zoom UI & Interaction
[ ] Step 10: Floating Control Panel UI & Basic Wiring
[ ] Create new BrowserWindow in main for panel (borderless, always-on-top)
[ ] Create panel.html, preloadPanel.js, panelRenderer.js
[ ] Add panel HTML elements: zoom display span, zoom buttons, PiP toggle, collapse button
[ ] Set up contextBridge in preloadPanel.js for panel's IPC needs
[ ] Implement IPC relays in main.js (Panel <-> Main <-> Renderer)
[ ] Show/Hide panel window based on main recording state
[ ] Wire panel zoom buttons to send IPC commands relayed to main renderer
[ ] Send zoom level updates from main renderer (via main) to panel for display
[ ] Step 11: Zoom Controls - Shortcuts, Presets, Mouse Wheel
[ ] Register globalShortcut for Cmd+Plus / Cmd+Minus in main.js
[ ] Send 'zoomIn' / 'zoomOut' IPC directly to main renderer from shortcuts
[ ] Define zoom presets array in renderer.js ([1.0, 1.5, 2.0, 4.0])
[ ] Modify 'zoomIn'/'zoomOut' logic in renderer to step through presets using setZoom()
[ ] Add wheel event listener to main canvas in renderer.js
[ ] Check for modifier key (event.metaKey) in wheel event
[ ] If modifier pressed, call preset zoom logic based on event.deltaY
[ ] (Optional) Calculate zoom center based on cursor position for scroll zoom
[ ] Step 12: PiP Navigator Implementation
[ ] Add PiP container div and <canvas id="pip-canvas"> to panel.html
[ ] Set up second PIXI.Application for PiP canvas in panelRenderer.js
[ ] Implement throttled snapshot sending (downscaled original frame data URL) from main renderer via IPC ('pipFrameUpdate')
[ ] Relay snapshot data URL to panel via main process
[ ] Display received snapshot image in PiP canvas sprite (PIXI.Texture.fromURL)
[ ] Send current zoom state (level, center, canvasSize) from main renderer via IPC ('zoomStateUpdate')
[ ] Relay zoom state to panel via main process
[ ] Draw zoom rectangle (PIXI.Graphics) on PiP canvas based on received state
[ ] Add mouse listeners (mousedown, mousemove, mouseup) to PiP canvas
[ ] On PiP drag, calculate corresponding 4K center coordinates and send 'setZoomCenter' command via IPC
[ ] Implement 'setZoomCenter' listener in main renderer to call setZoom()
[ ] Implement PiP toggle button logic in panel
[ ] Register Cmd+0 shortcut in main to trigger PiP toggle IPC
[ ] Implement PiP visibility state and show/hide logic in panel/renderer
[ ] Step 13: "Magic Window" Border Effect
[ ] Create PIXI.Graphics object on main Pixi stage (renderer.js)
[ ] In ticker, clear graphics and draw rectangle matching zoom viewport bounds
[ ] Use lineStyle with a distinct color (e.g., purple) and thickness
[ ] Animate line alpha (0.5 + Math.sin(Date.now()*rate)*0.5) for pulsing effect
[ ] Create PIXI.Graphics object on PiP Pixi stage (panelRenderer.js)
[ ] Draw pulsing border around the zoom rectangle on PiP canvas


Phase 6: Integration, Polishing & Deployment
[x] Step 14: HEVC, Performance Tuning & Pause/Resume
[ ] Check MediaRecorder.isTypeSupported for HEVC (hvc1) in renderer
[x] Configure MediaRecorder mimeType for HEVC if supported (fallback to H.264)
[x] Set appropriate videoBitsPerSecond for 4K/60FPS HEVC (~20-40 Mbps)
[ ] Profile CPU/GPU/RAM/FPS during recording (baseline & zoom) using DevTools/Activity Monitor
[ ] Optimize Pixi rendering, IPC frequency, snapshot generation as needed
[ ] Test for dropped frames over long recording (aim for <= 0.5%)
[x] Implement mediaRecorder.pause() in renderer triggered by IPC
[x] Implement mediaRecorder.resume() in renderer triggered by IPC
[x] Update renderer state (isPaused) and timer logic for pause/resume
[x] Update main UI buttons (add dedicated Stop button, update Pause/Resume visibility)
[x] Modify Cmd+Shift+9 hotkey logic for Start -> Pause -> Resume cycle
[ ] Step 15: Accessibility, Error Handling, Recovery & Sandboxing
[ ] Review all UI elements (index.html, panel.html) for ARIA attributes/labels
[ ] Add aria-live regions for status updates (timer, zoom level) if possible
[ ] Manually test entire UI flow with VoiceOver
[x] Wrap critical operations in try...catch blocks (main & renderer), log errors
[x] Implement mediaRecorder.onerror handler (log, stop, notify)
[ ] Display non-modal UI warning for zoom-related performance drops
[ ] On app startup (main.js), check for leftover temp session directories
[ ] If found, use dialog.showMessageBox to prompt user for recovery attempt
[ ] If user confirms, run concatenation logic on found segments
[ ] Delete old temp directory after check/recovery attempt
[ ] Ensure nodeIntegration: false, contextIsolation: true
[ ] Verify no Node/Electron modules used directly in renderers
[ ] Call app.enableSandbox() early in main.js
[ ] Test all application features thoroughly with sandbox enabled
[ ] Step 16: Build, Notarization & Final Integration Testing
[ ] Install electron-builder
[ ] Configure build section in package.json (appId, mac target, files, category)
[ ] Configure mac.hardenedRuntime: true
[ ] Create entitlements.mac.plist with necessary entitlements (sandbox, user-selected files, bookmarks)
[ ] Configure mac.entitlements and mac.entitlementsInherit
[ ] Configure code signing (mac.identity or env vars)
[ ] Configure notarization (mac.notarize: true, use env vars for Apple ID/Password/Team ID)
[ ] Configure bundling of ffmpeg-static binary (extraResources)
[ ] Update fluent-ffmpeg path logic to use process.resourcesPath in packaged app
[ ] Implement Security Scoped Bookmarks:
[ ] Store bookmark from dialog result (app.startAccessingSecurityScopedResource)
[ ] On startup, resolve bookmark (app.resolveSecurityScopedResource)
[ ] Handle resolution failure (clear stored bookmark/path)
[ ] Manage stopAccessingSecurityScopedResource
[ ] Add build scripts (pack, dist) to package.json
[ ] Run npm run dist to build signed, notarized DMG/zip
[ ] Perform final end-to-end testing on installed DMG build, covering all spec points
