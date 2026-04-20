import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Video, RefreshCw, PinOff, Pin } from 'lucide-react';

const VideoPreview = ({ 
  videoHeight, videoURL, videoRef, 
  setCurrentTime, setDuration, 
  currentTime, activeCue, cues,
  countdown,
  setVideoURL,
  setVideoFrameRate,
  setVideoStartTimeOffset,
  videoStartTimeOffset = 0,
  videoFrameRate = 25
}) => {
  const fileInputRef = useRef(null);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const [localActiveCue, setLocalActiveCue] = useState(null);

  // Float/dock state
  const [isFloating, setIsFloating] = useState(false);
  const [floatPos, setFloatPos] = useState({ x: 80, y: 80 });
  const [floatSize, setFloatSize] = useState({ w: 420, h: 260 });
  const floatRef = useRef(null);

  // Dragging state refs (avoid re-renders during drag)
  const dragState = useRef(null);

  // Compute active cue locally using RAF for exact timing (fixes delay)
  useEffect(() => {
    let rafId;
    const checkActiveCue = () => {
      const exactTime = videoRef.current?.currentTime ?? currentTime;
      // Find active cue based on exact video time
      const cue = cues?.find(c => {
        const end = c.timeOut != null ? c.timeOut : c.timeIn + 3;
        return exactTime >= c.timeIn && exactTime < end;
      }) || null;
      setLocalActiveCue(cue);
      rafId = requestAnimationFrame(checkActiveCue);
    };
    rafId = requestAnimationFrame(checkActiveCue);
    return () => cancelAnimationFrame(rafId);
  }, [cues, currentTime, videoRef]);

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    setVideoURL(url, file.name);
    
    // Resetta l'offset del timecode quando si carica un nuovo video
    if (setVideoStartTimeOffset) {
      setVideoStartTimeOffset(0);
    }
    
    // Rileva il frame rate del video e il timecode iniziale
    const tempVideo = document.createElement('video');
    tempVideo.src = url;
    tempVideo.onloadedmetadata = () => {
      // Prova a ottenere il frame rate dalle proprietà del video
      let fps = 25; // Default
      
      // Metodo 1: Usa getVideoPlaybackQuality se disponibile
      if (tempVideo.getVideoPlaybackQuality) {
        const quality = tempVideo.getVideoPlaybackQuality();
        // Non dà direttamente il fps, ma possiamo usarlo per altre metriche
      }
      
      // Metodo 2: Calcola dal frame rate del video (proprietà non standard ma supportata in alcuni browser)
      if (tempVideo.videoPlaybackRate) {
        // Questo è il playback rate, non il frame rate
      }
      
      // Metodo 3: Prova a leggere dal file video stesso usando il video track (API moderne)
      if (tempVideo.captureStream) {
        try {
          const stream = tempVideo.captureStream();
          const videoTracks = stream.getVideoTracks();
          if (videoTracks.length > 0) {
            const settings = videoTracks[0].getSettings();
            if (settings.frameRate) {
              fps = Math.round(settings.frameRate);
            }
          }
        } catch (e) {
          // Fallback
        }
      }
      
      // Metodo 4: Per file locali, proviamo a stimare dal tempo
      // Questo è un fallback che usa il frame rate standard in base alla durata
      if (fps === 25 && file.name) {
        // Estrai informazioni dal nome file se contiene fps
        const fpsMatch = file.name.match(/(\d+)fps/i);
        if (fpsMatch) {
          fps = parseInt(fpsMatch[1], 10);
        }
      }
      
      console.log('[VideoPreview] Detected frame rate:', fps);
      if (setVideoFrameRate) {
        setVideoFrameRate(fps);
      }
      
      // Prova a estrarre il timecode iniziale dai metadata del video
      // Usa l'API VideoTrack per ottenere informazioni sul timecode
      extractStartTimecode(url, fps);
      
      // Cleanup
      tempVideo.src = '';
    };
  };
  
  // Funzione per estrarre il timecode iniziale dal video
  const extractStartTimecode = (videoUrl, fps) => {
    // Per i file video professionali (MXF, ProRes, etc.), il timecode iniziale
    // può essere nei metadata. Proviamo diversi approcci.
    
    // Approccio 1: Usa l'API MediaSource se disponibile
    if (window.MediaSource) {
      fetch(videoUrl)
        .then(response => response.arrayBuffer())
        .then(buffer => {
          // Cerca il timecode nei primi 64KB del file
          const uint8 = new Uint8Array(buffer.slice(0, 65536));
          
          // Pattern comuni per timecode in vari formati video
          // MXF: cerco pattern 'PartitionPack' o timecode pack
          // MP4/MOV: cerco 'tmcd' track o 'timecode' box
          
          // Converti in stringa per cercare pattern
          const headerStr = Array.from(uint8.slice(0, 1000))
            .map(b => String.fromCharCode(b))
            .join('');
          
          // Cerca pattern timecode in formato HH:MM:SS:FF
          const tcPattern = /(\d{2}):(\d{2}):(\d{2})[:;](\d{2})/;
          const match = headerStr.match(tcPattern);
          
          if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = parseInt(match[3], 10);
            const frames = parseInt(match[4], 10);
            
            // Converti in secondi
            const offsetSeconds = hours * 3600 + minutes * 60 + seconds + (frames / fps);
            
            console.log('[VideoPreview] Found start timecode in metadata:', match[0], '=', offsetSeconds, 'seconds');
            if (setVideoStartTimeOffset) {
              setVideoStartTimeOffset(offsetSeconds);
            }
          } else {
            console.log('[VideoPreview] No start timecode found in metadata');
          }
        })
        .catch(err => {
          console.log('[VideoPreview] Could not extract timecode metadata:', err);
        });
    }
  };

  const formatTC = (t) => {
    const displayTime = t + videoStartTimeOffset;
    const h = Math.floor(displayTime / 3600);
    const m = Math.floor((displayTime % 3600) / 60);
    const s = Math.floor(displayTime % 60);
    const f = Math.floor((displayTime % 1) * videoFrameRate);
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;
  };

  // ── Drag logic for floating window header ──────────────────────────────────
  const handleHeaderMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: floatPos.x,
      origY: floatPos.y,
    };

    const onMouseMove = (ev) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      setFloatPos({
        x: Math.max(0, dragState.current.origX + dx),
        y: Math.max(0, dragState.current.origY + dy),
      });
    };

    const onMouseUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [floatPos]);

  // Inner video content (shared between docked and floating modes)
  const videoContent = (
    <>
      {videoURL ? (
        <div className="v-container">
          <video 
            ref={videoRef} 
            src={videoURL} 
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)} 
            onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)} 
          />
          <div className="tc-overlay">
            {formatTC(currentTime)}
          </div>
          {localActiveCue && (localActiveCue.text || localActiveCue.character) && (
            <div className="adr-subtitle-overlay">
              {localActiveCue.character && (
                <div className="subtitle-character">{localActiveCue.character}</div>
              )}
              {localActiveCue.text && (
                <div className="subtitle-text">{localActiveCue.text}</div>
              )}
            </div>
          )}
          {/* Countdown overlay */}
          {countdown !== null && (
            <div className="countdown-overlay">
              <div className="countdown-number" key={countdown}>
                {countdown}
              </div>
              <div className="countdown-label">RECORDING IN...</div>
              <div className="countdown-hint">ESC or REC to cancel</div>
            </div>
          )}
          {/* Change Video button */}
          <button 
            className="change-video-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Change video"
          >
            <RefreshCw size={16} />
            <span>CHANGE VIDEO</span>
          </button>
          <input 
            ref={fileInputRef}
            type="file" 
            accept="video/*" 
            style={{ display: 'none' }} 
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) loadFile(f);
              e.target.value = '';
            }} 
          />
        </div>
      ) : (
        <div className="v-placeholder">
          <Video size={48} strokeWidth={1} />
          <span>LOAD FILM SOURCE</span>
          <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>Click or drop a video file</span>
          <input 
            ref={fileInputRef}
            type="file" 
            accept="video/*" 
            style={{ display: 'none' }} 
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) loadFile(f);
            }} 
          />
          {countdown !== null && (
            <div className="countdown-overlay">
              <div className="countdown-number" key={countdown}>
                {countdown}
              </div>
              <div className="countdown-label">RECORDING IN...</div>
              <div className="countdown-hint">ESC or REC to cancel</div>
            </div>
          )}
        </div>
      )}
    </>
  );

  // ── Float mode: render as fixed overlay ────────────────────────────────────
  if (isFloating) {
    return (
      <>
        {/* Placeholder in layout to keep space */}
        <section
          className="video-master video-master--docked-placeholder"
          style={{ height: `${videoHeight}px` }}
        />

        {/* Floating window */}
        <div
          ref={floatRef}
          className="video-float-window"
          style={{
            left: floatPos.x,
            top: floatPos.y,
            width: floatSize.w,
            height: floatSize.h,
          }}
        >
          {/* Title bar */}
          <div
            className="video-float-titlebar"
            onMouseDown={handleHeaderMouseDown}
          >
            <span className="video-float-title">VIDEO PREVIEW</span>
            <button
              className="video-float-pin-btn"
              onClick={() => setIsFloating(false)}
              title="Aggancia al layout"
            >
              <Pin size={13} />
              <span>AGGANCIA</span>
            </button>
          </div>

          {/* Video area */}
          <div
            className={`video-float-body ${isDraggingVideo ? 'drag-over-video' : ''}`}
            onClick={() => !videoURL && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingVideo(true); }}
            onDragLeave={() => setIsDraggingVideo(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingVideo(false);
              const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('video/'));
              if (f) loadFile(f);
            }}
          >
            {videoContent}
          </div>
        </div>
      </>
    );
  }

  // ── Docked mode (default) ──────────────────────────────────────────────────
  return (
    <section 
      className={`video-master ${isDraggingVideo ? 'drag-over-video' : ''}`}
      style={{ height: `${videoHeight}px` }} 
      onClick={() => !videoURL && fileInputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDraggingVideo(true); }}
      onDragLeave={() => setIsDraggingVideo(false)}
      onDrop={(e) => { 
        e.preventDefault(); 
        setIsDraggingVideo(false);
        const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('video/'));
        if (f) loadFile(f);
      }}
    >
      {/* Float toggle button */}
      <button
        className="video-float-toggle-btn"
        onClick={(e) => { e.stopPropagation(); setIsFloating(true); }}
        title="Scollega finestra video"
      >
        <PinOff size={13} />
        <span>FLOAT</span>
      </button>

      {videoContent}
    </section>
  );
};

export default VideoPreview;
