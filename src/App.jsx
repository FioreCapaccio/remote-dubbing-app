import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings2, HardDrive, Headphones, FolderOpen, Trash2, Save, Download, Upload, Tag, Folder } from 'lucide-react';

// Hooks
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { usePeerSession } from './hooks/usePeerSession';

// Components
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './components/LandingPage';
import DawSidebar from './components/DawSidebar';
import DawTransport from './components/DawTransport';
import DawTimeline from './components/DawTimeline';
import VideoPreview from './components/VideoPreview';

// Utils
import { renderMixdown } from './utils/audioExport';
import { saveProject, loadProject, listProjects, deleteProject, exportProjectToFile, importProjectFromFile, pickDirectory, isFileSystemAccessSupported } from './utils/projectStorage';

// Styles
import './index.css';

const App = () => {
  // Routing State
  const [view, setView] = useState('landing'); // 'landing' or 'app'

  // Application State
  const [videoURL, setVideoURL] = useState(null);
  const [videoFileName, setVideoFileName] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Layout Management (2D Resizing)
  const [videoHeight, setVideoHeight] = useState(300);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [zoomLevel, setZoomLevel] = useState(20);
  const isResizingVertical = useRef(false);
  const isResizingHorizontal = useRef(false);
  const isScrubbingRef = useRef(false);

  // DAW State
  const [roomName, setRoomName] = useState('');
  const [sessionRole, setSessionRole] = useState('host');
  const [tracks, setTracks] = useState([
    { id: 'video', name: 'ORIGINAL FILMAUDIO', volume: 1, muted: false, solo: false, type: 'video', clips: [] },
    { id: 'track-1', name: 'LEAD VOCAL', volume: 1, muted: false, solo: false, type: 'audio', clips: [], recEnabled: true }
  ]);
  const [selectedTrackId, setSelectedTrackId] = useState('track-1');
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [draggingClip, setDraggingClip] = useState(null);
  const dragStartRef = useRef(null);

  // Internal playhead timer (used when no video is loaded)
  const playheadTimerRef = useRef(null);
  const internalTimeRef = useRef(0); // always-current playhead position

  // Cue List
  const [cues, setCues] = useState([]);

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const [isExporting, setIsExporting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [audioSettings, setAudioSettings] = useState({
    sampleRate: 48000,
    bitDepth: 24,
    format: 'wav'
  });
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Countdown State
  const [countdown, setCountdown] = useState(null);
  const countdownIntervalRef = useRef(null);

  // Project Management State
  const [savedProjects, setSavedProjects] = useState([]);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectModalMode, setProjectModalMode] = useState('save'); // 'save' or 'load'
  const [projectName, setProjectName] = useState('');
  const [projectCategory, setProjectCategory] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFilename, setExportFilename] = useState('');
  const [exportDirectoryHandle, setExportDirectoryHandle] = useState(null);
  const [exportDirectoryName, setExportDirectoryName] = useState('');
  const [saveDirectoryHandle, setSaveDirectoryHandle] = useState(null);
  const [saveDirectoryName, setSaveDirectoryName] = useState('');

  const videoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const sendCommandRef = useRef(null);
  const startRecordingRef = useRef(null);
  const stopRecordingRef = useRef(null);
  const handleRemoteCommandRef = useRef(null);

  // Peer session hook
  const handleRemoteCommandWrapper = useCallback((cmd) => {
    if (handleRemoteCommandRef.current) {
      handleRemoteCommandRef.current(cmd);
    }
  }, []);

  const { peerId, isConnected, connectionStatus, connectionError, sendCommand, remoteStream, startTalkback, stopTalkback } = usePeerSession(roomName, sessionRole, handleRemoteCommandWrapper);

  // Hook per la registrazione audio - semplificato, solo mic locale
  const { 
    isRecording, takes, devices, outputDevices, selectedDevice, setSelectedDevice, 
    selectedOutput, setOutputDevice, peakLevel, startRecording, stopRecording 
  } = useAudioRecorder(audioSettings);

  // Sync recording functions to refs for handleRemoteCommand
  useEffect(() => {
    startRecordingRef.current = startRecording;
    stopRecordingRef.current = stopRecording;
  }, [startRecording, stopRecording]);

  // Sync Logic
  const recordStartTime = useRef(0);
  const lastProcessedTake = useRef(null);

  // Keep internalTimeRef in sync with currentTime state (for when the timer is not running)
  useEffect(() => {
    internalTimeRef.current = currentTime;
  }, [currentTime]);

  // ── Internal Playhead Timer (no-video mode) ────────────────────────────────
  const startInternalPlayhead = useCallback((fromTime) => {
    if (playheadTimerRef.current) clearInterval(playheadTimerRef.current);
    const startTs = Date.now();
    const base = fromTime;
    internalTimeRef.current = base;
    playheadTimerRef.current = setInterval(() => {
      const t = base + (Date.now() - startTs) / 1000;
      internalTimeRef.current = t;
      setCurrentTime(t);
    }, 100); // ~10fps updates for UI
  }, []);

  const stopInternalPlayhead = useCallback(() => {
    if (playheadTimerRef.current) {
      clearInterval(playheadTimerRef.current);
      playheadTimerRef.current = null;
    }
  }, []);

  // ── Countdown helpers ──────────────────────────────────────────────────────
  const cancelCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(null);
  }, []);

  const startCountdownDisplay = useCallback((onComplete) => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setCountdown(3);
    let count = 3;
    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
        setCountdown(null);
        if (onComplete) onComplete();
      } else {
        setCountdown(count);
      }
    }, 1000);
  }, []);

  // ── Cue List Handlers ──────────────────────────────────────────────────────
  const handleAddCue = useCallback((time) => {
    const actualTime = time ?? (videoRef.current?.currentTime ?? internalTimeRef.current);
    const newCue = {
      id: Date.now(),
      timeIn: actualTime,
      timeOut: null,
      character: '',
      text: '',
      status: 'todo'
    };
    const newCues = [...cues, newCue].sort((a, b) => a.timeIn - b.timeIn);
    setCues(newCues);
    if (sendCommandRef.current) sendCommandRef.current({ type: 'CUE_SYNC', cues: newCues });
  }, [cues]);

  const handleUpdateCue = useCallback((id, field, value) => {
    let newCues = cues.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, [field]: value };
      // When timeIn changes, also update timeOut to maintain consistent duration
      if (field === 'timeIn' && c.timeOut != null) {
        const duration = c.timeOut - c.timeIn;
        updated.timeOut = value + duration;
      }
      return updated;
    });
    if (field === 'timeIn') newCues = newCues.sort((a, b) => a.timeIn - b.timeIn);
    setCues(newCues);
    if (sendCommandRef.current) sendCommandRef.current({ type: 'CUE_SYNC', cues: newCues });
  }, [cues]);

  const handleDeleteCue = useCallback((id) => {
    const newCues = cues.filter(c => c.id !== id);
    setCues(newCues);
    if (sendCommandRef.current) sendCommandRef.current({ type: 'CUE_SYNC', cues: newCues });
  }, [cues]);

  const handleImportCues = useCallback((newCues) => {
    const mergedCues = [...cues, ...newCues].sort((a, b) => a.timeIn - b.timeIn);
    setCues(mergedCues);
    if (sendCommandRef.current) sendCommandRef.current({ type: 'CUE_SYNC', cues: mergedCues });
  }, [cues]);

  const handlePrevCue = useCallback(() => {
    const ct = videoRef.current?.currentTime ?? internalTimeRef.current;
    const prev = [...cues].sort((a, b) => a.timeIn - b.timeIn).reverse().find(c => c.timeIn < ct - 0.1);
    if (prev) {
      if (videoRef.current) videoRef.current.currentTime = prev.timeIn;
      internalTimeRef.current = prev.timeIn;
      setCurrentTime(prev.timeIn);
      if (sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: prev.timeIn });
    }
  }, [cues]);

  const handleNextCue = useCallback(() => {
    const ct = videoRef.current?.currentTime ?? internalTimeRef.current;
    const next = [...cues].sort((a, b) => a.timeIn - b.timeIn).find(c => c.timeIn > ct + 0.1);
    if (next) {
      if (videoRef.current) videoRef.current.currentTime = next.timeIn;
      internalTimeRef.current = next.timeIn;
      setCurrentTime(next.timeIn);
      if (sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: next.timeIn });
    }
  }, [cues]);

  // ── Chat Handlers ──────────────────────────────────────────────────────────
  const handleSendChat = useCallback((text) => {
    if (!text.trim()) return;
    const msg = {
      id: Date.now(),
      sender: sessionRole === 'host' ? 'director' : 'actor',
      text: text.trim(),
      timestamp: Date.now()
    };
    setChatMessages(prev => [...prev, msg]);
    if (sendCommandRef.current) {
      sendCommandRef.current({ type: 'CHAT', sender: msg.sender, text: msg.text, timestamp: msg.timestamp });
    }
  }, [sessionRole]);

  const handleChatRead = useCallback(() => {
    setUnreadChatCount(0);
  }, []);

  // Compute active cue based on playhead position
  const activeCue = cues.find(c => {
    const end = c.timeOut != null ? c.timeOut : c.timeIn + 3;
    return currentTime >= c.timeIn && currentTime < end;
  }) || null;

  // ── Action Handlers ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    // Pause playback
    if (videoRef.current) {
      videoRef.current.pause();
    } else {
      stopInternalPlayhead();
    }
    setIsPlaying(false);
    
    // Reset to beginning
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    internalTimeRef.current = 0;
    setCurrentTime(0);
    
    // Send SEEK command if connected
    if (sendCommandRef.current) {
      sendCommandRef.current({ type: 'PAUSE' });
      sendCommandRef.current({ type: 'SEEK', time: 0 });
    }
  }, [stopInternalPlayhead]);

  // Debounce ref for REC button to prevent double-triggering
  const isProcessingRecRef = useRef(false);

  const handleTogglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) { videoRef.current.pause(); if (sendCommandRef.current) sendCommandRef.current({ type: 'PAUSE' }); }
      else { videoRef.current.play(); if (sendCommandRef.current) sendCommandRef.current({ type: 'PLAY' }); }
      setIsPlaying(!isPlaying);
    } else {
      // No video loaded: use internal timer
      if (isPlaying) {
        stopInternalPlayhead();
        setIsPlaying(false);
      } else {
        startInternalPlayhead(internalTimeRef.current);
        setIsPlaying(true);
      }
    }
  }, [isPlaying, startInternalPlayhead, stopInternalPlayhead]);

  const handleStartProcess = useCallback(() => {
    // Prevent double-triggering with debounce
    if (isProcessingRecRef.current) {
      console.log('[App] REC button debounced - ignoring duplicate call');
      return;
    }
    isProcessingRecRef.current = true;
    setTimeout(() => { isProcessingRecRef.current = false; }, 500);

    console.log('[App] === REC BUTTON PRESSED ===');
    console.log('[App] isRecording:', isRecording, '| countdown:', countdown);
    console.log('[App] sessionRole:', sessionRole, '| isConnected:', isConnected);
    console.log('[App] selectedTrackId:', selectedTrackId);
    
    if (isRecording) {
      console.log('[App] Stopping recording...');
      stopRecording();
      if (videoRef.current) videoRef.current.pause();
      else stopInternalPlayhead();
      setIsPlaying(false);
      if (sendCommandRef.current) sendCommandRef.current({ type: 'PAUSE' });
      return;
    }
    if (countdown !== null) {
      console.log('[App] Cancelling countdown...');
      cancelCountdown();
      if (sendCommandRef.current) sendCommandRef.current({ type: 'COUNTDOWN_CANCEL' });
      return;
    }
    
    console.log('[App] Starting countdown and sending COUNTDOWN_START command...');
    if (sendCommandRef.current) sendCommandRef.current({ type: 'COUNTDOWN_START' });
    startCountdownDisplay(() => {
      const startTime = videoRef.current ? videoRef.current.currentTime : internalTimeRef.current;
      recordStartTime.current = startTime;
      console.log('[App] Countdown complete, recording on track:', selectedTrackId);
      
      // Avvia registrazione semplice sul mic locale
      startRecording(selectedTrackId);
      
      if (videoRef.current) {
        requestAnimationFrame(() => {
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
          if (sendCommandRef.current) sendCommandRef.current({ type: 'REC_START' });
        });
      } else {
        startInternalPlayhead(startTime);
        setIsPlaying(true);
        if (sendCommandRef.current) sendCommandRef.current({ type: 'REC_START' });
      }
    });
  }, [isRecording, countdown, cancelCountdown, startCountdownDisplay, stopRecording, startRecording, startInternalPlayhead, stopInternalPlayhead, selectedTrackId]);

  // Define handleRemoteCommand and sync to ref
  const handleRemoteCommand = useCallback((cmd) => {
    switch (cmd.type) {
      case 'PLAY':
        if (videoRef.current) { videoRef.current.play(); }
        else { startInternalPlayhead(internalTimeRef.current); }
        setIsPlaying(true);
        break;
      case 'PAUSE':
        if (videoRef.current) { videoRef.current.pause(); }
        else { stopInternalPlayhead(); }
        setIsPlaying(false);
        break;
      case 'REC_START':
        recordStartTime.current = videoRef.current ? videoRef.current.currentTime : internalTimeRef.current;
        // Il doppiatore (actor) registra il proprio microfono quando il direttore preme REC
        if (startRecordingRef.current) {
          startRecordingRef.current(selectedTrackId);
        }
        if (videoRef.current) {
          requestAnimationFrame(() => {
            videoRef.current.play().catch(() => {});
            setIsPlaying(true);
          });
        } else {
          startInternalPlayhead(recordStartTime.current);
          setIsPlaying(true);
        }
        break;
      case 'COUNTDOWN_START':
        startCountdownDisplay(null);
        break;
      case 'COUNTDOWN_CANCEL':
        cancelCountdown();
        break;
      case 'SEEK': 
        if (videoRef.current) videoRef.current.currentTime = cmd.time;
        internalTimeRef.current = cmd.time;
        setCurrentTime(cmd.time);
        break;
      case 'CUE_SYNC':
        if (Array.isArray(cmd.cues)) setCues(cmd.cues);
        break;
      case 'CHAT':
        setChatMessages(prev => [...prev, { id: Date.now(), sender: cmd.sender, text: cmd.text, timestamp: cmd.timestamp }]);
        setUnreadChatCount(prev => prev + 1);
        break;
      default: break;
    }
  }, [startCountdownDisplay, cancelCountdown, startInternalPlayhead, stopInternalPlayhead, selectedTrackId]);

  // Sync handleRemoteCommand to ref so usePeerSession can use it
  useEffect(() => {
    handleRemoteCommandRef.current = handleRemoteCommand;
  }, [handleRemoteCommand]);

  useEffect(() => {
    sendCommandRef.current = sendCommand;
  }, [sendCommand]);

  // ── Sync Engine ────────────────────────────────────────────────────────────
  // Runs on every animation frame during playback to sync all audio clips.
  // Uses internalTimeRef so it doesn't restart when currentTime state changes.
  useEffect(() => {
    let animationId;
    // Include ALL track types in hasSolo so soloing an audio track mutes the video too
    const hasSolo = tracks.some(t => t.solo);
    const syncEngine = () => {
      const exactTime = videoRef.current ? videoRef.current.currentTime : internalTimeRef.current;
      tracks.forEach(track => {
        const effectiveMuted = track.muted || (hasSolo && !track.solo);
        if (track.type === 'video') {
          // Apply mute/volume/solo to the video element directly
          if (videoRef.current) {
            videoRef.current.volume = effectiveMuted ? 0 : Math.max(0, Math.min(1, track.volume));
          }
          return;
        }
        track.clips.forEach(clip => {
          const audioEl = document.getElementById(clip.id);
          if (!audioEl) return;
          audioEl.volume = effectiveMuted ? 0 : Math.max(0, Math.min(1, track.volume * (clip.gain ?? 1)));
          const clipEnd = clip.startTime + clip.duration;
          if (isPlaying && exactTime >= clip.startTime && exactTime <= clipEnd) {
            const expectedTime = (exactTime - clip.startTime) + (clip.mediaOffset || 0);
            if (audioEl.paused || Math.abs(audioEl.currentTime - expectedTime) > 0.1) {
              audioEl.currentTime = expectedTime;
              if (audioEl.paused) audioEl.play().catch(() => {});
            }
          } else if (!audioEl.paused) {
            audioEl.pause();
          }
        });
      });
      animationId = requestAnimationFrame(syncEngine);
    };

    if (isPlaying) animationId = requestAnimationFrame(syncEngine);
    else {
      tracks.forEach(t => t.clips.forEach(c => {
        const el = document.getElementById(c.id);
        if (el && !el.paused) el.pause();
      }));
    }
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying, tracks]);

  // Apply volume / mute / solo / gain immediately on track state changes (works even when paused)
  useEffect(() => {
    const hasSolo = tracks.some(t => t.solo);
    tracks.forEach(track => {
      const effectiveMuted = track.muted || (hasSolo && !track.solo);
      if (track.type === 'video') {
        if (videoRef.current) {
          videoRef.current.volume = effectiveMuted ? 0 : Math.max(0, Math.min(1, track.volume));
        }
        return;
      }
      track.clips.forEach(clip => {
        const el = document.getElementById(clip.id);
        if (!el) return;
        el.volume = effectiveMuted ? 0 : Math.max(0, Math.min(1, track.volume * (clip.gain ?? 1)));
      });
    });
  }, [tracks]);

  // ── Project Management Handlers ────────────────────────────────────────────
  const handleNewProject = useCallback(() => {
    if (confirm('Create a new project? All unsaved changes will be lost.')) {
      // Reset all state to default
      setCues([]);
      setTracks([
        { id: 'video', name: 'ORIGINAL FILMAUDIO', volume: 1, muted: false, solo: false, type: 'video', clips: [] },
        { id: 'track-1', name: 'LEAD VOCAL', volume: 1, muted: false, solo: false, type: 'audio', clips: [], recEnabled: true }
      ]);
      setSelectedTrackId('track-1');
      setSelectedClipId(null);
      setVideoURL(null);
      setVideoFileName(null);
      setCurrentTime(0);
      internalTimeRef.current = 0;
      setDuration(0);
      setChatMessages([]);
      setProjectName('');
      
      // Stop any playback
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
      stopInternalPlayhead();
      setIsPlaying(false);
    }
  }, [stopInternalPlayhead]);

  const handleSaveProject = useCallback(async () => {
    setProjectModalMode('save');
    setProjectName(videoFileName ? videoFileName.replace(/\.[^/.]+$/, '') : 'Untitled Project');
    setProjectCategory('');
    setProjectDescription('');
    setSaveDirectoryHandle(null);
    setSaveDirectoryName('');
    setShowProjectModal(true);
  }, [videoFileName]);

  const handleConfirmSaveProject = useCallback(async () => {
    const name = projectName.trim();
    if (!name) {
      alert('Please enter a project name');
      return;
    }
    
    try {
      const state = {
        cues,
        tracks,
        audioSettings,
        videoFileName
      };
      const options = {
        category: projectCategory.trim(),
        description: projectDescription.trim()
      };
      
      // Salva sempre in IndexedDB come backup/indice
      const savedProject = await saveProject(name, state, options);
      
      // Se è stata selezionata una cartella, salva anche come file JSON
      if (saveDirectoryHandle) {
        const filename = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_VocalSync.json`;
        await exportProjectToFile(name, state, {
          ...options,
          filename,
          directoryHandle: saveDirectoryHandle
        });
        alert(`Project "${name}" saved to folder "${saveDirectoryName}" and indexed!`);
      } else {
        alert(`Project "${name}" saved successfully!`);
      }
      
      setShowProjectModal(false);
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save project. Please try again.');
    }
  }, [cues, tracks, audioSettings, videoFileName, projectName, projectCategory, projectDescription, saveDirectoryHandle, saveDirectoryName]);

  const handleExportProject = useCallback(async () => {
    const name = projectName || videoFileName?.replace(/\.[^/.]+$/, '') || 'Untitled Project';
    setExportFilename(`${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_VocalSync.json`);
    setExportDirectoryHandle(null);
    setExportDirectoryName('');
    setShowExportModal(true);
  }, [projectName, videoFileName]);

  const handleConfirmExport = useCallback(async () => {
    const name = projectName || videoFileName?.replace(/\.[^/.]+$/, '') || 'Untitled Project';
    try {
      const state = {
        cues,
        tracks,
        audioSettings,
        videoFileName
      };
      const options = {
        category: projectCategory,
        description: projectDescription,
        filename: exportFilename,
        directoryHandle: exportDirectoryHandle
      };
      await exportProjectToFile(name, state, options);
      setShowExportModal(false);
      
      if (exportDirectoryHandle) {
        alert(`Project exported as "${exportFilename}" to folder "${exportDirectoryName}"`);
      } else {
        alert(`Project exported as "${exportFilename}"`);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export project. Please try again.');
    }
  }, [cues, tracks, audioSettings, videoFileName, projectName, projectCategory, projectDescription, exportFilename, exportDirectoryHandle, exportDirectoryName]);

  const handlePickSaveDirectory = useCallback(async () => {
    try {
      const dirHandle = await pickDirectory();
      if (dirHandle) {
        setSaveDirectoryHandle(dirHandle);
        setSaveDirectoryName(dirHandle.name);
      }
    } catch (err) {
      console.error('Failed to pick directory:', err);
      alert('Failed to select directory. Please try again.');
    }
  }, []);

  const handlePickExportDirectory = useCallback(async () => {
    try {
      const dirHandle = await pickDirectory();
      if (dirHandle) {
        setExportDirectoryHandle(dirHandle);
        setExportDirectoryName(dirHandle.name);
      }
    } catch (err) {
      console.error('Failed to pick directory:', err);
      alert('Failed to select directory. Please try again.');
    }
  }, []);

  const handleImportProjectFromFile = useCallback(async (file) => {
    try {
      const project = await importProjectFromFile(file);
      const projects = await listProjects();
      setSavedProjects(projects);
      alert(`Project "${project.name}" imported successfully!`);
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import project. Please check the file format.');
    }
  }, []);

  const handleLoadProjectClick = useCallback(async () => {
    try {
      const projects = await listProjects();
      setSavedProjects(projects);
      setProjectModalMode('load');
      setShowProjectModal(true);
    } catch (err) {
      console.error('Failed to list projects:', err);
      alert('Failed to load projects list.');
    }
  }, []);

  const handleLoadProject = useCallback(async (projectId) => {
    try {
      const project = await loadProject(projectId);
      
      // Stop playback before loading
      if (videoRef.current) videoRef.current.pause();
      stopInternalPlayhead();
      setIsPlaying(false);
      
      // Load project data
      setCues(project.cues || []);
      setTracks(project.tracks || [
        { id: 'video', name: 'ORIGINAL FILMAUDIO', volume: 1, muted: false, solo: false, type: 'video', clips: [] },
        { id: 'track-1', name: 'LEAD VOCAL', volume: 1, muted: false, solo: false, type: 'audio', clips: [], recEnabled: true }
      ]);
      setAudioSettings(project.audioSettings || { sampleRate: 48000, bitDepth: 24, format: 'wav' });
      setVideoFileName(project.videoFileName || null);
      setProjectName(project.name);
      
      // Reset time
      setCurrentTime(0);
      internalTimeRef.current = 0;
      if (videoRef.current) videoRef.current.currentTime = 0;
      
      setShowProjectModal(false);
      alert(`Project "${project.name}" loaded successfully!`);
    } catch (err) {
      console.error('Load failed:', err);
      alert('Failed to load project. Please try again.');
    }
  }, [stopInternalPlayhead]);

  const handleDeleteSavedProject = useCallback(async (projectId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this project? This cannot be undone.')) return;
    
    try {
      await deleteProject(projectId);
      setSavedProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete project.');
    }
  }, []);

  // ── Layout & Drag Listeners ────────────────────────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingHorizontal.current) setSidebarWidth(Math.max(240, Math.min(e.clientX, 520)));
      if (isResizingVertical.current) setVideoHeight(Math.max(150, Math.min(e.clientY - 120, window.innerHeight - 300)));
      if (isScrubbingRef.current) {
        const timeline = document.querySelector('.timeline-daw-integrated');
        if (timeline) {
          const rect = timeline.getBoundingClientRect();
          const maxTime = duration > 0 ? duration : 600;
          const newTime = Math.max(0, Math.min((e.clientX - rect.left + timeline.scrollLeft - sidebarWidth) / zoomLevel, maxTime));
          if (videoRef.current) videoRef.current.currentTime = newTime;
          internalTimeRef.current = newTime;
          setCurrentTime(newTime);
        }
      }
      if (dragStartRef.current?.clipId) {
        const deltaTime = (e.clientX - dragStartRef.current.startX) / zoomLevel;
        const newStart = Math.max(0, dragStartRef.current.clipStartTime + deltaTime);
        setTracks(prev => prev.map(t => t.id === dragStartRef.current.trackId ? {
          ...t, clips: t.clips.map(c => c.id === dragStartRef.current.clipId ? { ...c, startTime: newStart } : c)
        } : t));
      }
    };
    const handleMouseUp = () => {
      isResizingVertical.current = false; isResizingHorizontal.current = false; isScrubbingRef.current = false;
      dragStartRef.current = null; setDraggingClip(null); document.body.style.cursor = 'default';
      if (videoRef.current && sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: videoRef.current.currentTime });
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [duration, zoomLevel, sidebarWidth]);

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape' && countdown !== null) {
        cancelCountdown();
        if (sendCommandRef.current) sendCommandRef.current({ type: 'COUNTDOWN_CANCEL' });
        return;
      }
      if (e.key === ' ') { e.preventDefault(); handleTogglePlay(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.key === 'ArrowRight' ? 0.5 : -0.5;
        const newTime = Math.max(0, (videoRef.current?.currentTime ?? internalTimeRef.current) + step);
        if (videoRef.current) videoRef.current.currentTime = newTime;
        internalTimeRef.current = newTime;
        setCurrentTime(newTime);
        if (sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: newTime });
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        setTracks(prev => prev.map(t => ({ ...t, clips: t.clips.filter(c => c.id !== selectedClipId) })));
        setSelectedClipId(null);
      }
      // Split clip at playhead (S or Ctrl+K)
      if ((e.key === 's' || (e.ctrlKey && e.key === 'k')) && selectedClipId) {
        e.preventDefault();
        setTracks(prev => {
          let found = false;
          return prev.map(track => {
            if (found) return track;
            const clipIdx = track.clips.findIndex(c => c.id === selectedClipId);
            if (clipIdx === -1) return track;
            const clip = track.clips[clipIdx];
            const splitPoint = currentTime;
            if (splitPoint <= clip.startTime + 0.01 || splitPoint >= clip.startTime + clip.duration - 0.01) return track;
            const firstDuration = splitPoint - clip.startTime;
            const secondDuration = clip.duration - firstDuration;
            const newClips = [...track.clips];
            newClips.splice(clipIdx, 1,
              { ...clip, duration: firstDuration },
              { ...clip, id: `${clip.id}-s${Date.now()}`, startTime: splitPoint, duration: secondDuration, mediaOffset: (clip.mediaOffset || 0) + firstDuration }
            );
            found = true;
            return { ...track, clips: newClips };
          });
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay, selectedClipId, countdown, cancelCountdown, currentTime]);

  // ── Process Recorded Takes ─────────────────────────────────────────────────
  useEffect(() => {
    // Processa tutti i takes non ancora processati
    const processedIds = new Set();
    takes.forEach(take => {
      if (!lastProcessedTake.current || !lastProcessedTake.current.includes(take.id)) {
        processedIds.add(take.id);
        
        // Use internalTimeRef for accurate duration even without video
        const tDuration = internalTimeRef.current - recordStartTime.current;
        
        // Determina su quale traccia aggiungere il clip
        // Se il take ha un trackId, usa quella traccia, altrimenti usa la traccia selezionata
        const targetTrackId = take.trackId || selectedTrackId;
        
        setTracks(prev => prev.map(t => t.id === targetTrackId ? {
          ...t, clips: [...t.clips, {
            id: `clip-${take.id}`,
            url: take.url,
            startTime: recordStartTime.current,
            duration: tDuration > 0 ? tDuration : 2,
            gain: 1,
            sourceType: take.sourceType || 'local'
          }]
        } : t));
      }
    });
    
    // Aggiorna l'ultimo take processato
    if (processedIds.size > 0) {
      lastProcessedTake.current = Array.from(processedIds);
    }
  }, [takes, selectedTrackId]);

  // ── Export Mixdown ─────────────────────────────────────────────────────────
  const handleExportMixdown = async () => {
    // Compute effective duration from clips if no video is loaded
    const effectiveDuration = duration > 0 ? duration :
      tracks.reduce((max, t) => t.clips.reduce((m, c) => Math.max(m, c.startTime + c.duration), max), 0);
    if (effectiveDuration <= 0 || isExporting) return;
    try {
      setIsExporting(true);
      const blob = await renderMixdown(tracks, effectiveDuration, videoURL, audioSettings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `VocalSync_Mixdown_${Date.now()}.wav`; a.click();
    } catch { alert("Export error"); } finally { setIsExporting(false); }
  };

  // ── Audio File Drop ────────────────────────────────────────────────────────
  const handleDrop = async (e) => {
    e.preventDefault(); setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    const rect = e.currentTarget.getBoundingClientRect();
    const dropTime = Math.max(0, (e.clientX - rect.left + e.currentTarget.scrollLeft - sidebarWidth) / zoomLevel);
    for (const f of files) {
      const url = URL.createObjectURL(f); const audio = new Audio(url);
      await new Promise(r => { audio.onloadedmetadata = r; audio.onerror = r; });
      setTracks(prev => [...prev, {
        id: `dropped-${Date.now()}`, name: f.name.toUpperCase(), volume: 1, muted: false, solo: false, type: 'audio',
        clips: [{ id: `clip-${Date.now()}`, url, startTime: dropTime, duration: audio.duration || 5, gain: 1 }]
      }]);
    }
  };

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      if (remoteAudioRef.current.setSinkId) remoteAudioRef.current.setSinkId(selectedOutput);
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream, selectedOutput]);

  if (view === 'landing') return <LandingPage onLaunch={() => setView('app')} />;

  return (
    <ErrorBoundary>
      <div className="app-container" onMouseUp={() => setDraggingClip(null)}>
        <DawSidebar 
          sidebarWidth={sidebarWidth} roomName={roomName} setRoomName={setRoomName}
          isConnected={isConnected} connectionStatus={connectionStatus} connectionError={connectionError} peerId={peerId}
          sessionRole={sessionRole} setSessionRole={setSessionRole}
          startTalkback={startTalkback} stopTalkback={stopTalkback}
          cues={cues}
          onAddCue={handleAddCue}
          onUpdateCue={handleUpdateCue}
          onDeleteCue={handleDeleteCue}
          onPrevCue={handlePrevCue}
          onNextCue={handleNextCue}
          activeCue={activeCue}
          peakLevel={peakLevel} isExporting={isExporting} handleExportMixdown={handleExportMixdown}
          setShowSettings={setShowSettings} videoRef={videoRef} setCurrentTime={setCurrentTime}
          chatMessages={chatMessages}
          unreadChatCount={unreadChatCount}
          onSendChat={handleSendChat}
          onChatRead={handleChatRead}
          tracks={tracks}
          audioSettings={audioSettings}
          videoFileName={videoFileName}
        />
        <div className="layout-divider-v" onMouseDown={(e) => { e.preventDefault(); isResizingHorizontal.current = true; document.body.style.cursor = 'col-resize'; }} />
        <main className="main-content">
          <DawTransport 
            isPlaying={isPlaying} handleTogglePlay={handleTogglePlay} handleStop={handleStop}
            isRecording={isRecording} handleStartProcess={handleStartProcess}
            currentTime={currentTime} duration={duration} videoURL={videoURL} videoFileName={videoFileName}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            onSaveProject={handleSaveProject}
            onLoadProject={handleLoadProjectClick}
            onNewProject={handleNewProject}
            onExportProject={handleExportProject}
            onImportCues={handleImportCues}
          />
          <VideoPreview 
            videoHeight={videoHeight} videoURL={videoURL} videoRef={videoRef}
            setCurrentTime={setCurrentTime} setDuration={setDuration} currentTime={currentTime}
            countdown={countdown}
            activeCue={activeCue}
            cues={cues}
            setVideoURL={(url, name) => { setVideoURL(url); if (name) setVideoFileName(name); }}
          />
          <div className="layout-divider-h" onMouseDown={(e) => { e.preventDefault(); isResizingVertical.current = true; document.body.style.cursor = 'row-resize'; }} />
          <DawTimeline 
            isDraggingOver={isDraggingOver} handleDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
            handleDragLeave={() => setIsDraggingOver(false)} handleDrop={handleDrop}
            isScrubbing={isScrubbingRef} duration={duration} sidebarWidth={sidebarWidth}
            zoomLevel={zoomLevel} videoRef={videoRef} setCurrentTime={setCurrentTime}
            cues={cues} onAddCue={handleAddCue} onUpdateCue={handleUpdateCue}
            tracks={tracks} setTracks={setTracks}
            selectedTrackId={selectedTrackId} setSelectedTrackId={setSelectedTrackId}
            selectedClipId={selectedClipId} setSelectedClipId={setSelectedClipId}
            draggingClip={draggingClip} setDraggingClip={setDraggingClip} dragStartRef={dragStartRef}
            videoURL={videoURL} currentTime={currentTime}
            activeCue={activeCue}
            internalTimeRef={internalTimeRef}
          />
        </main>
        <audio ref={remoteAudioRef} style={{ display: 'none' }} />
        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
             <div className="settings-modal" onClick={e => e.stopPropagation()}>
                <h2><Settings2 /> RECORDING PARAMETERS</h2>
                <div className="settings-grid">
                   <div className="setting-item">
                      <label>Sample Rate</label>
                      <select value={audioSettings.sampleRate} onChange={e => setAudioSettings({...audioSettings, sampleRate: parseInt(e.target.value)})}>
                         <option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option><option value={96000}>96 kHz</option>
                      </select>
                   </div>
                   <div className="setting-item">
                      <label>Bit Depth</label>
                      <select value={audioSettings.bitDepth} onChange={e => setAudioSettings({...audioSettings, bitDepth: parseInt(e.target.value)})}>
                         <option value={16}>16-bit</option><option value={24}>24-bit</option><option value={32}>32-bit</option>
                      </select>
                   </div>
                </div>
                <h2 style={{ marginTop: '1.5rem' }}><HardDrive /> AUDIO INPUT</h2>
                <div className="settings-grid">
                   <div className="setting-item">
                      <label>Input Device</label>
                      <select value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}>
                         {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Input Device'}</option>)}
                      </select>
                   </div>
                </div>
                <h2 style={{ marginTop: '1.5rem' }}><Headphones /> MONITORING OUTPUT</h2>
                <div className="settings-grid">
                   <div className="setting-item">
                      <label>Output Device</label>
                      <select value={selectedOutput} onChange={e => setOutputDevice(e.target.value)}>
                         <option value="default">System Default</option>
                         {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Output Device'}</option>)}
                      </select>
                   </div>
                </div>
                <div className="modal-actions"><button className="btn-close" onClick={() => setShowSettings(false)}>DONE</button></div>
             </div>
          </div>
        )}
        
        {/* Project Load Modal */}
        {showProjectModal && projectModalMode === 'load' && (
          <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
            <div className="settings-modal project-modal project-modal-enhanced" onClick={e => e.stopPropagation()}>
              <h2><FolderOpen /> LOAD PROJECT</h2>
              
              {/* Category Filter */}
              {savedProjects.some(p => p.category) && (
                <div className="project-filter">
                  <Folder size={14} />
                  <select 
                    value={selectedCategoryFilter} 
                    onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                  >
                    <option value="">All Categories</option>
                    {[...new Set(savedProjects.map(p => p.category).filter(Boolean))].map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Import from File */}
              <div className="project-import-section">
                <label className="project-import-label">
                  <Upload size={14} />
                  Import from file:
                  <input 
                    type="file" 
                    accept=".json" 
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) handleImportProjectFromFile(file);
                      e.target.value = '';
                    }}
                    style={{ display: 'none' }}
                  />
                  <span className="project-import-btn">Choose File</span>
                </label>
              </div>

              <div className="project-list">
                {savedProjects.length === 0 ? (
                  <div className="project-empty">No saved projects found.</div>
                ) : (
                  savedProjects
                    .filter(p => !selectedCategoryFilter || p.category === selectedCategoryFilter)
                    .map(project => (
                    <div 
                      key={project.id} 
                      className="project-item"
                      onClick={() => handleLoadProject(project.id)}
                    >
                      <div className="project-info">
                        <div className="project-name">
                          {project.name}
                          {project.category && (
                            <span className="project-category-badge">{project.category}</span>
                          )}
                        </div>
                        <div className="project-meta">
                          {new Date(project.timestamp).toLocaleDateString()} • {project.cueCount} cues • {project.clipCount} clips
                        </div>
                        {project.description && (
                          <div className="project-description">{project.description}</div>
                        )}
                      </div>
                      <button 
                        className="project-delete-btn"
                        onClick={(e) => handleDeleteSavedProject(project.id, e)}
                        title="Delete project"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="modal-actions">
                <button className="btn-close btn-secondary" onClick={() => setShowProjectModal(false)}>CANCEL</button>
              </div>
            </div>
          </div>
        )}

        {/* Project Save Modal */}
        {showProjectModal && projectModalMode === 'save' && (
          <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
            <div className="settings-modal project-modal project-modal-enhanced" onClick={e => e.stopPropagation()}>
              <h2><Save /> SAVE PROJECT</h2>
              
              <div className="project-form">
                <div className="project-form-field">
                  <label><FolderOpen size={14} /> Project Name *</label>
                  <input 
                    type="text" 
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter project name..."
                    autoFocus
                  />
                </div>

                <div className="project-form-field">
                  <label><Folder size={14} /> Category / Path</label>
                  <input 
                    type="text" 
                    value={projectCategory}
                    onChange={(e) => setProjectCategory(e.target.value)}
                    placeholder="e.g., Projects/ADR/Scene1"
                    list="category-suggestions"
                  />
                  <datalist id="category-suggestions">
                    {[...new Set(savedProjects.map(p => p.category).filter(Boolean))].map(cat => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                  <span className="field-hint">Organize projects into virtual folders</span>
                </div>

                <div className="project-form-field">
                  <label><Tag size={14} /> Description</label>
                  <textarea 
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                    placeholder="Optional description..."
                    rows={3}
                  />
                </div>

                {isFileSystemAccessSupported() && (
                  <div className="project-form-field">
                    <label><HardDrive size={14} /> Save Location</label>
                    <div className="directory-picker">
                      <button 
                        className="btn-secondary btn-pick-dir"
                        onClick={handlePickSaveDirectory}
                      >
                        <Folder size={16} /> 
                        {saveDirectoryHandle ? 'Change Folder' : 'Choose Folder'}
                      </button>
                      {saveDirectoryHandle && (
                        <span className="selected-dir">
                          <Folder size={14} /> {saveDirectoryName}
                        </span>
                      )}
                    </div>
                    <span className="field-hint">
                      {saveDirectoryHandle 
                        ? 'Project will be saved as JSON file in the selected folder and indexed'
                        : 'Click "Choose Folder" to also save as a JSON file, or project will be indexed only'}
                    </span>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-close btn-secondary" onClick={() => setShowProjectModal(false)}>CANCEL</button>
                <button className="btn-close" onClick={handleConfirmSaveProject}>SAVE</button>
              </div>
            </div>
          </div>
        )}

        {/* Export to File Modal */}
        {showExportModal && (
          <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
            <div className="settings-modal project-modal" onClick={e => e.stopPropagation()}>
              <h2><Download /> EXPORT PROJECT</h2>
              
              <div className="project-form">
                <div className="project-form-field">
                  <label>Filename</label>
                  <input 
                    type="text" 
                    value={exportFilename}
                    onChange={(e) => setExportFilename(e.target.value)}
                    placeholder="project_name_VocalSync.json"
                    autoFocus
                  />
                </div>
                
                {isFileSystemAccessSupported() && (
                  <div className="project-form-field">
                    <label>Save Location</label>
                    <div className="directory-picker">
                      <button 
                        className="btn-secondary btn-pick-dir"
                        onClick={handlePickExportDirectory}
                      >
                        <Folder size={16} /> 
                        {exportDirectoryHandle ? 'Change Folder' : 'Choose Folder'}
                      </button>
                      {exportDirectoryHandle && (
                        <span className="selected-dir">
                          <Folder size={14} /> {exportDirectoryName}
                        </span>
                      )}
                    </div>
                    <span className="field-hint">
                      {exportDirectoryHandle 
                        ? 'File will be saved to the selected folder'
                        : 'Click "Choose Folder" to select where to save, or file will download to Downloads'}
                    </span>
                  </div>
                )}
                
                {!isFileSystemAccessSupported() && (
                  <div className="project-form-field">
                    <span className="field-hint">The file will be saved to your Downloads folder</span>
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button className="btn-close btn-secondary" onClick={() => setShowExportModal(false)}>CANCEL</button>
                <button className="btn-close" onClick={handleConfirmExport}>EXPORT</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
