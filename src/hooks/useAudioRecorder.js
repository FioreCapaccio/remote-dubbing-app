import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook semplificato per la registrazione audio.
 * Cattura solo il microfono locale del doppiatore.
 * Nessun multi-track, nessun audioSource, nessun remoteStream.
 */
export const useAudioRecorder = (settings = { sampleRate: 44100 }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [takes, setTakes] = useState([]);
  const [devices, setDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('default');
  const [peakLevel, setPeakLevel] = useState(-60);
  
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
    if (!analyserRef.current) return;
    
    const bufferLength = analyserRef.current.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);
    
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

  // Inizializza microfono per monitoraggio VU
  useEffect(() => {
    let active = true;
    const initMic = async () => {
      try {
        if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
           await audioContextRef.current.close().catch(() => {});
        }
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

        const constraints = { audio: selectedDevice ? { deviceId: { exact: selectedDevice } } : true };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!active) return stream.getTracks().forEach(t => t.stop());
        
        micStreamRef.current = stream;
        
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
        
        const source = audioContextRef.current.createMediaStreamSource(stream);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 1024;
        source.connect(analyserRef.current);
        
        updatePeakMeter();
      } catch (err) {
        console.error("Mic monitor init error:", err);
      }
    };
    initMic();
    return () => { active = false; };
  }, [selectedDevice, updatePeakMeter, settings.sampleRate]);

  // Avvia registrazione - semplice, solo microfono locale
  const startRecording = useCallback((trackId = 'track-1') => {
    try {
      if (!micStreamRef.current) {
        alert("Microphone not ready.");
        return;
      }
      
      console.log('[AudioRecorder] Starting recording (local mic only)');
      
      const mediaRecorder = new MediaRecorder(micStreamRef.current);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const url = URL.createObjectURL(audioBlob);
        
        const newTake = {
          id: Date.now(),
          trackId: trackId,
          url,
          blob: audioBlob,
          timestamp: new Date().toLocaleTimeString(),
          sourceType: 'local'
        };
        setTakes((prev) => [newTake, ...prev]);
      };

      mediaRecorder.start();
      setIsRecording(true);
      console.log('[AudioRecorder] Recording started successfully');
    } catch (err) {
      console.error('Error recording:', err);
      alert('Error: ' + err.message);
    }
  }, []);

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
    startRecording,
    stopRecording
  };
};
