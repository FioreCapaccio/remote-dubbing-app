import { useState, useRef, useCallback } from 'react';

/**
 * Hook per il riconoscimento vocale con Web Speech API.
 * Trascrive automaticamente segmenti audio usando SpeechRecognition.
 * 
 * Funzionalità:
 * - Trascrizione vocale da file audio o stream
 * - Supporto multilingua con rilevamento automatico o selezione manuale
 * - Stato di trascrizione in corso
 * - Gestione errori e fallback
 */
export function useSpeechRecognition() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [detectedLanguage, setDetectedLanguage] = useState(null);
  const recognitionRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Lingue supportate con codici BCP 47
  const supportedLanguages = [
    { code: 'it-IT', name: 'Italiano' },
    { code: 'en-US', name: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)' },
    { code: 'es-ES', name: 'Espanol' },
    { code: 'fr-FR', name: 'Francais' },
    { code: 'de-DE', name: 'Deutsch' },
    { code: 'pt-BR', name: 'Portugues (BR)' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'zh-CN', name: 'Chinese (Simplified)' },
    { code: 'ru-RU', name: 'Russian' },
    { code: 'auto', name: 'Auto-detect' }
  ];

  /**
   * Verifica se Web Speech API e supportata
   */
  const isSupported = useCallback(() => {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }, []);

  /**
   * Crea un'istanza SpeechRecognition
   */
  const createRecognition = useCallback((language = 'auto') => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error('Web Speech API non supportata in questo browser');
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    
    // Imposta lingua (auto usa il default del browser)
    if (language !== 'auto') {
      recognition.lang = language;
    }

    return recognition;
  }, []);

  /**
   * Estrae audio da un elemento video/audio per un intervallo di tempo
   * @param {HTMLMediaElement} mediaElement - Elemento video/audio sorgente
   * @param {number} startTime - Tempo di inizio in secondi
   * @param {number} duration - Durata del segmento in secondi
   * @returns {Promise<Blob>} Blob audio del segmento
   */
  const extractAudioSegment = useCallback(async (mediaElement, startTime, duration) => {
    if (!mediaElement || !mediaElement.src) {
      throw new Error('Nessun media disponibile per l\'estrazione audio');
    }

    setTranscriptionStatus('Estrazione segmento audio...');

    // Crea un AudioContext per estrarre il segmento
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    try {
      // Carica l'audio completo
      const response = await fetch(mediaElement.src);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Calcola i campioni di inizio e fine
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.min(
        Math.floor((startTime + duration) * sampleRate),
        audioBuffer.length
      );
      const segmentLength = endSample - startSample;

      if (segmentLength <= 0) {
        throw new Error('Segmento audio troppo corto');
      }

      // Crea un nuovo buffer per il segmento
      const segmentBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        segmentLength,
        sampleRate
      );

      // Copia i dati del segmento
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel);
        const segmentData = segmentBuffer.getChannelData(channel);
        for (let i = 0; i < segmentLength; i++) {
          segmentData[i] = sourceData[startSample + i];
        }
      }

      // Converte il buffer in WAV
      const wavBlob = await bufferToWave(segmentBuffer, segmentLength);
      
      await audioContext.close();
      return wavBlob;
    } catch (error) {
      await audioContext.close();
      throw error;
    }
  }, []);

  /**
   * Converte AudioBuffer in formato WAV
   */
  const bufferToWave = useCallback((abuffer, len) => {
    let numOfChan = abuffer.numberOfChannels;
    let length = len * numOfChan * 2 + 44;
    let buffer = new ArrayBuffer(length);
    let view = new DataView(buffer);
    let channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    // Scrivi l'header WAV
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this demo)
    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // Scrivi i dati interleaved
    for (i = 0; i < abuffer.numberOfChannels; i++) {
      channels.push(abuffer.getChannelData(i));
    }

    while (pos < length - 44) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos + 44, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([buffer], { type: 'audio/wav' });

    function setUint16(data) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }, []);

  /**
   * Rileva la lingua automaticamente usando una trascrizione di test
   */
  const detectLanguage = useCallback(async (mediaElement, startTime) => {
    if (!isSupported()) return 'en-US';

    try {
      // Estrai un breve campione per il rilevamento
      const sampleBlob = await extractAudioSegment(mediaElement, startTime, 3);
      
      // Prova diverse lingue e scegli quella con maggiore confidenza
      const testLanguages = ['it-IT', 'en-US', 'es-ES', 'fr-FR', 'de-DE'];
      let bestLang = 'en-US';
      let bestConfidence = 0;

      for (const lang of testLanguages) {
        try {
          const result = await transcribeSegment(mediaElement, startTime, 3, lang, true);
          if (result.confidence > bestConfidence && result.text.length > 5) {
            bestConfidence = result.confidence;
            bestLang = lang;
          }
        } catch (e) {
          // Ignora errori e continua con la prossima lingua
        }
      }

      setDetectedLanguage(bestLang);
      return bestLang;
    } catch (error) {
      console.warn('Errore rilevamento lingua:', error);
      return 'en-US';
    }
  }, [extractAudioSegment, isSupported]);

  /**
   * Trascrive un segmento audio usando Web Speech API
   * @param {HTMLMediaElement} mediaElement - Elemento video/audio
   * @param {number} startTime - Tempo di inizio in secondi
   * @param {number} duration - Durata del segmento
   * @param {string} language - Codice lingua (o 'auto' per rilevamento automatico)
   * @param {boolean} quickMode - Se true, esegue una trascrizione rapida per rilevamento
   * @returns {Promise<{text: string, confidence: number}>}
   */
  const transcribeSegment = useCallback(async (mediaElement, startTime, duration, language = 'auto', quickMode = false) => {
    if (!isSupported()) {
      throw new Error('Web Speech API non supportata. Usa Chrome, Edge o Safari.');
    }

    // Se auto-detect e non in quick mode, rileva prima la lingua
    let targetLang = language;
    if (language === 'auto' && !quickMode) {
      setTranscriptionStatus('Rilevamento lingua...');
      targetLang = await detectLanguage(mediaElement, startTime);
    }

    setIsTranscribing(true);
    setTranscriptionProgress(0);
    setTranscriptionStatus('Inizializzazione trascrizione...');
    abortControllerRef.current = new AbortController();

    return new Promise((resolve, reject) => {
      let finalTranscript = '';
      let interimTranscript = '';
      let confidence = 0;
      let segmentEnded = false;

      try {
        const recognition = createRecognition(targetLang);
        recognitionRef.current = recognition;

        // Crea un audio element temporaneo per riprodurre il segmento
        const audioElement = new Audio(mediaElement.src);
        audioElement.currentTime = startTime;
        
        // Imposta il tempo di fine
        const endTime = startTime + duration;

        recognition.onstart = () => {
          setTranscriptionStatus('Trascrizione in corso...');
          // Avvia la riproduzione dell'audio
          audioElement.play().catch(err => {
            console.warn('Errore riproduzione audio:', err);
          });
        };

        recognition.onresult = (event) => {
          interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            const resultConfidence = event.results[i][0].confidence || 0;
            
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
              confidence = Math.max(confidence, resultConfidence);
            } else {
              interimTranscript += transcript;
            }
          }

          // Aggiorna progresso basato sul tempo corrente
          const progress = Math.min(100, ((audioElement.currentTime - startTime) / duration) * 100);
          setTranscriptionProgress(progress);
        };

        recognition.onerror = (event) => {
          if (event.error === 'aborted') {
            reject(new Error('Trascrizione annullata'));
          } else if (event.error === 'no-speech') {
            // Nessun parlato rilevato, risolvi con stringa vuota
            resolve({ text: '', confidence: 0 });
          } else {
            reject(new Error(`Errore trascrizione: ${event.error}`));
          }
        };

        recognition.onend = () => {
          if (!segmentEnded) {
            segmentEnded = true;
            audioElement.pause();
            
            const result = {
              text: (finalTranscript || interimTranscript).trim(),
              confidence: confidence,
              language: targetLang
            };
            
            setIsTranscribing(false);
            setTranscriptionProgress(100);
            setTranscriptionStatus('Trascrizione completata');
            resolve(result);
          }
        };

        // Monitora il tempo per fermare al termine del segmento
        const checkTime = setInterval(() => {
          if (audioElement.currentTime >= endTime || audioElement.ended) {
            clearInterval(checkTime);
            recognition.stop();
          }
          
          // Aggiorna progresso
          const progress = Math.min(100, ((audioElement.currentTime - startTime) / duration) * 100);
          setTranscriptionProgress(progress);
        }, 100);

        // Gestione abort
        if (abortControllerRef.current) {
          abortControllerRef.current.signal.addEventListener('abort', () => {
            clearInterval(checkTime);
            audioElement.pause();
            recognition.abort();
          });
        }

        // Avvia il riconoscimento
        recognition.start();

      } catch (error) {
        setIsTranscribing(false);
        reject(error);
      }
    });
  }, [createRecognition, detectLanguage, isSupported]);

  /**
   * Trascrive automaticamente tutti i marker ADR
   * @param {HTMLMediaElement} mediaElement - Elemento video/audio
   * @param {Array} markers - Array di marker con timeIn e timeOut
   * @param {string} language - Lingua per la trascrizione
   * @param {Function} onProgress - Callback per progresso (markerIndex, totalMarkers, transcript)
   * @returns {Promise<Array>} Array di marker con testo trascritto
   */
  const transcribeMarkers = useCallback(async (mediaElement, markers, language = 'auto', onProgress = null) => {
    if (!markers || markers.length === 0) {
      return [];
    }

    setIsTranscribing(true);
    setTranscriptionStatus(`Trascrizione di ${markers.length} marker...`);
    
    const transcribedMarkers = [];
    const results = [];

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      
      // Calcola durata del marker
      const markerDuration = marker.timeOut 
        ? marker.timeOut - marker.timeIn 
        : 5; // Default 5 secondi se non c'e timeOut

      try {
        setTranscriptionStatus(`Trascrizione marker ${i + 1}/${markers.length}...`);
        
        const result = await transcribeSegment(
          mediaElement, 
          marker.timeIn, 
          markerDuration, 
          language === 'auto' && i === 0 ? 'auto' : (detectedLanguage || language)
        );

        const updatedMarker = {
          ...marker,
          text: result.text || marker.text || '',
          transcribedLanguage: result.language,
          transcriptionConfidence: result.confidence
        };

        transcribedMarkers.push(updatedMarker);
        results.push(result);

        if (onProgress) {
          onProgress(i + 1, markers.length, updatedMarker);
        }

        // Piccola pausa tra una trascrizione e l'altra
        if (i < markers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.error(`Errore trascrizione marker ${i + 1}:`, error);
        // Continua con il prossimo marker anche se questo fallisce
        transcribedMarkers.push({
          ...marker,
          text: marker.text || '[Errore trascrizione]',
          transcriptionError: error.message
        });
      }

      // Aggiorna progresso generale
      setTranscriptionProgress(((i + 1) / markers.length) * 100);
    }

    setIsTranscribing(false);
    setTranscriptionStatus(`Completato: ${results.filter(r => r.text).length}/${markers.length} marker trascritti`);
    
    return transcribedMarkers;
  }, [transcribeSegment, detectedLanguage]);

  /**
   * Annulla la trascrizione in corso
   */
  const cancelTranscription = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
    setIsTranscribing(false);
    setTranscriptionStatus('Trascrizione annullata');
  }, []);

  /**
   * Resetta lo stato della trascrizione
   */
  const resetTranscription = useCallback(() => {
    setIsTranscribing(false);
    setTranscriptionProgress(0);
    setTranscriptionStatus('');
    setDetectedLanguage(null);
    abortControllerRef.current = null;
    recognitionRef.current = null;
  }, []);

  return {
    // Stato
    isTranscribing,
    transcriptionProgress,
    transcriptionStatus,
    detectedLanguage,
    supportedLanguages,
    
    // Metodi
    isSupported,
    transcribeSegment,
    transcribeMarkers,
    detectLanguage,
    cancelTranscription,
    resetTranscription
  };
}

export default useSpeechRecognition;
