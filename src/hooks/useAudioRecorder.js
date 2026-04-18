import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook per la registrazione audio:
 * - Solo il direttore (host) può registrare
 * - Il direttore registra dallo stream remoto (microfono del doppiatore)
 * - Il doppiatore (guest) NON registra nulla - è solo sorgente audio
 */
export const useAudioRecorder = (settings = { sampleRate: 48000 }, isConnected = false, remoteStream = null, role = 'host') => {
  const [isRecording, setIsRecording] = useState(false);
  const [takes, setTakes] = useState([]);
  const [devices, setDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('default');
  const [peakLevel, setPeakLevel] = useState(-60);
  const [recordingSource, setRecordingSource] = useState('remote'); // always 'remote' for host
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micStreamRef = useRef(null);
  const peakMeterCallbackRef = useRef(null);

  // Enumerazione dispositivi audio
  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
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
  useEffect(() => {
    // Il guest non ha bisogno di analizzatore per registrazione
    if (role !== 'host') {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      return;
    }

    if (!isConnected || !remoteStream) {
      // Pulisci audio context se non connesso
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
  }, [isConnected, remoteStream, settings.sampleRate, updatePeakMeter, role]);

  // Avvia registrazione - SOLO il direttore (host) registra dallo stream remoto
  const startRecording = useCallback((trackId = 'track-1') => {
    // Il guest NON registra mai
    if (role !== 'host') {
      console.log('[AudioRecorder] Guest cannot record - only the director (host) records');
      return;
    }

    try {
      if (!remoteStream) {
        alert("Remote stream not available. Make sure the dubber is connected.");
        return;
      }
      
      console.log('[AudioRecorder] Starting recording from REMOTE stream (dubber mic)');
      setRecordingSource('remote');
      
      // Usa codec audio di alta qualità: Opus a 128kbps
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg;codecs=opus';

      const recorderOptions = {
        mimeType,
        audioBitsPerSecond: 128000
      };

      console.log('[AudioRecorder] Using mimeType:', mimeType, 'bitrate: 128kbps');

      const mediaRecorder = new MediaRecorder(remoteStream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(audioBlob);
        
        const newTake = {
          id: Date.now(),
          trackId: trackId,
          url,
          blob: audioBlob,
          timestamp: new Date().toLocaleTimeString(),
          sourceType: 'remote'
        };
        setTakes((prev) => [newTake, ...prev]);
      };

      mediaRecorder.start(100); // timeslice di 100ms per cattura più granulare
      setIsRecording(true);
      console.log('[AudioRecorder] Recording started successfully from remote stream');
    } catch (err) {
      console.error('Error recording:', err);
      alert('Error: ' + err.message);
    }
  }, [remoteStream, role]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
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
