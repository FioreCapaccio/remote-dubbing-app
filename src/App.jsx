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

  // Cue List (structured ADR scripting)
  // Each cue: { id, timeIn, timeOut, character, text, status: 'todo'|'recording'|'done' }
  const [cues, setCues] = useState([]);

  // Chat State
  // Each message: { id, sender: 'director'|'actor', text, timestamp }
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
  const [countdown, setCountdown] = useState(null); // null | 3 | 2 | 1
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
    const actualTime = time ?? (videoRef.current?.currentTime ?? 0);
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
    let newCues = cues.map(c => c.id === id ? { ...c, [field]: value } : c);
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
    const ct = videoRef.current?.currentTime ?? currentTime;
    const prev = [...cues].sort((a, b) => a.timeIn - b.timeIn).reverse().find(c => c.timeIn < ct - 0.1);
    if (prev && videoRef.current) {
      videoRef.current.currentTime = prev.timeIn;
      setCurrentTime(prev.timeIn);
      if (sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: prev.timeIn });
    }
  }, [cues, currentTime]);

  const handleNextCue = useCallback(() => {
    const ct = videoRef.current?.currentTime ?? currentTime;
    const next = [...cues].sort((a, b) => a.timeIn - b.timeIn).find(c => c.timeIn > ct + 0.1);
    if (next && videoRef.current) {
      videoRef.current.currentTime = next.timeIn;
      setCurrentTime(next.timeIn);
      if (sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: next.timeIn });
    }
  }, [cues, currentTime]);

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
  const handleTogglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) { videoRef.current.pause(); if (sendCommandRef.current) sendCommandRef.current({ type: 'PAUSE' }); }
      else { videoRef.current.play(); if (sendCommandRef.current) sendCommandRef.current({ type: 'PLAY' }); }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  const handleStartProcess = useCallback(() => {
    if (isRecording) {
      stopRecording();
      if (videoRef.current) videoRef.current.pause();
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
      recordStartTime.current = videoRef.current ? videoRef.current.currentTime : 0;
      startRecording();
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
          if (sendCommandRef.current) sendCommandRef.current({ type: 'REC_START' });
        }
      });
    });
  }, [isRecording, countdown, cancelCountdown, startCountdownDisplay, stopRecording, startRecording]);

  const handleRemoteCommand = useCallback((cmd) => {
    switch (cmd.type) {
      case 'PLAY':
        videoRef.current?.play();
        setIsPlaying(true);
        break;
      case 'PAUSE':
        videoRef.current?.pause();
        setIsPlaying(false);
        break;
      case 'REC_START':
        recordStartTime.current = videoRef.current ? videoRef.current.currentTime : 0;
        startRecording();
        requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.play().catch(() => {});
            setIsPlaying(true);
          }
        });
        break;
      case 'COUNTDOWN_START':
        startCountdownDisplay(null);
        break;
      case 'COUNTDOWN_CANCEL':
        cancelCountdown();
        break;
      case 'SEEK': 
        if (videoRef.current) {
          videoRef.current.currentTime = cmd.time;
          setCurrentTime(cmd.time);
        }
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
  }, [startRecording, startCountdownDisplay, cancelCountdown]);

  const { peerId, isConnected, connectionStatus, sendCommand, remoteStream, startTalkback, stopTalkback } = usePeerSession(roomName, sessionRole, handleRemoteCommand);

  useEffect(() => {
    sendCommandRef.current = sendCommand;
  }, [sendCommand]);

  // Sync Engine & Layout Listeners
  useEffect(() => {
    let animationId;
    const syncEngine = () => {
      const exactTime = videoRef.current ? videoRef.current.currentTime : currentTime;
      tracks.forEach(track => {
        if (track.type === 'video') return;
        track.clips.forEach(clip => {
          const audioEl = document.getElementById(clip.id);
          if (!audioEl) return;
          audioEl.volume = track.muted ? 0 : Math.max(0, Math.min(1, track.volume));
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
  }, [isPlaying, tracks, currentTime]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingHorizontal.current) setSidebarWidth(Math.max(240, Math.min(e.clientX, 520)));
      if (isResizingVertical.current) setVideoHeight(Math.max(150, Math.min(e.clientY - 120, window.innerHeight - 300)));
      if (isScrubbingRef.current && duration > 0) {
        const timeline = document.querySelector('.timeline-daw-integrated');
        if (timeline) {
          const rect = timeline.getBoundingClientRect();
          const newTime = Math.max(0, Math.min((e.clientX - rect.left + timeline.scrollLeft - sidebarWidth) / zoomLevel, duration));
          if (videoRef.current) { videoRef.current.currentTime = newTime; setCurrentTime(newTime); }
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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape' && countdown !== null) {
        cancelCountdown();
        if (sendCommandRef.current) sendCommandRef.current({ type: 'COUNTDOWN_CANCEL' });
        return;
      }
      if (e.key === ' ') { e.preventDefault(); handleTogglePlay(); }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && videoRef.current && duration > 0) {
        let newTime = Math.max(0, Math.min(videoRef.current.currentTime + (e.key === 'ArrowRight' ? 0.5 : -0.5), duration));
        videoRef.current.currentTime = newTime; setCurrentTime(newTime);
        if (sendCommandRef.current) sendCommandRef.current({ type: 'SEEK', time: newTime });
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        setTracks(prev => prev.map(t => ({ ...t, clips: t.clips.filter(c => c.id !== selectedClipId) })));
        setSelectedClipId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [duration, handleTogglePlay, selectedClipId, countdown, cancelCountdown]);

  useEffect(() => {
    if (takes.length > 0 && takes[0].id !== lastProcessedTake.current) {
      const take = takes[0]; lastProcessedTake.current = take.id;
      const tDuration = currentTime - recordStartTime.current;
      setTracks(prev => prev.map(t => t.id === selectedTrackId ? {
        ...t, clips: [...t.clips, { id: `clip-${take.id}`, url: take.url, startTime: recordStartTime.current, duration: tDuration > 0 ? tDuration : 2 }]
      } : t));
    }
  }, [takes, selectedTrackId, currentTime]);

  const handleExportMixdown = async () => {
    if (duration <= 0 || isExporting) return;
    try {
      setIsExporting(true);
      const blob = await renderMixdown(tracks, duration, videoURL, audioSettings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `VocalSync_Mixdown_${Date.now()}.wav`; a.click();
    } catch { alert("Export error"); } finally { setIsExporting(false); }
  };

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
        clips: [{ id: `clip-${Date.now()}`, url, startTime: dropTime, duration: audio.duration || 5 }]
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
            isPlaying={isPlaying} handleTogglePlay={handleTogglePlay}
            isRecording={isRecording} handleStartProcess={handleStartProcess}
            currentTime={currentTime} duration={duration} videoURL={videoURL} videoFileName={videoFileName}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
          />
          <VideoPreview 
            videoHeight={videoHeight} videoURL={videoURL} videoRef={videoRef}
            setCurrentTime={setCurrentTime} setDuration={setDuration} currentTime={currentTime}
            countdown={countdown}
            activeCue={activeCue}
            setVideoURL={(url, name) => { setVideoURL(url); if (name) setVideoFileName(name); }}
          />
          <div className="layout-divider-h" onMouseDown={(e) => { e.preventDefault(); isResizingVertical.current = true; document.body.style.cursor = 'row-resize'; }} />
          <DawTimeline 
            isDraggingOver={isDraggingOver} handleDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
            handleDragLeave={() => setIsDraggingOver(false)} handleDrop={handleDrop}
            isScrubbing={isScrubbingRef} duration={duration} sidebarWidth={sidebarWidth}
            zoomLevel={zoomLevel} videoRef={videoRef} setCurrentTime={setCurrentTime}
            cues={cues} onAddCue={handleAddCue}
            tracks={tracks} setTracks={setTracks}
            selectedTrackId={selectedTrackId} setSelectedTrackId={setSelectedTrackId}
            selectedClipId={selectedClipId} setSelectedClipId={setSelectedClipId}
            draggingClip={draggingClip} setDraggingClip={setDraggingClip} dragStartRef={dragStartRef}
            videoURL={videoURL} currentTime={currentTime}
            activeCue={activeCue}
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
