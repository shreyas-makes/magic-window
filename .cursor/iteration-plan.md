Iterative Breakdown & Step Refinement

Phase 1: Foundation & Core Recording
-----------------------------------

Chunk 1.1: Basic Electron Project Setup
- Step 1.1.1: Initialize Electron project (npm init, add Electron v35 dependency)
- Step 1.1.2: Create basic main.js to open a responsive main window (80% of screen size)
- Step 1.1.3: Create basic index.html and renderer.js
- Step 1.1.4: Set up basic IPC communication (main <-> renderer)
Test Goal: App launches, shows a responsive window, basic message passing works

Chunk 1.2: Screen/Window Source Selection
- Step 1.2.1: Use desktopCapturer in the main process to get available sources (screens, windows)
- Step 1.2.2: Send source list to the renderer via IPC
- Step 1.2.3: Display sources in the renderer UI (simple list/dropdown for now)
- Step 1.2.4: Allow user selection and send chosen source ID back to main via IPC
Test Goal: App lists available sources; selecting one sends the correct ID back

Chunk 1.3: Basic Recording & Saving (No Zoom Yet)
- Step 1.3.1: In main process, use navigator.mediaDevices.getUserMedia with the selected source ID to get a MediaStream
- Step 1.3.2: Set up MediaRecorder with the stream. Configure for video only, aim for H.264 initially for simplicity, using fragmented MP4 (video/mp4; codecs=avc1). Note: HEVC/VideoToolbox might require more setup later
- Step 1.3.3: Implement basic Start/Stop recording logic
- Step 1.3.4: On dataavailable, collect Blob chunks
- Step 1.3.5: On stop, combine Blobs and save to a fixed temporary file using Node.js fs module (e.g., temp_recording.mp4)
Test Goal: Can select a source, start recording for 5s, stop, and find a valid MP4 file saved

Phase 2: UI & Basic Controls
---------------------------

Chunk 2.1: Main UI Structure & Basic Controls
- Step 2.1.1: Design basic HTML structure for controls (Source select dropdown, Start/Stop button, Status area)
- Step 2.1.2: Style the UI minimally with CSS
- Step 2.1.3: Wire up the Start/Stop button clicks to the IPC messages for recording
- Step 2.1.4: Disable/Enable controls based on recording state (e.g., disable Start when recording)
Test Goal: UI reflects recording state; buttons trigger recording actions correctly

Chunk 2.2: Hotkey Implementation
- Step 2.2.1: Use Electron's globalShortcut in the main process to register CommandOrControl+Shift+9
- Step 2.2.2: Implement logic for the hotkey to toggle Start/Stop recording (or later, Start/Pause/Resume/Stop). Track recording state in the main process
- Step 2.2.3: Ensure hotkey updates the UI state via IPC
Test Goal: Hotkey starts/stops recording; UI updates accordingly

Chunk 2.3: Status Display (Timer & Placeholder Disk)
- Step 2.3.1: Implement a live timer in the renderer UI that starts/stops/pauses with recording
- Step 2.3.2: Add a placeholder UI element for the disk space bar (logic comes later)
Test Goal: Timer accurately reflects recording duration and state

Chunk 2.4: Save Location Preference
- Step 2.4.1: Add a "Choose Save Folder" button/setting in the UI
- Step 2.4.2: Use Electron's dialog.showOpenDialog in the main process (triggered via IPC) to allow folder selection
- Step 2.4.3: Store the chosen path persistently (e.g., using electron-store). Default to ~/Movies
- Step 2.4.4: Update the saving logic (Step 1.3.5) to use the chosen folder
Test Goal: Can select a custom save folder; recordings are saved there. Setting persists across app restarts

Phase 3: Storage Management
--------------------------

Chunk 3.1: File Naming & Directory Structure
- Step 3.1.1: Implement the specified file naming convention: Magic Window Recording - YYYY-MM-DD at HH.MM.SS.mp4
- Step 3.1.2: Implement the directory structure: [Chosen Base Path]/Magic Window/YYYY-MM/. Ensure directories are created if they don't exist
- Step 3.1.3: Update the saving logic to use the new naming and structure
Test Goal: Recordings are saved with the correct name in the correct directory structure

Chunk 3.2: Segmented Recording
- Step 3.2.1: Modify MediaRecorder setup: use timeslice parameter (e.g., recorder.start(1000 * 60 * 10)) to trigger dataavailable every 10 minutes
- Step 3.2.2: Create a temporary directory for the current recording session
- Step 3.2.3: Save each Blob chunk received from dataavailable as a separate temporary segment file within the session directory (e.g., segment_0.mp4, segment_1.mp4)
Test Goal: During a >10min recording, multiple segment files are created in a temporary location

