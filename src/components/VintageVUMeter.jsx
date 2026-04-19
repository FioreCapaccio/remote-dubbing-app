import React, { useEffect, useRef, useState } from 'react';

/**
 * Componente VintageVUMeter - VU Meter analogico stile vintage con lancetta
 * Riceve il livello in dB e mostra una lancetta che si muove come i vecchi meter analogici
 */
const VintageVUMeter = ({ dbLevel = -60, trackId }) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const smoothedValueRef = useRef(0);
  const lastUpdateRef = useRef(0);
  
  // Stato per visualizzazione fallback se canvas non funziona
  const [useFallback, setUseFallback] = useState(false);

  // Converte dB in posizione della lancetta (0-1)
  const dbToPosition = (db) => {
    // Scala: -60dB = 0, -20dB = 0.5, 0dB = 0.85, +3dB = 1.0
    if (db <= -60) return 0;
    if (db <= -20) {
      // Da -60 a -20: mappa 0-0.5
      return (db + 60) / 40 * 0.5;
    }
    if (db <= 0) {
      // Da -20 a 0: mappa 0.5-0.85
      return 0.5 + (db + 20) / 20 * 0.35;
    }
    // Da 0 a +3: mappa 0.85-1.0
    return Math.min(1, 0.85 + db / 3 * 0.15);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setUseFallback(true);
      return;
    }

    // Imposta dimensioni canvas
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const centerX = width / 2;
    const centerY = height - 4;
    // Assicura che il raggio sia sempre positivo, minimo 10px
    const radius = Math.max(10, Math.min(width, height * 2) / 2 - 8);

    const drawMeter = () => {
      ctx.clearRect(0, 0, width, height);

      // Sfondo scuro vintage
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#1a1a1a');
      gradient.addColorStop(1, '#0d0d0d');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Bordo esterno stile vintage
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, width - 2, height - 2);

      // Scala graduata
      const startAngle = Math.PI * 0.8; // 144 gradi
      const endAngle = Math.PI * 0.2;   // 36 gradi

      // Zone colorate sullo sfondo della scala
      const zones = [
        { start: 0, end: 0.5, color: '#2d5a3d' },      // Verde scuro
        { start: 0.5, end: 0.75, color: '#5a5a2d' },   // Giallo scuro
        { start: 0.75, end: 0.9, color: '#5a3d2d' },   // Arancione scuro
        { start: 0.9, end: 1, color: '#5a2d2d' }       // Rosso scuro
      ];

      zones.forEach(zone => {
        const zoneStart = startAngle - (startAngle - endAngle) * zone.start;
        const zoneEnd = startAngle - (startAngle - endAngle) * zone.end;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 12, zoneEnd, zoneStart);
        ctx.lineWidth = 8;
        ctx.strokeStyle = zone.color;
        ctx.stroke();
      });

      // Tacche della scala
      const tickCount = 31;
      for (let i = 0; i < tickCount; i++) {
        const t = i / (tickCount - 1);
        const angle = startAngle - (startAngle - endAngle) * t;
        const isMajor = i % 5 === 0;
        const tickLength = isMajor ? 10 : 5;
        const tickWidth = isMajor ? 2 : 1;

        const x1 = centerX + Math.cos(angle) * (radius - 20);
        const y1 = centerY - Math.sin(angle) * (radius - 20);
        const x2 = centerX + Math.cos(angle) * (radius - 20 - tickLength);
        const y2 = centerY - Math.sin(angle) * (radius - 20 - tickLength);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = tickWidth;
        ctx.strokeStyle = isMajor ? '#ccc' : '#666';
        ctx.stroke();

        // Numeri sulle tacche principali
        if (isMajor) {
          const labelRadius = radius - 36;
          const labelX = centerX + Math.cos(angle) * labelRadius;
          const labelY = centerY - Math.sin(angle) * labelRadius;
          
          ctx.fillStyle = '#999';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // Valori dB per le tacche principali
          const dbValues = ['-60', '-40', '-20', '-10', '-5', '0', '+3'];
          const labelIndex = i / 5;
          if (dbValues[labelIndex]) {
            ctx.fillText(dbValues[labelIndex], labelX, labelY);
          }
        }
      }

      // Calcola posizione target della lancetta
      const targetPosition = dbToPosition(dbLevel);
      
      // Smoothing per movimento analogico realistico
      const smoothingFactor = 0.15;
      smoothedValueRef.current += (targetPosition - smoothedValueRef.current) * smoothingFactor;
      
      const currentAngle = startAngle - (startAngle - endAngle) * smoothedValueRef.current;

      // Disegna lancetta
      const needleLength = radius - 25;
      const needleX = centerX + Math.cos(currentAngle) * needleLength;
      const needleY = centerY - Math.sin(currentAngle) * needleLength;

      // Ombra della lancetta
      ctx.beginPath();
      ctx.moveTo(centerX + 2, centerY + 2);
      ctx.lineTo(needleX + 2, needleY + 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.stroke();

      // Lancetta principale
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(needleX, needleY);
      ctx.lineWidth = 2;
      
      // Colore lancetta basato sul livello
      let needleColor = '#00ff88';
      if (dbLevel > -6) needleColor = '#ff4444';
      else if (dbLevel > -18) needleColor = '#ffcc00';
      
      ctx.strokeStyle = needleColor;
      ctx.stroke();

      // Perno centrale
      ctx.beginPath();
      ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#444';
      ctx.fill();
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Vite al centro
      ctx.beginPath();
      ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#888';
      ctx.fill();

      // Label dB in basso
      ctx.fillStyle = dbLevel > -6 ? '#ff4444' : '#888';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(dbLevel)}dB`, centerX, height - 2);

      animationRef.current = requestAnimationFrame(drawMeter);
    };

    drawMeter();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dbLevel, trackId]);

  // Versione fallback se canvas non è supportato
  if (useFallback) {
    const percentage = Math.max(0, Math.min(100, ((dbLevel + 60) / 60) * 100));
    let color = '#00ff88';
    if (dbLevel > -6) color = '#ff4444';
    else if (dbLevel > -18) color = '#ffcc00';

    return (
      <div className="track-volume-meter vintage-fallback">
        <div style={{
          width: `${percentage}%`,
          height: '100%',
          background: color,
          transition: 'width 0.1s ease-out'
        }} />
        <span style={{
          position: 'absolute',
          right: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '9px',
          color: '#fff'
        }}>
          {Math.round(dbLevel)}dB
        </span>
      </div>
    );
  }

  return (
    <div className="track-volume-meter vintage-vu-meter">
      <canvas 
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block'
        }}
      />
    </div>
  );
};

export default VintageVUMeter;