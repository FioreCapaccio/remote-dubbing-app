import React from 'react';
import { Type, Plus } from 'lucide-react';
import WaveformOverlay from './WaveformOverlay';

const DawTimeline = ({ 
  isDraggingOver, handleDragOver, handleDragLeave, handleDrop,
  isScrubbing, duration, sidebarWidth, zoomLevel, videoRef, setCurrentTime,
  adrMarkers, setAdrMarkers,
  tracks, setTracks, selectedTrackId, setSelectedTrackId,
  selectedClipId, setSelectedClipId,
  draggingClip, setDraggingClip, dragStartRef,
  videoURL, currentTime
}) => {
  const updateTrack = (id, field, value) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const addTrack = () => {
    setTracks(prev => [...prev, { 
      id: `track-${Date.now()}`, 
      name: 'NEW TRACK', 
      clips: [], 
      type: 'audio', 
      volume: 1, 
      muted: false, 
      solo: false 
    }]);
  };

  return (
    <section 
      className={`timeline-daw-integrated ${isDraggingOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseDown={(e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.button !== 0) return;
        e.preventDefault();
        isScrubbing.current = true;
        
        const timeline = e.currentTarget;
        const rect = timeline.getBoundingClientRect();
        const trackX = e.clientX - rect.left + timeline.scrollLeft - sidebarWidth;
        const newTime = Math.max(0, Math.min(trackX / zoomLevel, Math.max(0, duration)));
        
        if (videoRef.current) {
           videoRef.current.currentTime = newTime;
           setCurrentTime(newTime);
        }
      }}
    >
      <div 
        className="timeline-ruler" 
        style={{ marginLeft: `${sidebarWidth}px`, width: `${Math.max(2000, duration * zoomLevel)}px` }}
        onDoubleClick={(e) => {
           e.stopPropagation();
           const timelineRect = e.currentTarget.getBoundingClientRect();
           const relativeX = e.clientX - timelineRect.left;
           const newTime = Math.max(0, Math.min(relativeX / zoomLevel, duration));
           if (videoRef.current) {
              videoRef.current.currentTime = newTime;
              setCurrentTime(newTime);
           }
           const newMarker = { id: Date.now(), time: newTime, text: '' };
           setAdrMarkers([...adrMarkers, newMarker].sort((a,b) => a.time - b.time));
        }}
      >
        {Array.from({ length: Math.ceil((duration || 0) / 5) + 4 }).map((_, i) => {
          const secs = i * 5;
          return (
            <div 
              key={i} 
              className="ruler-mark major"
              style={{ position: 'absolute', left: `${secs * zoomLevel}px`, borderLeft: '1px solid rgba(255,255,255,0.15)', padding: '4px 6px' }}
            >
              {`${Math.floor(secs/60)}:${(secs%60).toString().padStart(2,'0')}`}
            </div>
          );
        })}
        
        {/* Timeline ADR Pins */}
        {adrMarkers.map(m => (
          <div key={m.id} className="timeline-adr-pin" style={{ left: `${m.time * zoomLevel}px` }}>
            <div className="pin-head"><Type size={8} /></div>
            {m.text && <div className="pin-text">{m.text}</div>}
          </div>
        ))}
      </div>

      <div className="lanes-container">
        {tracks.map(track => (
          <div key={track.id} className={`track-row ${selectedTrackId === track.id ? 'active-row' : ''}`} onClick={() => track.type !== 'video' && setSelectedTrackId(track.id)}>
            <div className="track-header-cell" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
              <span className="name">{track.name}</span>
              <div className="row-controls">
                <button className={track.muted ? 'm-on' : ''} onClick={(e) => { e.stopPropagation(); updateTrack(track.id, 'muted', !track.muted); }}>M</button>
                <button className={track.solo ? 's-on' : ''} onClick={(e) => { e.stopPropagation(); updateTrack(track.id, 'solo', !track.solo); }}>S</button>
              </div>
              <input type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(e) => updateTrack(track.id, 'volume', parseFloat(e.target.value))} onClick={e => e.stopPropagation()} />
            </div>
            <div className="track-lane-cell">
              {track.type === 'video' && videoURL && duration > 0 && (
                <div className="clip-item" style={{ left: 0, width: `${duration * zoomLevel}px` }}>
                   <div className="clip-label">ORIGINAL AUDIO</div>
                   <WaveformOverlay url={videoURL} mini color="#94a3b8" height={90} />
                </div>
              )}
              {track.clips?.map(clip => (
                  <div 
                    key={clip.id} 
                    className={`clip-item ${draggingClip === clip.id ? 'dragging' : ''} ${selectedClipId === clip.id ? 'selected-clip' : ''}`}
                    style={{ 
                      left: `${(clip.startTime || 0) * zoomLevel}px`, 
                      width: `${(clip.duration || 5) * zoomLevel}px` 
                    }}
                    onMouseDown={(e) => { 
                       e.preventDefault();
                       e.stopPropagation(); 
                       setSelectedClipId(clip.id);
                       setDraggingClip(clip.id); 
                       dragStartRef.current = { 
                          clipId: clip.id,
                          trackId: track.id,
                          startX: e.clientX, 
                          clipStartTime: clip.startTime 
                       };
                    }}
                  >
                    <div className="clip-label">{clip.id.slice(-4)}</div>
                    <audio id={clip.id} src={clip.url} preload="auto" style={{ display: 'none' }} />
                    <WaveformOverlay url={clip.url} mini color="var(--accent)" height={90} />
                  </div>
              ))}
            </div>
          </div>
        ))}
        <button className="add-row-btn" onClick={addTrack}>
          <Plus size={14} /> ADD TRACK
        </button>
      </div>
      <div className="global-playhead" style={{ left: `${sidebarWidth + currentTime * zoomLevel}px` }}>
        <div 
          className="playhead-handle" 
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); isScrubbing.current = true; }} 
        />
      </div>
    </section>
  );
};

export default DawTimeline;
