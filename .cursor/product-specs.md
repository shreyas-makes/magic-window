# Magic Window Screen Recorder - Specification Document

## 1. Core MVP Requirements

### 1.1 Basic Recording Functionality
- Notarized macOS Electron 35 app
- Responsive window sizing (80% of screen dimensions)
- 4K 60 FPS capture with unlimited duration
- Fragmented MP4 local storage
- CPU usage ≤30% on M1 Pro with VideoToolbox HEVC
- Dropped frames ≤0.5% over two hours
- Sandboxed application with no outbound network calls
- VoiceOver-ready controls

### 1.2 Recording Controls
- Select full display or window (multi-monitor)
- Start · Pause · Resume · Stop with ⌘⇧9 hotkey
- User-chosen save folder (default: Movies)
- Live timer + disk-space bar

## 2. Zoom Functionality

### 2.1 Zoom Controls
- Minimalist floating control panel appearing during recording
- Collapsible to small icon when not in use
- Zoom level indicator showing numerical value (e.g., "2x")
- Keyboard shortcuts: ⌘+ (zoom in), ⌘- (zoom out)
- PiP navigator toggle with ⌘0
- Mouse wheel zoom with modifier key (⌘+scroll)
- Preset zoom levels: 1x, 1.5x, 2x, 4x
- Available before and during recording

### 2.2 Zoom Visual Effects
- "Magic Window" pulsing border with gradient (orange/coral → pink → purple)
- Border adapts to show both zoomed area and original boundaries
- Smooth, gradual transitions between zoom levels
- PiP navigator in corner with matching gradient border effect
- PiP allows click-and-drag to change zoomed area

### 2.3 Technical Implementation
- Digital zoom within captured 4K content (simpler approach)
- Maintain full 4K 60FPS quality during all zoom operations
- WebGL-based rendering using Three.js or Pixi.js
- Bilinear filtering for zoom <2x; Lanczos resampling for ≥2x
- Optional FXAA for edge smoothing based on performance
- Resource limits:
  - CPU: ≤40% on M1 Pro
  - GPU: ≤30% utilization 
  - RAM: Additional 500MB maximum over baseline
  - Maintain ≤0.5% dropped frames during zoom transitions

### 2.4 Error Handling
- Log all zoom-related errors
- Display warning notifications when zoom affects performance
- Performance monitoring during zoom operations

## 3. Storage Organization

### 3.1 File Structure
- File naming: "Magic Window Recording - YYYY-MM-DD at HH.MM.SS.mp4"
- Default location: ~/Movies/Magic Window/YYYY-MM/
- Customizable base save path in settings
- JSON sidecar files with recording metadata

### 3.2 Storage Management
- Low disk space warning at fixed 2GB threshold
- Temp folder for active recording segments
- Auto-cleanup of temp files on successful completion
- Recovery option for interrupted recordings

### 3.3 File Handling
- 10-minute segment rolls for unlimited duration
- Auto-concatenation of segments after recording completion

## 4. Testing Requirements

### 4.1 Zoom Functionality Testing
- Validate all zoom presets for visual quality
- Measure frame rate during transitions (≥59.5 FPS)
- Test keyboard shortcuts under various system loads
- Verify PiP navigator accuracy
- Test multiple monitor configurations
- Validate border appearance at different zoom levels
- Stress test rapid zoom changes
- Monitor resource usage during extended zoom

### 4.2 Storage Testing
- Verify segment rolling during 8+ hour recording
- Test low disk space warning at 2GB threshold
- Validate segment auto-concatenation
- Measure write speeds during segment transitions
- Simulate disk full scenarios
- Test metadata generation and file structure
- Validate recovery from unexpected termination

### 4.3 Integration Testing
- Test zoom during pause/resume
- Verify recording quality with zoom at 4K 60FPS
- Test across different macOS versions
- Validate behavior with multiple applications running

## 5. Future Considerations
- Post-processing option to modify/remove zoom effects
- Basic video editing functionality:
  - Clip trimming and splitting
  - Rearranging video segments
  - Cut, copy, paste operations
  - Timeline-based editing interface
  - Transition effects between clips
  - Ability to combine multiple recordings
  - Export in various formats and resolutions
- Additional overlays and features to be added in future versions
