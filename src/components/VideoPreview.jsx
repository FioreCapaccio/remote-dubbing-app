import React, { useRef, useState } from 'react';
import { Video } from 'lucide-react';

const VideoPreview = ({ 
  videoHeight, videoURL, videoRef, 
  setCurrentTime, setDuration, 
  currentTime, activeMarker,
  setVideoURL 
}) => {
  const fileInputRef = useRef(null);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    setVideoURL(url, file.name);
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
          {activeMarker && activeMarker.text && (
            <div className="adr-subtitle-overlay">
              {activeMarker.text}
            </div>
          )}
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
        </div>
      )}
    </section>
  );
};

export default VideoPreview;
