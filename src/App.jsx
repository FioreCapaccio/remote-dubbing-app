import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings2 } from 'lucide-react';

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
    { id: 'track-1', name: 'LEAD VOCAL', volume: 1, muted: false, solo: false, type: 'audio', clips: [] }
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

  const videoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const sendCommandRef = useRef(null);

  // Custom Hooks
  const { 
    isRecording, takes, devices, outputDevices, selectedDevice, setSelectedDevice, 
    selectedOutput, setOutputDevice, peakLevel, startRecording, stopRecording 
  } = useAudioRecorder(audioSettings);

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
    if (isRecording) {
      stopRecording();
      if (videoRef.current) videoRef.current.pause();
      else stopInternalPlayhead();
      setIsPlaying(false);
      if (sendCommandRef.current) sendCommandRef.current({ type: 'PAUSE' });
      return;
    }
    if (countdown !== null) {
      cancelCountdown();
      if (sendCommandRef.current) sendCommandRef.current({ type: 'COUNTDOWN_CANCEL' });
      return;
    }
    if (sendCommandRef.current) sendCommandRef.current({ type: 'COUNTDOWN_START' });
    startCountdownDisplay(() => {
      const startTime = videoRef.current ? videoRef.current.currentTime : internalTimeRef.current;
      recordStartTime.current = startTime;
      startRecording();
      if (videoRef.current) {
        requestAnimationFrame(() => {
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
          if (sendCommandRef.current) sendCommandRef.current({ type: 'REC_START' });
        });
      } else {
        // No video: advance playhead via internal timer
        startInternalPlayhead(startTime);
        setIsPlaying(true);
        if (sendCommandRef.current) sendCommandRef.current({ type: 'REC_START' });
      }
    });
  }, [isRecording, countdown, cancelCountdown, startCountdownDisplay, stopRecording, startRecording, startInternalPlayhead, stopInternalPlayhead]);

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
        startRecording();
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
  }, [startRecording, startCountdownDisplay, cancelCountdown, startInternalPlayhead, stopInternalPlayhead]);

  const { peerId, isConnected, connectionStatus, sendCommand, remoteStream, startTalkback, stopTalkback } = usePeerSession(roomName, sessionRole, handleRemoteCommand);

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
    if (takes.length > 0 && takes[0].id !== lastProcessedTake.current) {
      const take = takes[0]; lastProcessedTake.current = take.id;
      // Use internalTimeRef for accurate duration even without video
      const tDuration = internalTimeRef.current - recordStartTime.current;
      setTracks(prev => prev.map(t => t.id === selectedTrackId ? {
        ...t, clips: [...t.clips, {
          id: `clip-${take.id}`,
          url: take.url,
          startTime: recordStartTime.current,
          duration: tDuration > 0 ? tDuration : 2,
          gain: 1
        }]
      } : t));
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
          isConnected={isConnected} connectionStatus={connectionStatus} peerId={peerId}
          devices={devices}
          selectedDevice={selectedDevice} setSelectedDevice={setSelectedDevice}
          outputDevices={outputDevices} selectedOutput={selectedOutput} setOutputDevice={setOutputDevice}
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
                <div className="modal-actions"><button className="btn-close" onClick={() => setShowSettings(false)}>DONE</button></div>
             </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
