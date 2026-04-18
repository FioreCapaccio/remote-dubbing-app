import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import WaveformOverlay from './WaveformOverlay';

const STATUS_COLORS = {
  todo: '#8b949e',
  recording: '#f59e0b',
  done: '#00fb82',
};

const DawTimeline = ({ 
  isDraggingOver, handleDragOver, handleDragLeave, handleDrop,
  isScrubbing: isScrubbingRef, duration, sidebarWidth, zoomLevel, videoRef, setCurrentTime,
  cues, onAddCue,
  tracks, setTracks, selectedTrackId, setSelectedTrackId,
  selectedClipId, setSelectedClipId,
  draggingClip, setDraggingClip, dragStartRef,
  videoURL, currentTime, activeCue,
  internalTimeRef
}) => {
  const [contextMenu, setContextMenu] = useState(null); // { clipId, trackId, x, y }

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

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

  const handleSplitClip = (trackId, clip) => {
    const splitPoint = currentTime;
    if (splitPoint <= clip.startTime + 0.01 || splitPoint >= clip.startTime + clip.duration - 0.01) {
      setContextMenu(null);
      return;
    }
    const firstDuration = splitPoint - clip.startTime;
    const secondDuration = clip.duration - firstDuration;
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const idx = t.clips.findIndex(c => c.id === clip.id);
      if (idx === -1) return t;
      const newClips = [...t.clips];
      newClips.splice(idx, 1,
        { ...clip, duration: firstDuration },
        { ...clip, id: `${clip.id}-s${Date.now()}`, startTime: splitPoint, duration: secondDuration, mediaOffset: (clip.mediaOffset || 0) + firstDuration }
      );
      return { ...t, clips: newClips };
    }));
    setContextMenu(null);
  };

  // Resolve context menu clip/track from current state
  const ctxTrack = contextMenu ? tracks.find(t => t.id === contextMenu.trackId) : null;
  const ctxClip  = ctxTrack ? ctxTrack.clips.find(c => c.id === contextMenu.clipId) : null;

  return (
    <section 
      className={`timeline-daw-integrated ${isDraggingOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseDown={(e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.button !== 0) return;
        e.preventDefault();
        isScrubbingRef.current = true;
        
        const timeline = e.currentTarget;
        const rect = timeline.getBoundingClientRect();
        const trackX = e.clientX - rect.left + timeline.scrollLeft - sidebarWidth;
        const maxTime = Math.max(duration > 0 ? duration : 0, 0);
        const newTime = Math.max(0, trackX / zoomLevel);
        const clampedTime = maxTime > 0 ? Math.min(newTime, maxTime) : newTime;
        
        if (videoRef.current) videoRef.current.currentTime = clampedTime;
        if (internalTimeRef) internalTimeRef.current = clampedTime;
        setCurrentTime(clampedTime);
      }}
    >
      <div 
        className="timeline-ruler" 
        style={{ marginLeft: `${sidebarWidth}px`, width: `${Math.max(2000, duration * zoomLevel)}px` }}
        onDoubleClick={(e) => {
           e.stopPropagation();
           const timelineRect = e.currentTarget.getBoundingClientRect();
           const relativeX = e.clientX - timelineRect.left;
           const newTime = Math.max(0, relativeX / zoomLevel);
           const clampedTime = duration > 0 ? Math.min(newTime, duration) : newTime;
           if (videoRef.current) videoRef.current.currentTime = clampedTime;
           if (internalTimeRef) internalTimeRef.current = clampedTime;
           setCurrentTime(clampedTime);
           onAddCue(clampedTime);
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
        
        {/* Timeline Cue Pins */}
        {cues.map((cue, idx) => {
          const color = STATUS_COLORS[cue.status] || '#8b949e';
          const isActive = activeCue?.id === cue.id;
          return (
            <div
              key={cue.id}
              className={`timeline-cue-pin${isActive ? ' timeline-cue-pin--active' : ''}`}
              style={{ left: `${cue.timeIn * zoomLevel}px` }}
            >
              <div className="cue-pin-flag" style={{ background: color, color: '#000' }}>
                #{idx + 1}{cue.character ? ` ${cue.character}` : ''}
              </div>
              <div className="cue-pin-line" style={{ background: color }} />
            </div>
          );
        })}
      </div>

      <div className="lanes-container">
        {tracks.map(track => (
          <div key={track.id} className={`track-row ${selectedTrackId === track.id ? 'active-row' : ''}`} onClick={() => track.type !== 'video' && setSelectedTrackId(track.id)}>
            <div className="track-header-cell" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
              <span className="name">{track.name}</span>
              <div className="row-controls">
                <button
                  className={track.muted ? 'm-on' : ''}
                  title={track.muted ? 'Unmute' : 'Mute'}
                  onClick={(e) => { e.stopPropagation(); updateTrack(track.id, 'muted', !track.muted); }}
                >M</button>
                <button
                  className={track.solo ? 's-on' : ''}
                  title={track.solo ? 'Unsolo' : 'Solo'}
                  onClick={(e) => { e.stopPropagation(); updateTrack(track.id, 'solo', !track.solo); }}
                >S</button>
                <span className="vol-pct" onClick={e => e.stopPropagation()}>{Math.round(track.volume * 100)}%</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.01"
                value={track.volume}
                title={`Volume: ${Math.round(track.volume * 100)}%`}
                onChange={(e) => { e.stopPropagation(); updateTrack(track.id, 'volume', parseFloat(e.target.value)); }}
                onMouseDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="track-lane-cell">
              {track.type === 'video' && videoURL && duration > 0 && (
                <div className="clip-item" style={{ left: 0, width: `${duration * zoomLevel}px` }}>
                   <div className="clip-label">ORIGINAL AUDIO</div>
                   <WaveformOverlay url={videoURL} mini color="#94a3b8" height={90} pxPerSec={zoomLevel} />
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ clipId: clip.id, trackId: track.id, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <div className="clip-label">
                      {clip.id.slice(-4)}
                      {clip.gain != null && clip.gain !== 1 && (
                        <span className="clip-gain-badge">{Math.round(clip.gain * 100)}%</span>
                      )}
                    </div>
                    <audio id={clip.id} src={clip.url} preload="auto" style={{ display: 'none' }} />
                    <WaveformOverlay url={clip.url} mini color="var(--accent)" height={90} pxPerSec={zoomLevel} />
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
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); isScrubbingRef.current = true; }} 
        />
      </div>

      {/* Clip Context Menu */}
      {contextMenu && ctxClip && (
        <div
          className="clip-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="context-menu-header">CLIP SETTINGS</div>
          <div className="context-menu-item">
            <label>GAIN: {Math.round((ctxClip.gain ?? 1) * 100)}%</label>
            <input
              type="range" min="0" max="1.5" step="0.01"
              value={ctxClip.gain ?? 1}
              onChange={(e) => {
                const g = parseFloat(e.target.value);
                setTracks(prev => prev.map(t => t.id === contextMenu.trackId ? {
                  ...t,
                  clips: t.clips.map(c => c.id === contextMenu.clipId ? { ...c, gain: g } : c)
                } : t));
              }}
              onMouseDown={e => e.stopPropagation()}
            />
          </div>
          <button
            className="context-menu-btn"
            onClick={() => handleSplitClip(contextMenu.trackId, ctxClip)}
          >
            SPLIT AT PLAYHEAD
          </button>
          <button
            className="context-menu-btn context-menu-btn--close"
            onClick={() => setContextMenu(null)}
          >
            CLOSE
          </button>
        </div>
      )}
    </section>
  );
};

export default DawTimeline;
