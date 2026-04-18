import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

const WaveformOverlay = ({ url, onReady, mini = false, color = '#10b981', height = 100 }) => {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !url) return;

    // Destroy previous instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }

    // WaveSurfer v7 API
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: mini ? 'transparent' : color,
      cursorColor: mini ? 'transparent' : '#ffffff',
      cursorWidth: mini ? 0 : 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: height,
      normalize: true,
      interact: !mini,
      hideScrollbar: true,
    });

    wavesurferRef.current = ws;
    ws.load(url);

    ws.on('ready', () => {
      if (onReady) onReady(ws);
    });

    ws.on('error', (err) => {
      console.warn('WaveSurfer error:', err);
    });

    return () => {
      ws.destroy();
    };
  }, [url, mini, color, height]); // onReady intentionally excluded to prevent init loops

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: `${height}px`,
        opacity: 0.85,
        pointerEvents: mini ? 'none' : 'auto',
      }} 
    />
  );
};

export default WaveformOverlay;
