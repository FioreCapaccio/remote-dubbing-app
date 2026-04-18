import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Hook per monitorare i livelli audio di multiple tracce
 * Gestisce sia stream locale che remoto
 */
export const useTrackMeters = (tracks, remoteStream, selectedDevice) => {
  const [trackLevels, setTrackLevels] = useState({});
  const localStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analysersRef = useRef({}); // trackId -> { analyser, source, stream }
  const animationFrameRef = useRef(null);

  // Inizializza lo stream locale del microfono
  useEffect(() => {
    let active = true;

    const initLocalStream = async () => {
      try {
        // Ferma stream precedente
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => t.stop());
        }

        const constraints = { 
          audio: selectedDevice 
            ? { deviceId: { exact: selectedDevice } } 
            : true 
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        localStreamRef.current = stream;
      } catch (err) {
        console.error('[useTrackMeters] Error accessing microphone:', err);
      }
    };

    initLocalStream();

    return () => {
      active = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [selectedDevice]);

  // Gestisci gli analyser per ogni traccia audio
  useEffect(() => {
    if (!localStreamRef.current) return;

    // Chiudi analyser esistenti che non servono più
    const currentTrackIds = new Set(tracks.filter(t => t.type === 'audio').map(t => t.id));
    Object.keys(analysersRef.current).forEach(trackId => {
      if (!currentTrackIds.has(trackId)) {
        const { source, analyser } = analysersRef.current[trackId];
        try {
          source.disconnect();
          analyser.disconnect();
        } catch (e) {}
        delete analysersRef.current[trackId];
      }
    });

    // Crea AudioContext se necessario
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Crea/aggiorna analyser per ogni traccia
    tracks.forEach(track => {
      if (track.type !== 'audio') return;

      const audioSource = track.audioSource || 'local';
      const stream = audioSource === 'remote' ? remoteStream : localStreamRef.current;

      // Se lo stream non è cambiato, non fare nulla
      const existing = analysersRef.current[track.id];
      if (existing && existing.stream === stream && existing.audioSource === audioSource) {
        return;
      }

      // Pulisci analyser esistente
      if (existing) {
        try {
          existing.source.disconnect();
          existing.analyser.disconnect();
        } catch (e) {}
      }

      if (!stream) {
        delete analysersRef.current[track.id];
        return;
      }

      // Crea nuovo analyser
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyser);

      analysersRef.current[track.id] = {
        analyser,
        source,
        stream,
        audioSource
      };
    });

  }, [tracks, remoteStream]);

  // Loop di aggiornamento livelli
  useEffect(() => {
    const updateLevels = () => {
      const newLevels = {};

      Object.entries(analysersRef.current).forEach(([trackId, { analyser }]) => {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Calcola livello RMS
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        
        // Converti in dB
        const db = rms === 0 ? -60 : 20 * Math.log10(rms / 255);
        newLevels[trackId] = Math.max(-60, Math.min(0, db));
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
  }, []);

  return trackLevels;
};

export default useTrackMeters;
