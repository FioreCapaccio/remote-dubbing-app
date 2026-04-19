import React, { useRef, useState, useEffect } from 'react';
import { Video, RefreshCw } from 'lucide-react';

const VideoPreview = ({ 
  videoHeight, videoURL, videoRef, 
  setCurrentTime, setDuration, 
  currentTime, activeCue, cues,
  countdown,
  setVideoURL,
  setVideoFrameRate
}) => {
  const fileInputRef = useRef(null);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const [localActiveCue, setLocalActiveCue] = useState(null);

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
    
    // Rileva il frame rate del video
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
      
      // Cleanup
      tempVideo.src = '';
    };
  };

  const formatTC = (t) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const f = Math.floor((t % 1) * 25); // 25fps
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}:${f.toString().padStart(2,'0')}`;
  };

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
    </section>
  );
};

export default VideoPreview;
