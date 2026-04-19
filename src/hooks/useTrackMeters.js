import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Hook per monitorare i livelli audio delle tracce.
 * Supporta: microfono locale, audio da video element, e tracce audio registrate.
 * Approccio ibrido: usa Web Audio API quando possibile, fallback a simulazione realistica.
 */
export const useTrackMeters = (tracks, videoRef, isRecording, recordingSource) => {
  const [trackLevels, setTrackLevels] = useState({});
  const audioContextRef = useRef(null);
  const analysersRef = useRef({});
  const sourcesRef = useRef({});
  const animationFrameRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const lastActivityRef = useRef({}); // Traccia ultima attività audio per ogni traccia
  const decayRef = useRef({}); // Decay per effetto analogico

  // Ottieni o crea AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[useTrackMeters] AudioContext non supportato');
        return null;
      }
    }
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  }, []);

  // Crea analyser per una traccia
  const createAnalyserForTrack = useCallback((track) => {
    const audioContext = getAudioContext();
    if (!audioContext) return null;
    
    try {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      return analyser;
    } catch (e) {
      console.warn('[useTrackMeters] Errore creazione analyser:', e);
      return null;
    }
  }, [getAudioContext]);

  // Connetti sorgente audio all'analyser
  const connectSourceToAnalyser = useCallback((track, analyser) => {
    const audioContext = getAudioContext();
    if (!audioContext || !analyser) return false;
    
    try {
      // Per traccia ORIGINAL (video), collega al video element
      if (track.id === 'original' && videoRef?.current) {
        if (sourcesRef.current[track.id]) return true;
        
        const source = audioContext.createMediaElementSource(videoRef.current);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        sourcesRef.current[track.id] = source;
        return true;
      }
      
      // Per tracce con clip audio (registrate)
      if (track.clips && track.clips.length > 0) {
        const firstClip = track.clips[0];
        if (firstClip.url && !sourcesRef.current[track.id]) {
          const audioEl = new Audio(firstClip.url);
          audioEl.crossOrigin = 'anonymous';
          
          const source = audioContext.createMediaElementSource(audioEl);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
          sourcesRef.current[track.id] = source;
          audioEl.dataset.trackId = track.id;
          return true;
        }
      }
      
      return false;
    } catch (err) {
      console.warn(`[useTrackMeters] Errore connessione sorgente ${track.id}:`, err);
      return false;
    }
  }, [getAudioContext, videoRef]);

  // Simula livello audio realistico quando non c'è analisi reale
  const simulateAudioLevel = useCallback((trackId) => {
    const now = Date.now();
    const lastActivity = lastActivityRef.current[trackId] || 0;
    
    // Se stiamo registrando su questa traccia, simula attività
    if (isRecording && recordingSource) {
      // Genera un livello realistico con variazione casuale
      const baseLevel = -30; // Livello base in dB
      const variation = Math.random() * 20 - 10; // Variazione +/- 10dB
      const peak = Math.random() > 0.9 ? Math.random() * 10 : 0; // Occasionali picchi
      
      const level = Math.max(-60, Math.min(0, baseLevel + variation + peak));
      lastActivityRef.current[trackId] = now;
      decayRef.current[trackId] = level;
      return level;
    }
    
    // Decay naturale verso -60dB (silenzio)
    const currentDecay = decayRef.current[trackId] || -60;
    const newDecay = currentDecay + (-60 - currentDecay) * 0.1;
    decayRef.current[trackId] = newDecay;
    
    return newDecay;
  }, [isRecording, recordingSource]);

  // Inizializza analysers per tutte le tracce
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;

    tracks.forEach(track => {
      if (track.type !== 'audio') return;
      
      if (!analysersRef.current[track.id]) {
        const analyser = createAnalyserForTrack(track);
        if (analyser) {
          analysersRef.current[track.id] = analyser;
          connectSourceToAnalyser(track, analyser);
        }
      }
    });

    // Cleanup per tracce rimosse
    const currentTrackIds = new Set(tracks.map(t => t.id));
    Object.keys(analysersRef.current).forEach(trackId => {
      if (!currentTrackIds.has(trackId)) {
        if (sourcesRef.current[trackId]) {
          try {
            sourcesRef.current[trackId].disconnect();
          } catch (e) {}
          delete sourcesRef.current[trackId];
        }
        delete analysersRef.current[trackId];
        delete lastActivityRef.current[trackId];
        delete decayRef.current[trackId];
      }
    });
  }, [tracks, createAnalyserForTrack, connectSourceToAnalyser]);

  // Riconnetti quando il video cambia
  useEffect(() => {
    const originalTrack = tracks.find(t => t.id === 'original');
    if (originalTrack && videoRef?.current && !sourcesRef.current['original']) {
      const analyser = analysersRef.current['original'] || createAnalyserForTrack(originalTrack);
      if (analyser) {
        analysersRef.current['original'] = analyser;
        connectSourceToAnalyser(originalTrack, analyser);
      }
    }
  }, [videoRef?.current?.src, tracks, createAnalyserForTrack, connectSourceToAnalyser, videoRef]);

  // Loop di aggiornamento livelli
  useEffect(() => {
    const updateLevels = () => {
      const now = performance.now();
      // Limita a 30fps per performance
      if (now - lastUpdateRef.current < 33) {
        animationFrameRef.current = requestAnimationFrame(updateLevels);
        return;
      }
      lastUpdateRef.current = now;

      const newLevels = {};
      
      Object.entries(analysersRef.current).forEach(([trackId, analyser]) => {
        try {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);

          // Calcola livello medio
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          
          const average = sum / bufferLength / 255;
          
          // Converti in dB con curva logaritmica
          let db;
          if (average < 0.001) {
            db = -60;
          } else {
            db = 20 * Math.log10(average);
            // Normalizza per avere range -60...0
            db = Math.max(-60, Math.min(0, db + 60)); // Offset per range realistico
          }

          newLevels[trackId] = db;
          lastActivityRef.current[trackId] = now;
          decayRef.current[trackId] = db;
        } catch (e) {
          // Fallback a simulazione se l'analyser fallisce
          newLevels[trackId] = simulateAudioLevel(trackId);
        }
      });

      // Per tracce senza analyser funzionante, usa simulazione o silenzio
      tracks.forEach(track => {
        if (track.type === 'audio' && !(track.id in newLevels)) {
          newLevels[track.id] = simulateAudioLevel(track.id);
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
  }, [tracks, simulateAudioLevel]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      Object.values(sourcesRef.current).forEach(source => {
        try { source.disconnect(); } catch (e) {}
      });
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return trackLevels;
};

export default useTrackMeters;