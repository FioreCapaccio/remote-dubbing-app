import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook per la registrazione audio:
 * - Il direttore (host) registra dal microfono locale se non c'è connessione
 * - Se c'è connessione, il direttore riceve l'audio dall'attore remoto
 * - Il doppiatore (guest) registra localmente e invia il blob al direttore
 *
 * Registrazione locale: usa ScriptProcessorNode per catturare PCM raw → WAV stereo (L=R=mono)
 * Questo garantisce che il blob prodotto sia sempre stereo WAV, indipendentemente dal browser.
 */

// ── WAV stereo helpers ────────────────────────────────────────────────────────

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Crea un WAV stereo (2 canali, 16-bit PCM) da campioni mono Float32.
 * Il canale mono viene duplicato su L e R.
 */
function createStereoWav(monoSamples, sampleRate) {
  const numFrames = monoSamples.length;
  const numChannels = 2;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);         // fmt chunk size
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);      // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave: duplicate mono → L and R
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.max(-1, Math.min(1, monoSamples[i]));
    const val = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7FFF);
    view.setInt16(offset,     val, true); // L
    view.setInt16(offset + 2, val, true); // R (identical)
    offset += 4;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

// ─────────────────────────────────────────────────────────────────────────────

export const useAudioRecorder = (settings = { sampleRate: 48000 }, isConnected = false, remoteStream = null, role = 'host', onBlobReady = null) => {
  const [isRecording, setIsRecording] = useState(false);
  const [takes, setTakes] = useState([]);
  const [devices, setDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('default');
  const [peakLevel, setPeakLevel] = useState(-60);
  const [recordingSource, setRecordingSource] = useState(role === 'host' ? 'remote' : 'local');

  // ScriptProcessorNode recording (replaces MediaRecorder for local recording)
  const scriptProcessorRef = useRef(null);
  const pcmChunksRef = useRef([]);           // Array di Float32Array accumulati
  const recordingSampleRateRef = useRef(48000); // Sample rate effettivo del contesto

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micStreamRef = useRef(null);
  const peakMeterCallbackRef = useRef(null);
  const currentTrackIdRef = useRef('track-1');

  // Enumerazione dispositivi audio
  useEffect(() => {
    const getDevices = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        setDevices(allDevices.filter(d => d.kind === 'audioinput'));
        setOutputDevices(allDevices.filter(d => d.kind === 'audiooutput'));
        // Ferma lo stream temporaneo usato solo per l'enumerazione
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        console.error("Error accessing devices:", err);
      }
    };
    getDevices();
    navigator.mediaDevices.ondevicechange = getDevices;
  }, []);

  // Output device routing
  const setOutputDevice = async (deviceId) => {
    setSelectedOutput(deviceId);
  };

  // Peak meter update
  const updatePeakMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufferLength = analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(dataArray);

    let peak = 0;
    for (let i = 0; i < bufferLength; i++) {
      const absValue = Math.abs(dataArray[i]);
      if (absValue > peak) peak = absValue;
    }

    const dbfs = peak === 0 ? -Infinity : 20 * Math.log10(peak);
    setPeakLevel(dbfs);

    animationFrameRef.current = requestAnimationFrame(peakMeterCallbackRef.current);
  }, []);

  useEffect(() => {
    peakMeterCallbackRef.current = updatePeakMeter;
  }, [updatePeakMeter]);

  // Inizializza analizzatore per remoteStream (solo per il direttore/host)
  useEffect(() => {
    // Per il guest: usa il mic locale per il peak meter durante la registrazione
    if (role === 'guest') {
      if (!isRecording) {
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        analyserRef.current = null;
      }
      return;
    }

    // Per l'host: usa lo stream remoto
    if (!isConnected || !remoteStream) {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      return;
    }

    try {
      const contextOptions = {};
      if (settings && settings.sampleRate) {
        contextOptions.sampleRate = settings.sampleRate;
      }

      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
      } catch (e) {
        console.warn("Custom sample rate not supported, fallback to default", e);
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }

      const source = audioContextRef.current.createMediaStreamSource(remoteStream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 1024;
      source.connect(analyserRef.current);

      updatePeakMeter();
    } catch (err) {
      console.error("Remote stream analyzer init error:", err);
    }

    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [isConnected, remoteStream, settings.sampleRate, updatePeakMeter, role, isRecording]);

  // Avvia registrazione locale per il guest (attore) o per l'host senza connessione.
  // Usa ScriptProcessorNode per catturare raw PCM → WAV stereo, evitando blob vuoti
  // che affliggevano il percorso MediaRecorder → MediaStreamDestination.
  const startLocalRecording = useCallback(async (trackId = 'track-1') => {
    currentTrackIdRef.current = trackId;

    try {
      console.log('[AudioRecorder] Starting LOCAL recording via ScriptProcessorNode');
      setRecordingSource('local');

      // Ottieni il microfono locale in mono
      const audioConstraints = {
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: settings.sampleRate || 48000,
        }
      };

      if (selectedDevice) {
        audioConstraints.audio.deviceId = { exact: selectedDevice };
      }

      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
      micStreamRef.current = stream;

      // Crea AudioContext
      const contextOptions = {};
      if (settings && settings.sampleRate) {
        contextOptions.sampleRate = settings.sampleRate;
      }
      let ctx;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)(contextOptions);
      } catch (e) {
        console.warn('[AudioRecorder] Custom sampleRate not supported, using default', e);
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      audioContextRef.current = ctx;

      // Resume se sospeso (policy autoplay)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      recordingSampleRateRef.current = ctx.sampleRate;
      console.log('[AudioRecorder] Recording at sampleRate:', ctx.sampleRate);

      const source = ctx.createMediaStreamSource(stream);

      // Analyser per il peak meter — collegato direttamente alla source
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;
      source.connect(analyser);

      // ScriptProcessorNode: bufferSize 4096, 1 input channel, 1 output channel
      // Deprecato ma unico modo affidabile per catturare PCM raw cross-browser
      const bufferSize = 4096;
      const scriptProcessor = ctx.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorRef.current = scriptProcessor;
      pcmChunksRef.current = [];

      scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        // Copia il Float32Array (il buffer originale viene riutilizzato dal browser)
        const copy = new Float32Array(inputData);
        pcmChunksRef.current.push(copy);
        if (pcmChunksRef.current.length % 50 === 1) {
          console.log('[AudioRecorder] PCM chunks collected:', pcmChunksRef.current.length, '| last chunk max:', Math.max(...copy.slice(0, 100).map(Math.abs)).toFixed(4));
        }
      };

      // source → analyser → scriptProcessor → ctx.destination (muted via gain 0)
      // Il segnale deve fluire fino a destination per far girare onaudioprocess
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0; // muto l'uscita cuffie (non vogliamo ascoltare noi stessi)
      source.connect(scriptProcessor);
      scriptProcessor.connect(silentGain);
      silentGain.connect(ctx.destination);

      setIsRecording(true);
      updatePeakMeter();
      console.log('[AudioRecorder] ScriptProcessorNode recording started');
    } catch (err) {
      console.error('[AudioRecorder] Error starting local recording:', err);
      alert('Errore durante l\'avvio della registrazione: ' + err.message);
    }
  }, [role, settings.sampleRate, selectedDevice, updatePeakMeter]);

  // Ferma la registrazione locale e produce il WAV stereo
  const stopLocalRecording = useCallback(() => {
    const scriptProcessor = scriptProcessorRef.current;
    if (!scriptProcessor) return;

    console.log('[AudioRecorder] Stopping ScriptProcessorNode recording...');

    // Disconnetti il processore per fermare il flusso
    try { scriptProcessor.disconnect(); } catch {}
    scriptProcessorRef.current = null;

    // Concatena tutti i chunks PCM
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const monoSamples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      monoSamples.set(chunk, offset);
      offset += chunk.length;
    }

    const sampleRate = recordingSampleRateRef.current || 48000;
    console.log('[AudioRecorder] Total samples:', totalLength, '| sampleRate:', sampleRate, '| duration:', (totalLength / sampleRate).toFixed(2), 's');

    // Crea WAV stereo (L=R=mono)
    const audioBlob = createStereoWav(monoSamples, sampleRate);
    console.log('[AudioRecorder] WAV stereo blob created, size:', audioBlob.size, 'bytes');

    // Ferma il mic stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }

    // Ferma l'analizzatore
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Chiudi l'AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    // Consegna il blob
    if (role === 'guest' && onBlobReady) {
      console.log('[AudioRecorder] Guest sending WAV stereo blob to host via callback');
      onBlobReady(audioBlob, {
        trackId: currentTrackIdRef.current,
        timestamp: new Date().toLocaleTimeString(),
        sourceType: 'local'
      });
    } else {
      // Per l'host: salva nei takes
      const url = URL.createObjectURL(audioBlob);
      const newTake = {
        id: Date.now(),
        trackId: currentTrackIdRef.current,
        url,
        blob: audioBlob,
        timestamp: new Date().toLocaleTimeString(),
        sourceType: 'local'
      };
      setTakes((prev) => [newTake, ...prev]);
    }
  }, [role, onBlobReady]);

  // Avvia registrazione — Guest registra sempre localmente.
  // Host registra localmente SOLO se non c'è connessione.
  const startRecording = useCallback((trackId = 'track-1') => {
    currentTrackIdRef.current = trackId;

    if (role === 'guest') {
      startLocalRecording(trackId);
      return;
    }

    if (!isConnected) {
      console.log('[AudioRecorder] Host: no connection, recording from LOCAL microphone');
      setRecordingSource('local');
      startLocalRecording(trackId);
      return;
    }

    // Host con connessione: aspetta blob dal guest
    console.log('[AudioRecorder] Host: connected, waiting for blob from guest');
    setRecordingSource('remote');
    setIsRecording(true);
  }, [isConnected, role, startLocalRecording]);

  const stopRecording = useCallback(() => {
    // Se stiamo registrando localmente (guest o host senza connessione)
    // PRIMA ferma e processa il recording, POI aggiorna lo stato
    if (scriptProcessorRef.current) {
      stopLocalRecording();
    }

    // Sicurezza: ferma il mic stream se ancora attivo (non fermato da stopLocalRecording)
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }

    // Ferma l'analizzatore
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Chiudi l'AudioContext se non già chiuso da stopLocalRecording
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    // Aggiorna stato DOPO aver processato tutto
    setIsRecording(false);
  }, [stopLocalRecording]);

  return {
    isRecording,
    takes,
    devices,
    outputDevices,
    selectedDevice,
    setSelectedDevice,
    selectedOutput,
    setOutputDevice,
    peakLevel,
    recordingSource,
    startRecording,
    stopRecording
  };
};
