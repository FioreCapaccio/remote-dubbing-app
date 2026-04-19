import React, { useState, useEffect, useRef } from 'react';
import { Plus, Circle, Trash2, X } from 'lucide-react';
import WaveformOverlay from './WaveformOverlay';
import VintageVUMeter from './VintageVUMeter';
import { useTrackMeters } from '../hooks/useTrackMeters';

const STATUS_COLORS = {
  todo: '#8b949e',
  recording: '#f59e0b',
  done: '#00fb82',
};

const DawTimeline = ({ 
  isDraggingOver, handleDragOver, handleDragLeave, handleDrop,
  isScrubbing: isScrubbingRef, duration, sidebarWidth, zoomLevel, videoRef, setCurrentTime,
  cues, onAddCue, onUpdateCue,
  tracks, setTracks, selectedTrackId, setSelectedTrackId,
  selectedClipId, setSelectedClipId,
  draggingClip, setDraggingClip, dragStartRef,
  videoURL, currentTime, activeCue,
  internalTimeRef,
  isRecording,
  recordingSource,
  sessionRole // Aggiunto per sapere se siamo actor o director
}) => {
  const [contextMenu, setContextMenu] = useState(null); // { clipId, trackId, x, y }
  const [draggingCue, setDraggingCue] = useState(null); // { cueId, startX, startTimeIn, previewTimeIn }
  const dragCueRef = useRef(null);
  const rulerRef = useRef(null);
  const timelineRef = useRef(null);
  const touchStartRef = useRef(null);
  const lastTouchTimeRef = useRef(0);

  // Hook per monitorare i livelli audio delle tracce
  const trackLevels = useTrackMeters(tracks, videoRef, isRecording, recordingSource);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // Handle cue dragging globally
  useEffect(() => {
    if (!draggingCue) return;

    const handleMouseMove = (e) => {
      if (!rulerRef.current || !dragCueRef.current) return;
      
      const rulerRect = rulerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - rulerRect.left + rulerRef.current.scrollLeft;
      const newTimeIn = Math.max(0, relativeX / zoomLevel);
      
      // Snap to whole seconds (optional, 0.1s tolerance)
      const snapThreshold = 0.15;
      const nearestSecond = Math.round(newTimeIn);
      const snappedTimeIn = Math.abs(newTimeIn - nearestSecond) < snapThreshold 
        ? nearestSecond 
        : newTimeIn;
      
      // Clamp to duration
      const clampedTimeIn = duration > 0 ? Math.min(snappedTimeIn, duration) : snappedTimeIn;
      
      setDraggingCue(prev => ({ ...prev, previewTimeIn: clampedTimeIn }));
    };

    const handleMouseUp = () => {
      if (draggingCue && onUpdateCue && draggingCue.previewTimeIn !== undefined) {
        // Round to 3 decimal places for precision
        const finalTimeIn = Math.round(draggingCue.previewTimeIn * 1000) / 1000;
        onUpdateCue(draggingCue.cueId, 'timeIn', finalTimeIn);
      }
      setDraggingCue(null);
      dragCueRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingCue, zoomLevel, duration, onUpdateCue]);

  // Touch event handlers for mobile timeline scrubbing
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
    
    // Check if touching a button or input
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    
    // Handle timeline scrubbing on touch
    const timeline = timelineRef.current;
    if (!timeline) return;
    
    const rect = timeline.getBoundingClientRect();
    const trackX = touch.clientX - rect.left + timeline.scrollLeft - sidebarWidth;
    const maxTime = Math.max(duration > 0 ? duration : 0, 0);
    const newTime = Math.max(0, trackX / zoomLevel);
    const clampedTime = maxTime > 0 ? Math.min(newTime, maxTime) : newTime;
    
    if (videoRef.current) videoRef.current.currentTime = clampedTime;
    if (internalTimeRef) internalTimeRef.current = clampedTime;
    setCurrentTime(clampedTime);
  };

  const handleTouchMove = (e) => {
    if (!touchStartRef.current) return;
    
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    
    // If moving horizontally more than vertically and quickly, it's a scrub
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaTime < 500) {
      e.preventDefault(); // Prevent scrolling
      
      const timeline = timelineRef.current;
      if (!timeline) return;
      
      const rect = timeline.getBoundingClientRect();
      const trackX = touch.clientX - rect.left + timeline.scrollLeft - sidebarWidth;
      const maxTime = Math.max(duration > 0 ? duration : 0, 0);
      const newTime = Math.max(0, trackX / zoomLevel);
      const clampedTime = maxTime > 0 ? Math.min(newTime, maxTime) : newTime;
      
      if (videoRef.current) videoRef.current.currentTime = clampedTime;
      if (internalTimeRef) internalTimeRef.current = clampedTime;
      setCurrentTime(clampedTime);
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // Double-tap detection for adding cues on mobile
  const handleTimelineClick = (e) => {
    const now = Date.now();
    const timeDiff = now - lastTouchTimeRef.current;
    
    if (timeDiff < 300) {
      // Double tap detected - add cue at position
      const timeline = timelineRef.current;
      if (!timeline) return;
      
      const rect = timeline.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const trackX = clientX - rect.left + timeline.scrollLeft - sidebarWidth;
      const newTime = Math.max(0, trackX / zoomLevel);
      const clampedTime = duration > 0 ? Math.min(newTime, duration) : newTime;
      const roundedTime = Math.round(clampedTime * 1000) / 1000;
      
      if (videoRef.current) videoRef.current.currentTime = roundedTime;
      if (internalTimeRef) internalTimeRef.current = roundedTime;
      setCurrentTime(roundedTime);
      onAddCue(roundedTime);
    }
    
    lastTouchTimeRef.current = now;
  };

  const updateTrack = (id, field, value) => {
    console.log('[DawTimeline] updateTrack called:', { id, field, value });
    setTracks(prev => {
      const newTracks = prev.map(t => t.id === id ? { ...t, [field]: value } : t);
      console.log('[DawTimeline] Tracks updated:', newTracks.map(t => ({ id: t.id, audioSource: t.audioSource })));
      return newTracks;
    });
  };

  const addTrack = () => {
    setTracks(prev => [...prev, { 
      id: `track-${Date.now()}`, 
      name: 'NEW TRACK', 
      clips: [], 
      type: 'audio', 
      volume: 1, 
      muted: false, 
      solo: false,
      recEnabled: true, // Default REC enabled
      deletable: true // Traccia aggiuntiva, cancellabile
    }]);
  };

  const deleteTrack = (trackId) => {
    setTracks(prev => prev.filter(t => t.id !== trackId));
    if (selectedTrackId === trackId) {
      setSelectedTrackId(null);
    }
  };

  // Funzione per cancellare una clip (solo per l'attore sulla propria registrazione)
  const deleteClip = (trackId, clipId) => {
    setTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        clips: t.clips.filter(c => c.id !== clipId)
      };
    }));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
    }
    setContextMenu(null);
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
      ref={timelineRef}
      className={`timeline-daw-integrated ${isDraggingOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={handleTimelineClick}
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
        ref={rulerRef}
        className="timeline-ruler" 
        style={{ marginLeft: `${sidebarWidth}px`, width: `${Math.max(2000, duration * zoomLevel)}px` }}
        onDoubleClick={(e) => {
           // Only add cue if not clicking on a cue pin
           if (e.target.closest('.timeline-cue-pin')) return;
           e.stopPropagation();
           const timelineRect = e.currentTarget.getBoundingClientRect();
           const relativeX = e.clientX - timelineRect.left;
           const newTime = Math.max(0, relativeX / zoomLevel);
           const clampedTime = duration > 0 ? Math.min(newTime, duration) : newTime;
           const roundedTime = Math.round(clampedTime * 1000) / 1000;
           if (videoRef.current) videoRef.current.currentTime = roundedTime;
           if (internalTimeRef) internalTimeRef.current = roundedTime;
           setCurrentTime(roundedTime);
           onAddCue(roundedTime);
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
          const isDragging = draggingCue?.cueId === cue.id;
          const displayTimeIn = isDragging && draggingCue.previewTimeIn !== undefined 
            ? draggingCue.previewTimeIn 
            : cue.timeIn;
          return (
            <div
              key={cue.id}
              className={`timeline-cue-pin${isActive ? ' timeline-cue-pin--active' : ''}${isDragging ? ' timeline-cue-pin--dragging' : ''}`}
              style={{ left: `${displayTimeIn * zoomLevel}px` }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCueRef.current = cue.id;
                setDraggingCue({ 
                  cueId: cue.id, 
                  startX: e.clientX, 
                  startTimeIn: cue.timeIn,
                  previewTimeIn: cue.timeIn
                });
              }}
            >
              <div className="cue-pin-flag" style={{ background: color, color: '#000' }}>
                #{idx + 1}{cue.character ? ` ${cue.character}` : ''}
                {isDragging && (
                  <span className="cue-pin-time-preview">
                    {displayTimeIn.toFixed(2)}s
                  </span>
                )}
              </div>
              <div className="cue-pin-line" style={{ background: color }} />
            </div>
          );
        })}
        
        {/* Drag guide line */}
        {draggingCue && draggingCue.previewTimeIn !== undefined && (
          <div 
            className="cue-drag-guide"
            style={{ left: `${draggingCue.previewTimeIn * zoomLevel}px` }}
          />
        )}
      </div>

      <div className="lanes-container">
        {tracks.map(track => (
          <div key={track.id} className={`track-row ${selectedTrackId === track.id ? 'active-row' : ''}`} onClick={() => track.type !== 'video' && setSelectedTrackId(track.id)}>
            <div className="track-header-cell" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="name">{track.name}</span>
                {/* Icona delete per tracce aggiuntive (non LEAD VOCAL) */}
                {track.deletable && (
                  <button
                    className="track-delete-btn"
                    title="Delete track"
                    onClick={(e) => { e.stopPropagation(); deleteTrack(track.id); }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {/* Indicatore sorgente registrazione */}
              {isRecording && selectedTrackId === track.id && track.type === 'audio' && (
                <span 
                  className="recording-source-badge"
                  style={{ 
                    fontSize: '9px', 
                    padding: '2px 6px', 
                    borderRadius: '3px',
                    background: recordingSource === 'remote' ? '#00d4ff' : '#ff4444',
                    color: '#000',
                    fontWeight: 'bold',
                    marginLeft: '6px'
                  }}
                >
                  {recordingSource === 'remote' ? 'REMOTE' : 'LOCAL'}
                </span>
              )}
              <div className="row-controls">
                {track.type === 'audio' && (
                  <button
                    className={`rec-btn ${track.recEnabled !== false ? 'rec-on' : ''}`}
                    title={track.recEnabled !== false ? 'REC On (click to disable)' : 'REC Off (click to enable)'}
                    onClick={(e) => { e.stopPropagation(); updateTrack(track.id, 'recEnabled', track.recEnabled === false ? true : false); }}
                  >
                    <Circle size={10} fill={track.recEnabled !== false ? "#ff4444" : "transparent"} color="#ff4444" />
                  </button>
                )}
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
              {/* Volume Meter per tracce audio */}
              {track.type === 'audio' && (
                <VintageVUMeter dbLevel={trackLevels[track.id] ?? -60} trackId={track.id} />
              )}
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
                    {/* Icona delete per l'attore sulla propria registrazione */}
                    {sessionRole === 'guest' && clip.sourceType === 'local' && (
                      <button
                        className="clip-delete-btn"
                        title="Delete this recording"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteClip(track.id, clip.id);
                        }}
                      >
                        <X size={10} />
                      </button>
                    )}
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
