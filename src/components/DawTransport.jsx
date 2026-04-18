import React from 'react';
import { Play, Pause, Square, ZoomIn, ZoomOut } from 'lucide-react';

const toSMPTE = (t) => {
  const safe = isFinite(t) && t >= 0 ? t : 0;
  const h  = Math.floor(safe / 3600);
  const m  = Math.floor((safe % 3600) / 60);
  const s  = Math.floor(safe % 60);
  const f  = Math.floor((safe % 1) * 25);
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;
};

const DawTransport = ({ 
  isPlaying, handleTogglePlay, handleStop,
  isRecording, handleStartProcess, 
  currentTime, duration,
  videoURL, videoFileName,
  zoomLevel, setZoomLevel 
}) => {
  const tc      = toSMPTE(currentTime);
  const totalTc = toSMPTE(duration || 0);

  return (
    <header className="pro-transport">

      {/* LEFT: Stop + Play/Pause + Rec */}
      <div className="transport-left">
        <button
          onClick={handleStop}
          className="btn-transport btn-stop"
          title="Stop (Esc)"
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
        <button
          onClick={handleStartProcess}
          className={`btn-transport btn-rec${isRecording ? ' btn-rec--active' : ''}`}
          title={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          <div className="rec-dot" />
        </button>
      </div>

      {/* CENTER: Timecode */}
      <div className="transport-center">
        <div className="tc-display-block">
          <div className="tc-smpte-label">TC 25fps</div>
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

    </header>
  );
};

export default DawTransport;
