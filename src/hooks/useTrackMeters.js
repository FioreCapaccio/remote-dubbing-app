import { useEffect, useRef, useState } from 'react';

/**
 * Hook semplificato per monitorare i livelli audio delle tracce.
 * Solo stream locale del microfono, niente remoteStream.
 */
export const useTrackMeters = (tracks) => {
  const [trackLevels, setTrackLevels] = useState({});
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Inizializza lo stream locale del microfono
  useEffect(() => {
    let active = true;

    const initLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        localStreamRef.current = stream;
        
        // Crea AudioContext e analyser
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        analyserRef.current.smoothingTimeConstant = 0.8;

        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
      } catch (err) {
        console.error('[useTrackMeters] Error accessing microphone:', err);
      }
    };

    initLocalStream();

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Loop di aggiornamento livelli per tutte le tracce audio
  useEffect(() => {
    if (!analyserRef.current) return;

    const updateLevels = () => {
      const newLevels = {};
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Calcola livello RMS
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      
      // Converti in dB
      const db = rms === 0 ? -60 : 20 * Math.log10(rms / 255);
      const level = Math.max(-60, Math.min(0, db));

      // Applica lo stesso livello a tutte le tracce audio
      tracks.forEach(track => {
        if (track.type === 'audio') {
          newLevels[track.id] = level;
        }
      });

      setTrackLevels(newLevels);
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };

    updateLevels();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [tracks]);

  return trackLevels;
};

export default useTrackMeters;
