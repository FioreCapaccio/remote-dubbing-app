import React, { useEffect, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

const WaveformOverlay = ({ url, onReady, mini = false, color = '#10b981', height = 100, pxPerSec }) => {
  const containerRef  = useRef(null);
  const wavesurferRef = useRef(null);
  const isReadyRef    = useRef(false);
  const pxPerSecRef   = useRef(pxPerSec);

  // Keep ref in sync so ready-callback always sees latest value
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);

  // (Re)create WaveSurfer when url / visual props change
  useEffect(() => {
    if (!containerRef.current || !url) return;

    isReadyRef.current = false;
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }

    const ws = WaveSurfer.create({
      container:     containerRef.current,
      waveColor:     color,
      progressColor: mini ? 'transparent' : color,
      cursorColor:   mini ? 'transparent' : '#ffffff',
      cursorWidth:   mini ? 0 : 1,
      barWidth:      2,
      barGap:        2,
      barRadius:     2,
      height:        height,
      normalize:     true,
      interact:      !mini,
      hideScrollbar: true,
      minPxPerSec:   pxPerSecRef.current ?? 1,
    });

    wavesurferRef.current = ws;
    ws.load(url);

    ws.on('ready', () => {
      isReadyRef.current = true;
      if (pxPerSecRef.current !== undefined) {
        try { ws.zoom(pxPerSecRef.current); } catch { /* suppress */ }
      }
      if (onReady) onReady(ws);
    });

    ws.on('error', (err) => {
      console.warn('WaveSurfer error:', err);
    });

    return () => {
      ws.destroy();
      isReadyRef.current = false;
    };
  }, [url, mini, color, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply zoom changes without re-creating the instance
  useEffect(() => {
    if (wavesurferRef.current && isReadyRef.current && pxPerSec !== undefined) {
      try { wavesurferRef.current.zoom(pxPerSec); } catch { /* suppress */ }
    }
  }, [pxPerSec]);

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width:         '100%', 
        height:        `${height}px`,
        opacity:       0.85,
        pointerEvents: mini ? 'none' : 'auto',
      }} 
    />
  );
};

export default WaveformOverlay;
