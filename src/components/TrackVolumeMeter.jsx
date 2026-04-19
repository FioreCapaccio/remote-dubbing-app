import React, { useEffect, useRef } from 'react';

/**
 * Componente TrackVolumeMeter - mostra una barra meter per il livello audio
 * Riceve il livello in dB già calcolato
 */
const TrackVolumeMeter = ({ dbLevel = -60 }) => {
  const renderCount = useRef(0);
  renderCount.current++;
  
  // Log ogni 30 render (~1 secondo a 30fps)
  useEffect(() => {
    if (renderCount.current % 30 === 1) {
      console.log('[TrackVolumeMeter] Props ricevute:', {
        dbLevel,
        renderCount: renderCount.current
      });
    }
  });

  // Normalizza da -60dB...0dB a 0...100%
  const percentage = Math.max(0, Math.min(100, ((dbLevel + 60) / 60) * 100));
  
  // Log se percentage è 0 ma dbLevel non è -60
  if (percentage === 0 && dbLevel > -59) {
    console.warn('[TrackVolumeMeter] ATTENZIONE: percentage è 0 ma dbLevel è:', dbLevel);
  }
  
  // Determina colore in base al livello
  let color;
  if (dbLevel > -6) {
    color = '#ff4444'; // Rosso - clipping
  } else if (dbLevel > -18) {
    color = '#ffcc00'; // Giallo - alto
  } else {
    color = '#00ff88'; // Verde - buono
  }

  // Log ogni 60 render per debug
  if (renderCount.current % 60 === 1) {
    console.log('[TrackVolumeMeter] Render state:', {
      dbLevel,
      percentage: percentage.toFixed(1),
      color,
      renderCount: renderCount.current
    });
  }

  return (
    <div className="track-volume-meter">
      {/* Barra di livello */}
      <div 
        style={{
          width: `${percentage}%`,
          height: '100%',
          background: `linear-gradient(90deg, #00ff88 0%, #00ff88 60%, #ffcc00 60%, #ffcc00 85%, #ff4444 85%, #ff4444 100%)`,
          transition: 'width 0.05s ease-out',
          position: 'relative'
        }}
      >
        {/* Overlay con colore solido basato sul livello attuale */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '100%',
          background: color,
          opacity: 0.3
        }} />
      </div>

      {/* Linee di riferimento */}
      <div style={{
        position: 'absolute',
        left: '60%',
        top: 0,
        bottom: 0,
        width: '1px',
        background: 'rgba(255,255,255,0.3)'
      }} />
      <div style={{
        position: 'absolute',
        left: '85%',
        top: 0,
        bottom: 0,
        width: '1px',
        background: 'rgba(255,255,255,0.3)'
      }} />

      {/* Label dB */}
      <span style={{
        position: 'absolute',
        right: '4px',
        top: '50%',
        transform: 'translateY(-50%)',
        fontSize: '9px',
        fontFamily: 'monospace',
        color: dbLevel > -6 ? '#ff4444' : '#ffffff',
        textShadow: '0 0 2px rgba(0,0,0,0.8)',
        pointerEvents: 'none'
      }}>
        {Math.round(dbLevel)}dB
      </span>
    </div>
  );
};

export default TrackVolumeMeter;
