import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook per la registrazione multi-traccia con sorgenti audio separate.
 * Permette di registrare simultaneamente su tracce diverse con sorgenti diverse
 * (locale, remota, o mista).
 */
export const useMultiTrackRecorder = (settings = { sampleRate: 44100 }, remoteStream = null) => {
  const [isRecording, setIsRecording] = useState(false);
  const [takes, setTakes] = useState([]);
  const [devices, setDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedOutput, setSelectedOutput] = useState('default');
  const [peakLevel, setPeakLevel] = useState(-60);
  
  const mediaRecordersRef = useRef({}); // Map: trackId -> MediaRecorder
  const audioChunksRef = useRef({}); // Map: trackId -> chunks[]
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const micStreamRef = useRef(null);
  const peakMeterCallbackRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const activeRecordingsRef = useRef([]); // Track IDs currently recording

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

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
    console.log('[MultiTrackRecorder] remoteStream updated:', remoteStream ? 'available' : 'null');
  }, [remoteStream]);

  const setOutputDevice = async (deviceId) => {
    setSelectedOutput(deviceId);
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

  useEffect(() => {
    peakMeterCallbackRef.current = updatePeakMeter;
  }, [updatePeakMeter]);

  // Inizializza il microfono locale per il monitoraggio VU
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

  /**
   * Avvia la registrazione multi-traccia.
   * @param {Array} trackConfigs - Array di { trackId, audioSource } dove audioSource è 'local'|'remote'
   */
  const startRecording = useCallback((trackConfigs = []) => {
    console.log('[MultiTrackRecorder] === START RECORDING CALLED ===');
    console.log('[MultiTrackRecorder] trackConfigs:', trackConfigs);
    console.log('[MultiTrackRecorder] micStreamRef.current:', micStreamRef.current ? 'EXISTS' : 'NULL');
    console.log('[MultiTrackRecorder] remoteStreamRef.current:', remoteStreamRef.current ? 'EXISTS' : 'NULL');
    
    try {
      if (!micStreamRef.current) {
        console.error('[MultiTrackRecorder] FATAL: micStreamRef.current is null - microphone not initialized!');
        alert("Microphone not ready. Please wait a moment and try again.");
        return;
      }
      
      // Verifica se ci sono tracce remote ma lo stream remoto non è disponibile
      const remoteTrackConfigs = trackConfigs.filter(tc => tc.audioSource === 'remote');
      console.log('[MultiTrackRecorder] Remote track configs:', remoteTrackConfigs);
      
      if (remoteTrackConfigs.length > 0 && !remoteStreamRef.current) {
        console.warn('[MultiTrackRecorder] WARNING: Remote tracks requested but remoteStream is not available!');
        console.warn('[MultiTrackRecorder] Remote tracks will fallback to local microphone.');
        // Non blocchiamo, ma le tracce remote useranno il fallback locale
      }
      
      console.log('[MultiTrackRecorder] Starting multi-track recording...');
      
      // Filtriamo solo le tracce audio (non video)
      const audioTrackConfigs = trackConfigs.filter(tc => tc.trackId !== 'video');
      
      if (audioTrackConfigs.length === 0) {
        console.warn('[MultiTrackRecorder] No audio tracks to record');
        return;
      }

      // Reset stato
      mediaRecordersRef.current = {};
      audioChunksRef.current = {};
      activeRecordingsRef.current = [];
      
      const completedRecordings = [];
      let completedCount = 0;

      audioTrackConfigs.forEach(({ trackId, audioSource }) => {
        let streamToRecord = null;
        
        // Determina quale stream registrare
        if (audioSource === 'remote') {
          if (remoteStreamRef.current) {
            streamToRecord = remoteStreamRef.current;
            console.log(`[MultiTrackRecorder] Track ${trackId}: Recording REMOTE stream ✓`);
          } else {
            // Fallback a local se remote non è disponibile
            streamToRecord = micStreamRef.current;
            console.log(`[MultiTrackRecorder] Track ${trackId}: REMOTE requested but NOT AVAILABLE - using LOCAL fallback`);
          }
        } else {
          // Default: registra il microfono locale
          streamToRecord = micStreamRef.current;
          console.log(`[MultiTrackRecorder] Track ${trackId}: Recording LOCAL stream`);
        }

        if (!streamToRecord) {
          console.warn(`[MultiTrackRecorder] No stream available for track ${trackId}`);
          return;
        }

        // Crea MediaRecorder per questa traccia
        const mediaRecorder = new MediaRecorder(streamToRecord);
        mediaRecordersRef.current[trackId] = mediaRecorder;
        audioChunksRef.current[trackId] = [];
        activeRecordingsRef.current.push(trackId);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            if (!audioChunksRef.current[trackId]) audioChunksRef.current[trackId] = [];
            audioChunksRef.current[trackId].push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const chunks = audioChunksRef.current[trackId] || [];
          if (chunks.length === 0) return;
          
          const audioBlob = new Blob(chunks, { type: 'audio/wav' });
          const url = URL.createObjectURL(audioBlob);
          
          const newTake = {
            id: `${trackId}-${Date.now()}`,
            trackId: trackId,
            url,
            blob: audioBlob,
            timestamp: new Date().toLocaleTimeString(),
            sourceType: audioSource || 'local'
          };
          
          completedRecordings.push(newTake);
          completedCount++;
          
          // Quando tutte le registrazioni sono completate, aggiorna lo stato takes
          if (completedCount === activeRecordingsRef.current.length) {
            console.log(`[MultiTrackRecorder] All ${completedCount} recordings completed`);
            setTakes((prev) => [...completedRecordings, ...prev]);
          }
        };

        mediaRecorder.start();
        console.log(`[MultiTrackRecorder] MediaRecorder started for track ${trackId}`);
      });

      setIsRecording(true);
      console.log('[MultiTrackRecorder] Multi-track recording started successfully');
    } catch (err) {
      console.error('[MultiTrackRecorder] Error starting recording:', err);
      alert('Error: ' + err.message);
    }
  }, []);

  const stopRecording = useCallback(() => {
    console.log('[MultiTrackRecorder] Stopping all recordings');
    Object.values(mediaRecordersRef.current).forEach(recorder => {
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
    });
    setIsRecording(false);
    activeRecordingsRef.current = [];
  }, []);

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
