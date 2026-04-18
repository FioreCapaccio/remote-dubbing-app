import { useState, useRef, useCallback, useEffect } from 'react';

export const useAudioRecorder = (settings = { sampleRate: 44100 }, remoteStream = null) => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState(null);
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
  const mixedStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

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

  // Effect to sync remoteStream ref when prop changes
  useEffect(() => {
    remoteStreamRef.current = remoteStream;
    console.log('[AudioRecorder] remoteStream updated:', remoteStream ? 'available' : 'null');
  }, [remoteStream]);

  // VocalSync 4.0: Output Device Routing
  const setOutputDevice = async (deviceId) => {
    setSelectedOutput(deviceId);
    // In App.jsx we will apply this to audio elements
  };

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

  // Keep the ref in sync with the latest callback (must be in an effect, not during render)
  useEffect(() => {
    peakMeterCallbackRef.current = updatePeakMeter;
  }, [updatePeakMeter]);

  // VocalSync 5.0: Persistent Microphone Monitor
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
        
        // Wait for user interaction if AudioContext is blocked, but navigator.mediaDevices works fine
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!active) return stream.getTracks().forEach(t => t.stop());
        
        micStreamRef.current = stream;
        
        // Dynamic Sample Rate Injection with Safety Fallback
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
  }, [selectedDevice, updatePeakMeter, settings.sampleRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(() => {
    try {
      if (!micStreamRef.current) {
        alert("Microphone not ready.");
        return;
      }
      
      console.log('[AudioRecorder] Starting recording...');
      console.log('[AudioRecorder] Local mic stream:', micStreamRef.current ? 'available' : 'null');
      console.log('[AudioRecorder] Remote stream:', remoteStreamRef.current ? 'available' : 'null');
      
      let streamToRecord = micStreamRef.current;
      
      // Se c'è uno stream remoto, crea un mix tra microfono locale e remoto
      if (remoteStreamRef.current && audioContextRef.current) {
        try {
          const ctx = audioContextRef.current;
          const dest = ctx.createMediaStreamDestination();
          
          // Crea sorgente dal microfono locale
          const localSource = ctx.createMediaStreamSource(micStreamRef.current);
          const localGain = ctx.createGain();
          localGain.gain.value = 1.0;
          localSource.connect(localGain);
          localGain.connect(dest);
          
          // Crea sorgente dallo stream remoto
          const remoteSource = ctx.createMediaStreamSource(remoteStreamRef.current);
          const remoteGain = ctx.createGain();
          remoteGain.gain.value = 1.0;
          remoteSource.connect(remoteGain);
          remoteGain.connect(dest);
          
          streamToRecord = dest.stream;
          mixedStreamRef.current = dest;
          
          console.log('[AudioRecorder] Mixed stream created with local + remote audio');
        } catch (mixErr) {
          console.error('[AudioRecorder] Error creating mixed stream:', mixErr);
          // Fallback: usa solo il microfono locale
          streamToRecord = micStreamRef.current;
        }
      }
      
      const mediaRecorder = new MediaRecorder(streamToRecord);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const url = URL.createObjectURL(audioBlob);
        setAudioURL(url);
        
        const newTake = {
          id: Date.now(),
          url,
          blob: audioBlob,
          timestamp: new Date().toLocaleTimeString(),
        };
        setTakes((prev) => [newTake, ...prev]);
        // Do not stop the stream or generic audio context here, to keep VU meter running
        
        // Cleanup mixed stream if created
        mixedStreamRef.current = null;
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
    audioURL,
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