Chunk 3.3: Post-Recording Concatenation & Cleanup
- Step 3.3.1: On recording stop, identify all segment files for the session
- Step 3.3.2: Use ffmpeg (likely requiring bundling a static build or using fluent-ffmpeg with user-provided ffmpeg) to concatenate the segments into the final MP4 file (using the naming/structure from 3.1). Crucial: Use a safe concat method for fragmented MP4
- Step 3.3.3: After successful concatenation, delete the temporary segment files and the temporary session directory
Test Goal: After stopping a >10min recording, a single final MP4 is created, and temporary files are removed

Chunk 3.4: Disk Space Monitoring & Warning
- Step 3.4.1: Periodically check available disk space on the target save volume during recording (e.g., using Node.js fs or a library like check-disk-space)
- Step 3.4.2: If space drops below 2GB, display a persistent warning in the UI
- Step 3.4.3: (Optional but recommended) If disk space becomes critically low (e.g., <100MB), automatically stop the recording gracefully and attempt concatenation
Test Goal: Warning appears when disk space is low; recording stops if critically low

Phase 4: Zoom Engine (WebGL)
---------------------------

Chunk 4.1: WebGL Canvas Setup & Frame Rendering
- Step 4.1.1: Add a <canvas> element to index.html
- Step 4.1.2: Integrate a WebGL library (e.g., Pixi.js is often simpler for 2D manipulation)
- Step 4.1.3: Instead of directly using the MediaStream for MediaRecorder, pipe the video track to an offscreen <video> element
- Step 4.1.4: In the render loop (requestAnimationFrame), draw the current frame from the <video> element onto the WebGL canvas using the chosen library (e.g., as a PIXI.Sprite using PIXI.Texture.from(videoElement))
- Step 4.1.5: Capture the output stream from the canvas (canvas.captureStream(60)) and feed this stream to MediaRecorder
Test Goal: App records the content displayed on the WebGL canvas, which mirrors the selected screen/window, at 4K/60FPS. Performance should be acceptable

Chunk 4.2: Basic Digital Zoom Implementation
- Step 4.2.1: Define state variables for zoom level (default 1.0) and zoom center (default center of canvas)
- Step 4.2.2: In the WebGL render loop, apply scaling and translation transformations to the sprite/texture based on the zoom level and center. Ensure the output canvas size remains 4K
- Step 4.2.3: Implement basic bilinear filtering (often default in WebGL libraries)
Test Goal: Can programmatically set a zoom level (e.g., 2.0); the recorded output shows the zoomed content correctly

Chunk 4.3: Advanced Filtering & Performance
- Step 4.3.1: Implement logic to switch filtering: Bilinear for zoom < 2x, Lanczos for zoom ≥ 2x. Note: Lanczos might require custom shaders or a library that supports it. If too complex, stick to bilinear or highest available default first
- Step 4.3.2: (Optional) Implement FXAA as a post-processing shader pass if needed and performance allows
- Step 4.3.3: Implement basic performance monitoring: track FPS (using requestAnimationFrame timing) and log warnings if dropping below ~59 FPS, especially during zoom changes. Monitor CPU/GPU usage manually using Activity Monitor initially
Test Goal: Filtering changes based on zoom level (visual inspection/shader verification). Performance warnings are logged if FPS drops

Chunk 4.4: Smooth Zoom Transitions
- Step 4.4.1: Implement an animation function (e.g., using requestAnimationFrame or a tweening library) to smoothly interpolate the zoom level and center position from current values to target values over a short duration (e.g., 200-300ms)
- Step 4.4.2: Update the WebGL transformations on each frame of the animation
Test Goal: Changing zoom levels results in a smooth visual transition, not an abrupt jump

Phase 5: Zoom UI & Interaction
-----------------------------

Chunk 5.1: Floating Control Panel UI
- Step 5.1.1: Create a new, small, borderless BrowserWindow in the main process to act as the floating panel. Make it always-on-top
- Step 5.1.2: Design the HTML/CSS for the panel: Zoom indicator ("1.0x"), Zoom In/Out buttons, PiP toggle button, Collapse button
- Step 5.1.3: Implement IPC between the main recording window and the floating panel window
- Step 5.1.4: Show the panel only when recording starts; hide it when recording stops
- Step 5.1.5: Implement collapse functionality (e.g., reduce window size to show only an icon)
Test Goal: Floating panel appears/disappears with recording state; basic UI elements exist; collapse works

Chunk 5.2: Zoom Control Wiring
- Step 5.2.1: Wire up Zoom In/Out buttons on the floating panel to trigger zoom changes (using the smooth transition logic from 4.4). Update the zoom level indicator text
- Step 5.2.2: Implement keyboard shortcuts (⌘+, ⌘-) in the main recording window (using webContents.sendInputEvent or similar if focus is tricky, or ensure global shortcuts work) to trigger the same zoom actions
- Step 5.2.3: Implement modifier key + mouse wheel zoom (e.g., capture wheel event in renderer, check for ⌘ key, trigger zoom)
- Step 5.2.4: Implement preset zoom levels (1x, 1.5x, 2x, 4x) potentially via extra buttons or shortcuts
Test Goal: Buttons, shortcuts, and mouse wheel correctly control the zoom level smoothly; indicator updates

