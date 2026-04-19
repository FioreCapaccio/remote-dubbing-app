import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Hook per monitorare i livelli audio delle tracce.
 * Supporta: microfono locale, audio da video element, e tracce audio registrate.
 */
export const useTrackMeters = (tracks, videoRef) => {
  const [trackLevels, setTrackLevels] = useState({});
  const audioContextRef = useRef(null);
  const analysersRef = useRef({}); // { trackId: analyserNode }
  const sourcesRef = useRef({}); // { trackId: mediaElementSource }
  const animationFrameRef = useRef(null);
  const lastUpdateRef = useRef(0);

  // Ottieni o crea AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Crea analyser per una traccia
  const createAnalyserForTrack = useCallback((track) => {
    const audioContext = getAudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    return analyser;
  }, [getAudioContext]);

  // Connetti sorgente audio all'analyser
  const connectSourceToAnalyser = useCallback((track, analyser) => {
    const audioContext = getAudioContext();
    
    try {
      // Per traccia ORIGINAL (video), collega al video element
      if (track.id === 'original' && videoRef?.current) {
        // Evita di ricreare la stessa sorgente
        if (sourcesRef.current[track.id]) {
          return true;
        }
        
        const source = audioContext.createMediaElementSource(videoRef.current);
        source.connect(analyser);
        analyser.connect(audioContext.destination); // Per permettere l'audio di uscire
        sourcesRef.current[track.id] = source;
        return true;
      }
      
      // Per tracce con clip audio (registrate), crea sorgente dal primo clip
      if (track.clips && track.clips.length > 0) {
        const firstClip = track.clips[0];
        if (firstClip.audioURL && !sourcesRef.current[track.id]) {
          // Crea elemento audio temporaneo per analizzare
          const audioEl = new Audio(firstClip.audioURL);
          audioEl.crossOrigin = 'anonymous';
          
          const source = audioContext.createMediaElementSource(audioEl);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
          sourcesRef.current[track.id] = source;
          
          // Salva riferimento per cleanup
          audioEl.dataset.trackId = track.id;
          return true;
        }
      }
      
      return false;
    } catch (err) {
      console.error(`[useTrackMeters] Error connecting source for track ${track.id}:`, err);
      return false;
    }
  }, [getAudioContext, videoRef]);

  // Inizializza analysers per tutte le tracce
  useEffect(() => {
    if (!tracks || tracks.length === 0) return;

    // Crea analysers per nuove tracce
    tracks.forEach(track => {
      if (track.type !== 'audio') return;
      
      if (!analysersRef.current[track.id]) {
        const analyser = createAnalyserForTrack(track);
        analysersRef.current[track.id] = analyser;
        connectSourceToAnalyser(track, analyser);
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
      }
    });
  }, [tracks, createAnalyserForTrack, connectSourceToAnalyser]);

  // Riconnetti quando il video cambia
  useEffect(() => {
    const originalTrack = tracks.find(t => t.id === 'original');
    if (originalTrack && videoRef?.current && !sourcesRef.current['original']) {
      const analyser = analysersRef.current['original'] || createAnalyserForTrack(originalTrack);
      analysersRef.current['original'] = analyser;
      connectSourceToAnalyser(originalTrack, analyser);
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
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // Calcola livello medio (valori 0-255)
        let sum = 0;
        let count = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
          if (dataArray[i] > 0) count++;
        }
        
        // Media dei valori (0-255)
        const average = count > 0 ? sum / bufferLength : 0;
        
        // Converti in dB: mappa 0-255 a -60dB...0dB
        // Usa una curva logaritmica per migliore risposta visiva
        const normalized = average / 255;
        const db = normalized === 0 ? -60 : 20 * Math.log10(normalized);
        const level = Math.max(-60, Math.min(0, db));

        newLevels[trackId] = level;
      });

      // Applica livelli anche alle tracce senza analyser (silenzio)
      tracks.forEach(track => {
        if (track.type === 'audio' && !(track.id in newLevels)) {
          newLevels[track.id] = -60;
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
