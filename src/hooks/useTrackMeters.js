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
    console.log(`[useTrackMeters] AnalyserNode creato per traccia ${track.id}:`, {
      fftSize: analyser.fftSize,
      smoothingTimeConstant: analyser.smoothingTimeConstant,
      frequencyBinCount: analyser.frequencyBinCount,
      audioContextState: audioContext.state
    });
    return analyser;
  }, [getAudioContext]);

  // Connetti sorgente audio all'analyser
  const connectSourceToAnalyser = useCallback((track, analyser) => {
    const audioContext = getAudioContext();
    
    try {
      console.log(`[useTrackMeters] Tentativo connessione per traccia ${track.id}:`, {
        trackType: track.type,
        hasVideoRef: !!videoRef?.current,
        hasClips: !!(track.clips?.length > 0),
        existingSource: !!sourcesRef.current[track.id],
        audioContextState: audioContext.state
      });
      
      // Per traccia ORIGINAL (video), collega al video element
      if (track.id === 'original' && videoRef?.current) {
        // Evita di ricreare la stessa sorgente
        if (sourcesRef.current[track.id]) {
          console.log(`[useTrackMeters] Sorgente già esistente per ${track.id}, skip`);
          return true;
        }
        
        console.log(`[useTrackMeters] Creazione MediaElementSource per video original`);
        const source = audioContext.createMediaElementSource(videoRef.current);
        source.connect(analyser);
        analyser.connect(audioContext.destination); // Per permettere l'audio di uscire
        sourcesRef.current[track.id] = source;
        console.log(`[useTrackMeters] Video source connessa per ${track.id}`);
        return true;
      }
      
      // Per tracce con clip audio (registrate), crea sorgente dal primo clip
      if (track.clips && track.clips.length > 0) {
        const firstClip = track.clips[0];
        if (firstClip.audioURL && !sourcesRef.current[track.id]) {
          console.log(`[useTrackMeters] Creazione audio element per clip ${track.id}:`, {
            audioURL: firstClip.audioURL.substring(0, 50) + '...'
          });
          // Crea elemento audio temporaneo per analizzare
          const audioEl = new Audio(firstClip.audioURL);
          audioEl.crossOrigin = 'anonymous';
          
          const source = audioContext.createMediaElementSource(audioEl);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
          sourcesRef.current[track.id] = source;
          
          // Salva riferimento per cleanup
          audioEl.dataset.trackId = track.id;
          console.log(`[useTrackMeters] Audio source connessa per ${track.id}`);
          return true;
        }
      }
      
      console.log(`[useTrackMeters] Nessuna sorgente connessa per ${track.id}`);
      return false;
    } catch (err) {
      console.error(`[useTrackMeters] Error connecting source for track ${track.id}:`, err);
      return false;
    }
  }, [getAudioContext, videoRef]);

  // Inizializza analysers per tutte le tracce
  useEffect(() => {
    if (!tracks || tracks.length === 0) {
      console.log('[useTrackMeters] Nessuna traccia da inizializzare');
      return;
    }

    console.log('[useTrackMeters] Inizializzazione analysers per', tracks.length, 'tracce:', 
      tracks.map(t => ({ id: t.id, type: t.type, clips: t.clips?.length || 0 })));

    // Crea analysers per nuove tracce
    tracks.forEach(track => {
      if (track.type !== 'audio') {
        console.log(`[useTrackMeters] Skip traccia ${track.id} - tipo non audio:`, track.type);
        return;
      }
      
      if (!analysersRef.current[track.id]) {
        console.log(`[useTrackMeters] Creazione analyser per nuova traccia:`, track.id);
        const analyser = createAnalyserForTrack(track);
        analysersRef.current[track.id] = analyser;
        connectSourceToAnalyser(track, analyser);
      }
    });

    // Cleanup per tracce rimosse
    const currentTrackIds = new Set(tracks.map(t => t.id));
    Object.keys(analysersRef.current).forEach(trackId => {
      if (!currentTrackIds.has(trackId)) {
        console.log(`[useTrackMeters] Cleanup analyser per traccia rimossa:`, trackId);
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
      console.log('[useTrackMeters] Riconnessione video source - video.src cambiato:', {
        src: videoRef.current.src?.substring(0, 50),
        hasAnalyser: !!analysersRef.current['original']
      });
      const analyser = analysersRef.current['original'] || createAnalyserForTrack(originalTrack);
      analysersRef.current['original'] = analyser;
      connectSourceToAnalyser(originalTrack, analyser);
    }
  }, [videoRef?.current?.src, tracks, createAnalyserForTrack, connectSourceToAnalyser, videoRef]);

  // Loop di aggiornamento livelli
  useEffect(() => {
    let frameCount = 0;
    
    const updateLevels = () => {
      const now = performance.now();
      // Limita a 30fps per performance
      if (now - lastUpdateRef.current < 33) {
        animationFrameRef.current = requestAnimationFrame(updateLevels);
        return;
      }
      lastUpdateRef.current = now;

      const newLevels = {};
      let hasNonZeroData = false;
      
      Object.entries(analysersRef.current).forEach(([trackId, analyser]) => {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        // DEBUG: Verifica dati frequency
        const nonZeroCount = dataArray.filter(v => v > 0).length;
        const maxValue = Math.max(...dataArray);
        const sumCheck = dataArray.reduce((a, b) => a + b, 0);
        
        if (nonZeroCount > 0) {
          hasNonZeroData = true;
        }
        
        // Log ogni 60 frame (~2 secondi) per non intasare
        if (frameCount % 60 === 0) {
          console.log(`[useTrackMeters] Track ${trackId} frequency data:`, {
            bufferLength,
            nonZeroCount,
            maxValue,
            sumCheck,
            sample: Array.from(dataArray.slice(0, 5)),
            hasSource: !!sourcesRef.current[trackId]
          });
        }

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

        // DEBUG: Verifica calcolo volume
        if (frameCount % 60 === 0) {
          console.log(`[useTrackMeters] Track ${trackId} volume calculation:`, {
            average,
            normalized: normalized.toFixed(4),
            db: db.toFixed(2),
            finalLevel: level.toFixed(2)
          });
        }

        newLevels[trackId] = level;
      });

      // Applica livelli anche alle tracce senza analyser (silenzio)
      tracks.forEach(track => {
        if (track.type === 'audio' && !(track.id in newLevels)) {
          newLevels[track.id] = -60;
        }
      });

      // DEBUG: Summary ogni 60 frame
      if (frameCount % 60 === 0) {
        console.log('[useTrackMeters] Update summary:', {
          frameCount,
          hasNonZeroData,
          analysersCount: Object.keys(analysersRef.current).length,
          levels: Object.entries(newLevels).map(([id, lvl]) => `${id}: ${lvl.toFixed(1)}dB`).join(', ')
        });
      }

      setTrackLevels(newLevels);
      frameCount++;
      animationFrameRef.current = requestAnimationFrame(updateLevels);
    };

    console.log('[useTrackMeters] Avvio loop aggiornamento livelli');
    updateLevels();

    return () => {
      console.log('[useTrackMeters] Stop loop aggiornamento livelli');
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