Chunk 5.3: PiP Navigator
- Step 5.3.1: Add a smaller canvas/display area within the floating control panel UI for the PiP
- Step 5.3.2: Render a downscaled version of the original, unzoomed 4K frame into the PiP area
- Step 5.3.3: Draw a rectangle on the PiP representing the current zoomed viewport
- Step 5.3.4: Implement click-and-drag functionality within the PiP: calculate the corresponding center position in the main 4K canvas based on the drag action and update the zoom center (with smooth transition)
- Step 5.3.5: Wire up the PiP toggle button/shortcut (⌘0)
Test Goal: PiP shows the full view with zoom rectangle; clicking/dragging in PiP moves the main zoom area; toggle works

Chunk 5.4: "Magic Window" Border Effect
- Step 5.4.1: In the main WebGL canvas rendering logic (Step 4.1.4), add logic to draw borders
- Step 5.4.2: Draw an outer border representing the original capture boundary
- Step 5.4.3: Draw an inner border representing the zoomed area boundary. This border should pulse
- Step 5.4.4: Apply the specified gradient (orange/coral → pink → purple) to the borders, possibly using shaders for smooth gradients and pulsing effects. Apply the same effect to the PiP navigator's border
Test Goal: Visual borders appear correctly, matching zoom area and original bounds, with pulsing gradient effect on both main view and PiP

Phase 6: Integration, Polishing & Deployment
------------------------------------------

Chunk 6.1: HEVC & Performance Optimization
- Step 6.1.1: Revisit MediaRecorder setup (Step 1.3.2 / 4.1.5). Attempt to configure HEVC codec (video/mp4; codecs=hvc1 or hevc) and explicitly request hardware acceleration (VideoToolbox). This might involve checking MediaRecorder.isTypeSupported and potentially platform-specific flags or even native Node modules if Electron's implementation is insufficient
- Step 6.1.2: Profile performance rigorously (CPU ≤30% baseline, ≤40% with zoom; GPU ≤30% zoom; RAM +≤500MB zoom) on an M1 Pro. Optimize WebGL rendering, IPC communication, and encoding settings
- Step 6.1.3: Test dropped frames over a 2-hour recording (aim for ≤0.5%). Implement dropped frame detection if MediaRecorder stats provide it, or analyze output files
Test Goal: Recording uses HEVC via VideoToolbox; performance targets are met; dropped frames are minimal

Chunk 6.2: Pause/Resume Functionality
- Step 6.2.1: Implement MediaRecorder.pause() and MediaRecorder.resume() logic
- Step 6.2.2: Update UI controls and hotkey logic to handle Pause/Resume states
- Step 6.2.3: Ensure timer pauses correctly
- Step 6.2.4: Test concatenation with paused segments. Ensure audio/video sync is maintained if audio is added later
Test Goal: Pause/Resume works correctly via UI and hotkey; final video is coherent

Chunk 6.3: Accessibility (VoiceOver)
- Step 6.3.1: Review all UI controls (buttons, dropdowns, status indicators). Ensure they have proper ARIA attributes and labels for VoiceOver compatibility
- Step 6.3.2: Test navigation and control using VoiceOver
Test Goal: All controls are navigable and announce their purpose correctly with VoiceOver

Chunk 6.4: Error Handling & Recovery
- Step 6.4.1: Implement robust error handling around file system operations, MediaRecorder events (onerror), WebGL errors, and IPC. Log errors to a file
- Step 6.4.2: Implement zoom performance warnings (Step 4.3.3)
- Step 6.4.3: Implement basic recovery: If the app crashes, on next launch, check for leftover temporary segment directories. Offer the user the option to attempt concatenation of existing segments
Test Goal: App handles common errors gracefully; recovery option works for simulated crashes

Chunk 6.5: Sandboxing & Notarization Prep
- Step 6.5.1: Configure Electron's sandbox mode (app.enableSandbox()). Ensure all Node.js APIs used in the renderer are exposed safely via the preload script. Refactor if needed. Critical: File system access from renderer needs careful handling via main process IPC
- Step 6.5.2: Disable all outbound network calls (review dependencies, configure network filters if necessary)
- Step 6.5.3: Set up electron-builder or electron-forge for macOS builds (.dmg, .zip)
- Step 6.5.4: Configure code signing and notarization requirements (Apple Developer ID, electron-notarize)
Test Goal: App runs correctly sandboxed. Build process is configured for signing and notarization

Chunk 6.6: Final Testing & Build
- Step 6.6.1: Perform all tests outlined in the specification (Zoom, Storage, Integration)
- Step 6.6.2: Test on multiple monitor configurations
- Step 6.6.3: Test across different (recent) macOS versions
- Step 6.6.4: Build, sign, and notarize the application
Test Goal: All specification tests pass; final distributable app is created and notarized