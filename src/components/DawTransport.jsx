import React, { useState } from 'react';
import { Play, Pause, Square, ZoomIn, ZoomOut, Save, FolderOpen, FilePlus, FileSpreadsheet, Upload } from 'lucide-react';
import AdrImportWizard from './AdrImportWizard';

const toSMPTE = (t, fps = 25) => {
  const safe = isFinite(t) && t >= 0 ? t : 0;
  const h  = Math.floor(safe / 3600);
  const m  = Math.floor((safe % 3600) / 60);
  const s  = Math.floor(safe % 60);
  const f  = Math.floor((safe % 1) * fps);
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;
};

const DawTransport = ({ 
  isPlaying, handleTogglePlay, handleStop,
  isRecording, handleStartProcess, 
  currentTime, duration,
  videoURL, videoFileName,
  zoomLevel, setZoomLevel,
  onSaveProject,
  onLoadProject,
  onNewProject,
  onImportCues,
  sessionRole,
  videoFrameRate = 25,
  videoStartTimeOffset = 0
}) => {
  const [showImportWizard, setShowImportWizard] = useState(false);
  // Applica l'offset del timecode iniziale al timecode visualizzato
  const displayTime = currentTime + videoStartTimeOffset;
  const tc      = toSMPTE(displayTime, videoFrameRate);
  const totalTc = toSMPTE((duration || 0) + videoStartTimeOffset, videoFrameRate);
  const isDirector = sessionRole === 'host';

  return (
    <header className="pro-transport">

      {/* LEFT: Stop + Play/Pause + Rec + Project Controls */}
      <div className="transport-left">
        <div className="transport-main-controls">
          <button
            onClick={handleStartProcess}
            className={`btn-transport btn-rec${isRecording ? ' btn-rec--active' : ''}`}
            title={isRecording ? 'Recording active — use STOP to stop' : 'Start Recording'}
            disabled={isRecording}
            style={isRecording ? { opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
          >
            <div className="rec-dot" />
          </button>
          <button
            onClick={handleStop}
            className="btn-transport btn-stop"
            title={isRecording ? 'Stop Recording' : 'Stop / Rewind (Esc)'}
          >
            <Square size={18} fill="currentColor" />
          </button>
          <button
            onClick={handleTogglePlay}
            className={`btn-transport btn-play${isPlaying ? ' btn-play--active' : ''}`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
        </div>
        
        <div className="transport-project-controls">
          {isDirector && (
            <>
              <button
                onClick={onNewProject}
                className="btn-transport btn-project"
                title="New Project"
              >
                <FilePlus size={16} />
                <span className="btn-label">NEW</span>
              </button>
              <button
                onClick={onSaveProject}
                className="btn-transport btn-project btn-save-export"
                title="Save Project (IndexedDB + JSON Export)"
              >
                <Save size={16} />
                <span className="btn-label">SALVA</span>
              </button>
              <button
                onClick={onLoadProject}
                className="btn-transport btn-project"
                title="Load Project"
              >
                <Upload size={16} />
                <span className="btn-label">CARICA</span>
              </button>
              <button
                onClick={() => setShowImportWizard(true)}
                className="btn-transport btn-project btn-import-adr"
                title="Import ADR from Excel"
              >
                <FileSpreadsheet size={16} />
                <span className="btn-label">IMPORT ADR</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* CENTER: Timecode */}
      <div className="transport-center">
        <div className="tc-display-block tc-display-block--enhanced">
          <div className="tc-smpte-label">TC {videoFrameRate}fps</div>
          <div className="tc-display">{tc}</div>
          <div className="tc-duration">/ {totalTc}</div>
        </div>
      </div>

      {/* RIGHT: Filename + Zoom */}
      <div className="transport-right">
        <div className="filename">
          {videoURL ? (videoFileName || 'SCENE_UNTITLED.mp4') : 'NO VIDEO SOURCE'}
        </div>
        <div className="zoom-controls">
          <ZoomOut size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="range"
            min="5"
            max="100"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(parseInt(e.target.value))}
            style={{ width: '100px', cursor: 'ew-resize' }}
            title={`Zoom: ${zoomLevel}px/s`}
          />
          <ZoomIn size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: '0.6rem', fontWeight: 'bold', color: 'var(--text-muted)', minWidth: '30px' }}>
            {zoomLevel}px
          </span>
        </div>
      </div>

      <AdrImportWizard 
        isOpen={showImportWizard}
        onClose={() => setShowImportWizard(false)}
        onImportCues={onImportCues}
      />

    </header>
  );
};

export default DawTransport;
