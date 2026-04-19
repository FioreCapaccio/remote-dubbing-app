import React, { useEffect, useRef, useState } from 'react';

/**
 * Componente VolumeMeter - mostra il livello audio in dB in tempo reale
 * Usa AnalyserNode di Web Audio API per analizzare il segnale
 * 
 * Props:
 * - stream: MediaStream da analizzare (modalità analisi live)
 * - level: valore in dB già calcolato (modalità display solo valore)
 * - audioSource: 'local' | 'remote' (info aggiuntiva)
 * - isActive: se false, disabilita l'analisi
 * - showValue: se false, nasconde il valore numerico (default: true)
 */
const VolumeMeter = ({ stream, level, audioSource = 'local', isActive = true, showValue = true }) => {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const [dbLevel, setDbLevel] = useState(-Infinity);

  // Se viene passato direttamente il level (modalità Master Peak), usa quello
  const dbLevelFromProp = typeof level === 'number' ? level : null;

  useEffect(() => {
    // Modalità display solo valore (level passato come prop)
    if (dbLevelFromProp !== null) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;

      const drawFromProp = () => {
        const clampedDb = Math.max(-60, Math.min(0, dbLevelFromProp));

        // Pulisci canvas
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        // Disegna barra di livello
        const levelPct = (clampedDb + 60) / 60; // -60dB -> 0, 0dB -> 1
        const barWidth = width * levelPct;

        // Disegna barra con gradiente
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#00ff88');
        gradient.addColorStop(0.6, '#ffcc00');
        gradient.addColorStop(0.85, '#ff4444');
        gradient.addColorStop(1, '#ff0000');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, barWidth, height);

        // Disegna linee di riferimento
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;

        // Linea -18dB (verde/giallo)
        const yellowX = width * 0.6;
        ctx.beginPath();
        ctx.moveTo(yellowX, 0);
        ctx.lineTo(yellowX, height);
        ctx.stroke();

        // Linea -6dB (giallo/rosso)
        const redX = width * 0.85;
        ctx.beginPath();
        ctx.moveTo(redX, 0);
        ctx.lineTo(redX, height);
        ctx.stroke();

        // Mostra valore dB solo se showValue è true
        if (showValue) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '10px monospace';
          ctx.textAlign = 'right';
          const displayDb = dbLevelFromProp === -Infinity ? '-∞' : Math.round(dbLevelFromProp);
          ctx.fillText(`${displayDb}dB`, width - 4, height - 2);
        }

        animationFrameRef.current = requestAnimationFrame(drawFromProp);
      };

      drawFromProp();

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }

    // Modalità analisi stream (originale)
    if (!isActive || !stream) {
      setDbLevel(-Infinity);
      return;
    }

    let active = true;

    const initAnalyser = async () => {
      try {
        // Chiudi contesto precedente se esiste
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close().catch(() => {});
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        // Crea nuovo AudioContext
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        
        // Crea analyser
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.8;

        // Connetti lo stream
        sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);

        const draw = () => {
          if (!active || !analyserRef.current || !canvasRef.current) return;

          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          const width = canvas.width;
          const height = canvas.height;

          // Ottieni dati frequenza
          const bufferLength = analyserRef.current.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyserRef.current.getByteFrequencyData(dataArray);

          // Calcola livello medio in dB
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Converti in dB (0-255 range -> -60dB to 0dB approx)
          const db = average === 0 ? -60 : 20 * Math.log10(average / 255);
          const clampedDb = Math.max(-60, Math.min(0, db));
          setDbLevel(clampedDb);

          // Pulisci canvas
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, width, height);

          // Disegna barra di livello
          const levelPct = (clampedDb + 60) / 60; // -60dB -> 0, 0dB -> 1
          const barWidth = width * levelPct;

          // Disegna barra con gradiente
          const gradient = ctx.createLinearGradient(0, 0, width, 0);
          gradient.addColorStop(0, '#00ff88');
          gradient.addColorStop(0.6, '#ffcc00');
          gradient.addColorStop(0.85, '#ff4444');
          gradient.addColorStop(1, '#ff0000');

          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, barWidth, height);

          // Disegna linee di riferimento
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 1;
          
          // Linea -18dB (verde/giallo)
          const yellowX = width * 0.6;
          ctx.beginPath();
          ctx.moveTo(yellowX, 0);
          ctx.lineTo(yellowX, height);
          ctx.stroke();

          // Linea -6dB (giallo/rosso)
          const redX = width * 0.85;
          ctx.beginPath();
          ctx.moveTo(redX, 0);
          ctx.lineTo(redX, height);
          ctx.stroke();

          // Mostra valore dB solo se showValue è true
          if (showValue) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${Math.round(clampedDb)}dB`, width - 4, height - 2);
          }

          animationFrameRef.current = requestAnimationFrame(draw);
        };

        draw();
      } catch (err) {
        console.error('[VolumeMeter] Error initializing analyser:', err);
      }
    };

    initAnalyser();

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [stream, isActive]);

  // Se non c'è stream E non è passato level, mostra barra vuota
  if (!stream && dbLevelFromProp === null) {
    return (
      <div className="volume-meter-container">
        <canvas 
          ref={canvasRef} 
          width={120} 
          height={16} 
          className="volume-meter-canvas"
          style={{ background: '#1a1a2e', borderRadius: '2px' }}
        />
        <span className="volume-meter-label">No Signal</span>
      </div>
    );
  }

  // Se è passato level come prop, mostra il valore passato
  if (dbLevelFromProp !== null) {
    return (
      <div className="volume-meter-container">
        <canvas 
          ref={canvasRef} 
          width={120} 
          height={16} 
          className="volume-meter-canvas"
          style={{ background: '#1a1a2e', borderRadius: '2px' }}
        />
        <span className={`volume-meter-label ${dbLevelFromProp > -6 ? 'clipping' : dbLevelFromProp > -18 ? 'high' : 'good'}`}>
          {dbLevelFromProp === -Infinity ? '-∞' : Math.round(dbLevelFromProp)}dB
        </span>
      </div>
    );
  }

  return (
    <div className="volume-meter-container">
      <canvas 
        ref={canvasRef} 
        width={120} 
        height={16} 
        className="volume-meter-canvas"
        style={{ background: '#1a1a2e', borderRadius: '2px' }}
      />
      <span className={`volume-meter-label ${dbLevel > -6 ? 'clipping' : dbLevel > -18 ? 'high' : 'good'}`}>
        {Math.round(dbLevel)}dB
      </span>
    </div>
  );
};

export default VolumeMeter;
