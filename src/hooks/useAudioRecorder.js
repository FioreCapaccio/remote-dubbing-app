import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook per la registrazione audio:
 * - Il direttore (host) registra dal microfono locale se non c'è connessione
 * - Se c'è connessione, il direttore riceve l'audio dall'attore remoto
 * - Il doppiatore (guest) registra localmente e invia il blob al direttore
 */
export const useAudioRecorder = (settings = { sampleRate: 48000 }, isConnected = false, remoteStream = null, role = 'host', onBlobReady = null) => {
  const [isRecording, setIsRecording] = useState(false);
  const [takes, setTakes] = useState([]);
  const [devices, setDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('default');
  const [peakLevel, setPeakLevel] = useState(-60);
  const [recordingSource, setRecordingSource] = useState(role === 'host' ? 'remote' : 'local');
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micStreamRef = useRef(null);
  const peakMeterCallbackRef = useRef(null);
  const currentTrackIdRef = useRef('track-1');
  const mimeTypeRef = useRef('');

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
  // o per micStream (per il guest che registra localmente)
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

  // Avvia registrazione locale per il guest (attore)
  const startLocalRecording = useCallback(async (trackId = 'track-1') => {
    currentTrackIdRef.current = trackId;
    
    try {
      console.log('[AudioRecorder] Guest starting LOCAL recording');
      setRecordingSource('local');
      
      // Ottieni il microfono locale in mono
      const audioConstraints = {
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: settings.sampleRate || 48000,
          sampleSize: settings.bitDepth || 24
        }
      };
      
      if (selectedDevice) {
        audioConstraints.audio.deviceId = { exact: selectedDevice };
      }
      
      const monoStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
      micStreamRef.current = monoStream;
      
      // Upmix mono→stereo: usa GainNode con channelInterpretation='speakers'
      // per duplicare automaticamente il canale mono su L+R
      let recordingStream = monoStream;
      try {
        const ctxOpts = settings.sampleRate ? { sampleRate: settings.sampleRate } : {};
        const ctx = new (window.AudioContext || window.webkitAudioContext)(ctxOpts);
        if (ctx.state === 'suspended') await ctx.resume();
        audioContextRef.current = ctx;
        
        const src = ctx.createMediaStreamSource(monoStream);
        
        // Peak meter
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 1024;
        src.connect(analyserRef.current);
        updatePeakMeter();
        
        // Upmix: GainNode forzato a 2 canali con 'speakers' duplica mono su L+R
        const upmix = ctx.createGain();
        upmix.channelCount = 2;
        upmix.channelCountMode = 'explicit';
        upmix.channelInterpretation = 'speakers';
        
        const dest = ctx.createMediaStreamDestination();
        dest.channelCount = 2;
        dest.channelCountMode = 'explicit';
        
        src.connect(upmix);
        upmix.connect(dest);
        recordingStream = dest.stream;
        console.log('[AudioRecorder] Stereo upmix via GainNode – ctx:', ctx.state, 'tracks:', dest.stream.getAudioTracks().length);
      } catch (err) {
        console.error('[AudioRecorder] Stereo upmix failed, using mono:', err);
      }

      // Rileva il codec supportato
      const supportedMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/wav'
      ];
      
      let mimeType = '';
      for (const type of supportedMimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          console.log('[AudioRecorder] Guest using mimeType:', type);
          break;
        }
      }
      
      if (!mimeType) {
        console.error('[AudioRecorder] No supported mimeType found');
        alert('Errore: Il tuo browser non supporta la registrazione audio.');
        return;
      }
      
      mimeTypeRef.current = mimeType;

      // Calcola il bitrate in base alle impostazioni audio
      // Per Opus: qualità eccellente = sampleRate * bitDepth * canali (mono = 1)
      const calculatedBitrate = (settings.sampleRate || 48000) * (settings.bitDepth || 24) * 1;
      // Limita a range ragionevole per MediaRecorder (min 64kbps, max 512kbps)
      const targetBitrate = Math.min(Math.max(calculatedBitrate, 64000), 512000);

      const recorderOptions = {
        mimeType,
        audioBitsPerSecond: targetBitrate
      };

      const mediaRecorder = new MediaRecorder(recordingStream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Per il guest: invia il blob tramite callback invece di salvarlo localmente
        if (role === 'guest' && onBlobReady) {
          console.log('[AudioRecorder] Guest sending blob to host via callback');
          onBlobReady(audioBlob, {
            trackId: currentTrackIdRef.current,
            timestamp: new Date().toLocaleTimeString(),
            sourceType: 'local'
          });
        } else {
          // Per l'host: salva normalmente
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
      };

      mediaRecorder.onerror = (event) => {
        console.error('[AudioRecorder] MediaRecorder error:', event);
        alert('Errore durante la registrazione: ' + (event.message || 'Errore sconosciuto'));
        setIsRecording(false);
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      console.log('[AudioRecorder] Guest local recording started successfully');
    } catch (err) {
      console.error('[AudioRecorder] Error starting local recording:', err);
      alert('Errore durante l\'avvio della registrazione: ' + err.message);
    }
  }, [role, settings.sampleRate, settings.bitDepth, selectedDevice, onBlobReady]);

  // Avvia registrazione - Guest registra sempre localmente.
  // Host registra localmente SOLO se non c'è connessione, altrimenti aspetta blob dal guest.
  const startRecording = useCallback((trackId = 'track-1') => {
    currentTrackIdRef.current = trackId;
    
    if (role === 'guest') {
      // Il guest registra sempre localmente
      startLocalRecording(trackId);
      return;
    }

    // Host: se non c'è connessione, registra dal microfono locale
    if (!isConnected) {
      console.log('[AudioRecorder] Host: no connection, recording from LOCAL microphone');
      setRecordingSource('local');
      startLocalRecording(trackId);
      return;
    }

    // Host con connessione: NON registra localmente, aspetta blob dal guest
    console.log('[AudioRecorder] Host: connected, waiting for blob from guest');
    setRecordingSource('remote');
    setIsRecording(true);
  }, [isConnected, role, startLocalRecording]);

  const stopRecording = useCallback(() => {
    // Se stiamo registrando localmente (host senza connessione, o guest), ferma il MediaRecorder
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
    
    // Resetta lo stato di registrazione
    setIsRecording(false);
    
    // Se era una registrazione locale, ferma anche il mic stream
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    
    // Ferma l'analizzatore
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Chiudi l'audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, [isRecording]);

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