import { useState, useRef, useCallback } from 'react';

/**
 * Hook per l'analisi audio automatica e rilevamento inizio frasi.
 * Utilizza Web Audio API per analizzare il volume e identificare i punti
 * dove iniziano le frasi (picchi di volume dopo silenzi).
 */
export function useAudioAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const abortControllerRef = useRef(null);

  /**
   * Analizza un elemento audio e rileva gli inizi delle frasi.
   * @param {HTMLAudioElement} audioElement - Elemento audio da analizzare
   * @param {Object} options - Opzioni di analisi
   * @returns {Promise<Array>} Array di timestamp dove iniziano le frasi
   */
  const analyzeAudio = useCallback(async (audioElement, options = {}) => {
    const {
      silenceThreshold = -40,    // dB sotto cui considerare silenzio
      minSilenceDuration = 0.3,  // secondi minimi di silenzio
      minPhraseDuration = 0.5,   // durata minima di una frase
      preRoll = 0.1,             // secondi prima dell'inizio rilevato
      smoothingFactor = 0.8,     // smoothing del volume (0-1)
      windowSize = 1024          // dimensione finestra FFT
    } = options;

    if (!audioElement || !audioElement.src) {
      throw new Error('Nessun audio disponibile per l\'analisi');
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStatus('Inizializzazione analisi audio...');
    abortControllerRef.current = new AbortController();

    try {
      // Crea AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Carica l'audio come array buffer per analisi offline
      setAnalysisStatus('Caricamento audio...');
      const response = await fetch(audioElement.src);
      const arrayBuffer = await response.arrayBuffer();
      
      if (abortControllerRef.current.signal.aborted) {
        throw new Error('Analisi annullata');
      }

      setAnalysisStatus('Decodifica audio...');
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      if (abortControllerRef.current.signal.aborted) {
        throw new Error('Analisi annullata');
      }

      const duration = audioBuffer.duration;
      const sampleRate = audioBuffer.sampleRate;
      const channelData = audioBuffer.getChannelData(0); // Usa solo il primo canale

      setAnalysisStatus('Analisi del volume...');

      // Parametri per l'analisi
      const hopSize = Math.floor(windowSize / 4); // 75% overlap
      const totalSamples = channelData.length;
      const rmsWindowSize = Math.floor(sampleRate * 0.05); // 50ms window per RMS

      // Calcola RMS per ogni finestra
      const rmsValues = [];
      const timestamps = [];

      for (let i = 0; i < totalSamples - rmsWindowSize; i += hopSize) {
        // Calcola RMS
        let sum = 0;
        for (let j = 0; j < rmsWindowSize; j++) {
          sum += channelData[i + j] * channelData[i + j];
        }
        const rms = Math.sqrt(sum / rmsWindowSize);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;

        rmsValues.push(db);
        timestamps.push(i / sampleRate);

        // Aggiorna progresso ogni 1000 campioni
        if (i % (hopSize * 100) === 0) {
          const progress = (i / totalSamples) * 50; // Prima metà: analisi volume
          setAnalysisProgress(progress);
          
          // Yield per UI update
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        if (abortControllerRef.current.signal.aborted) {
          throw new Error('Analisi annullata');
        }
      }

      setAnalysisStatus('Rilevamento frasi...');

      // Applica smoothing
      const smoothedRms = [rmsValues[0]];
      for (let i = 1; i < rmsValues.length; i++) {
        smoothedRms[i] = smoothingFactor * smoothedRms[i - 1] + (1 - smoothingFactor) * rmsValues[i];
      }

      // Rileva inizio frasi
      const phraseStarts = [];
      let isInSilence = true;
      let silenceStart = 0;
      let lastPhraseEnd = 0;

      for (let i = 0; i < smoothedRms.length; i++) {
        const db = smoothedRms[i];
        const time = timestamps[i];

        if (isInSilence) {
          // Stiamo cercando l'inizio di una frase
          if (db > silenceThreshold) {
            // Possibile inizio frase
            const silenceDuration = time - silenceStart;
            if (silenceDuration >= minSilenceDuration) {
              // Silenzio sufficiente, questo è un inizio frase valido
              const phraseStart = Math.max(0, time - preRoll);
              
              // Verifica che sia abbastanza distante dall'ultima frase
              if (phraseStart >= lastPhraseEnd + minPhraseDuration || phraseStarts.length === 0) {
                phraseStarts.push(phraseStart);
              }
            }
            isInSilence = false;
          }
        } else {
          // Stiamo in una frase, cerchiamo la fine
          if (db <= silenceThreshold) {
            silenceStart = time;
            isInSilence = true;
            lastPhraseEnd = time;
          }
        }

        // Aggiorna progresso (seconda metà)
        if (i % 100 === 0) {
          const progress = 50 + (i / smoothedRms.length) * 50;
          setAnalysisProgress(progress);
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        if (abortControllerRef.current.signal.aborted) {
          throw new Error('Analisi annullata');
        }
      }

      // Chiudi il context
      await audioContext.close();

      setAnalysisProgress(100);
      setAnalysisStatus(`Analisi completata: ${phraseStarts.length} frasi rilevate`);

      return phraseStarts;

    } catch (error) {
      if (error.message === 'Analisi annullata') {
        throw error;
      }
      console.error('Errore analisi audio:', error);
      throw new Error('Errore durante l\'analisi audio: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  /**
   * Annulla l'analisi in corso
   */
  const cancelAnalysis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  /**
   * Resetta lo stato dell'analisi
   */
  const resetAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setAnalysisStatus('');
    abortControllerRef.current = null;
  }, []);

  return {
    isAnalyzing,
    analysisProgress,
    analysisStatus,
    analyzeAudio,
    cancelAnalysis,
    resetAnalysis
  };
}

export default useAudioAnalysis;
