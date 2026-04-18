import React from 'react';
import { Play, Pause, ZoomIn, ZoomOut } from 'lucide-react';

const DawTransport = ({ 
  isPlaying, handleTogglePlay, 
  isRecording, handleStartProcess, 
  currentTime, 
  videoURL, videoFileName,
  zoomLevel, setZoomLevel 
}) => {
  const h  = Math.floor(currentTime / 3600);
  const m  = Math.floor((currentTime % 3600) / 60);
  const s  = Math.floor(currentTime % 60);
  const f  = Math.floor((currentTime % 1) * 25);
  const tc = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;

  return (
    <header className="pro-transport">
      <div className="controls">
        <button onClick={handleTogglePlay} className="btn-main-ctrl" title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
          {isPlaying ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button 
          onClick={handleStartProcess} 
          className={`btn-main-ctrl ${isRecording ? 'active-rec' : ''}`}
          title={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          <div className="rec-dot" />
        </button>
      </div>
      <div className="tc-display">{tc}</div>
      <div className="filename" style={{ flex: 1, paddingLeft: '1.5rem' }}>
        {videoURL ? (videoFileName || 'SCENE_UNTITLED.mp4') : 'NO VIDEO SOURCE'}
      </div>
      
      <div className="zoom-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '1rem' }}>
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
        <span style={{ fontSize: '0.6rem', fontWeight: 'bold', color: 'var(--text-muted)', minWidth: '30px' }}>{zoomLevel}px</span>
      </div>
    </header>
  );
};

export default DawTransport;

