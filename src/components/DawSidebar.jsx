import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings2, Mic, Plus, Trash2, Edit2, X,
  Activity, Download, Copy, Check as CheckIcon, Wifi, WifiOff, Clock,
  ChevronLeft, ChevronRight, Film, MessageSquare, Send, ChevronDown, ChevronUp,
  KeyRound, Users, Lock, Radio, Upload, Download as DownloadIcon
} from 'lucide-react';
import VolumeMeter from './VolumeMeter';
import { renderSingleClip } from '../utils/audioExport';

const ConnectionIndicator = ({ connectionStatus, connectionError, peerId }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!peerId) return;
    navigator.clipboard.writeText(peerId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const el = document.createElement('textarea');
      el.value = peerId;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const statusMap = {
    connected:    { label: 'LIVE CONNECTION',  dotClass: 'conn-dot--connected',    Icon: Wifi },
    waiting:      { label: 'WAITING...',        dotClass: 'conn-dot--waiting',      Icon: Clock },
    disconnected: { label: 'DISCONNECTED',      dotClass: 'conn-dot--disconnected', Icon: WifiOff },
  };

  const { label, dotClass, Icon } = statusMap[connectionStatus] || statusMap.disconnected;

  return (
    <div className="connection-block">
      <div className="connection-indicator">
        <span className={`conn-dot ${dotClass}`} />
        <Icon size={10} style={{ flexShrink: 0 }} />
        <span className="conn-status-label">{label}</span>
      </div>
      {connectionError && (
        <div className="connection-error" style={{ 
          fontSize: '0.65rem', 
          color: '#ff6b6b', 
          marginTop: '4px',
          padding: '2px 4px',
          background: 'rgba(255, 107, 107, 0.1)',
          borderRadius: '3px'
        }}>
          {connectionError}
        </div>
      )}
      {peerId && (
        <button className="peer-id-copy" onClick={handleCopy} title="Copy Peer ID">
          <span className="peer-id-text">{peerId}</span>
          {copied
            ? <CheckIcon size={10} className="peer-id-copy-icon peer-id-copy-icon--ok" />
            : <Copy size={10} className="peer-id-copy-icon" />
          }
        </button>
      )}
    </div>
  );
};

const STATUS_LABELS = { todo: 'TODO', recording: 'REC', done: 'DONE' };
const STATUS_CYCLE  = { todo: 'recording', recording: 'done', done: 'todo' };

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

const fmtTimestamp = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Returns all audio clips (from all non-video tracks) that start within this cue's window. */
function getClipsForCue(cue, cueIdx, allCues, tracks) {
  const nextCue = allCues[cueIdx + 1];
  const windowEnd = nextCue ? nextCue.timeIn : cue.timeIn + 60;
  const clips = [];
  tracks.forEach(track => {
    if (track.type === 'video') return;
    track.clips.forEach(clip => {
      if (clip.startTime >= cue.timeIn - 0.5 && clip.startTime < windowEnd) {
        clips.push(clip);
      }
    });
  });
  return clips;
}

/** Build a professional ADR filename: PROJECT_Cue001_Take01.wav */
function makeTakeName(videoFileName, cueIdx, takeIdx) {
  const project = videoFileName
    ? videoFileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
    : 'SESSION';
  const cueNum  = String(cueIdx + 1).padStart(3, '0');
  const takeNum = String(takeIdx + 1).padStart(2, '0');
  return `${project}_Cue${cueNum}_Take${takeNum}.wav`;
}

const DawSidebar = ({ 
  sidebarWidth, 
  roomName, setRoomName, 
  isConnected, connectionStatus, connectionError, peerId, 
  sessionRole, setSessionRole, 
  startTalkback, stopTalkback, 
  cues,
  onAddCue,
  onUpdateCue,
  onDeleteCue,
  onPrevCue,
  onNextCue,
  activeCue,
  peakLevel, 
  isExporting, handleExportMixdown,
  setShowSettings,
  videoRef,
  setCurrentTime,
  chatMessages,
  unreadChatCount,
  onSendChat,
  onChatRead,
  // New props for takes export
  tracks,
  audioSettings,
  videoFileName,
  // Mobile sidebar class
  className,
  // PIN props
  sessionPin,
  // User management props
  connections,
  onShowUsers,
  onShowPassword,
  // Recording status props
  recordingStatus,
  isRecording,
}) => {
  const isDirector = sessionRole === 'host';
  const isActor = sessionRole === 'guest';

  // Chat panel state
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const chatScrollRef = useRef(null);

  // Per-take export state: { clipId: 'loading' | 'done' | null }
  const [exportingTake, setExportingTake] = useState({});

  // Cue editing state: { cueId: { field: value } }
  const [editingCue, setEditingCue] = useState(null);
  const [editValues, setEditValues] = useState({});

  // Microphone gain state for LEAD VOCAL track (actor only)
  const [micGain, setMicGain] = useState(1);
  const [micPeakLevel, setMicPeakLevel] = useState(-60);
  const micAnalyserRef = useRef(null);
  const micAudioContextRef = useRef(null);
  const micAnimationFrameRef = useRef(null);

  // Initialize microphone level meter for actor
  useEffect(() => {
    if (!isActor) {
      // Cleanup if switching from actor to director
      if (micAnimationFrameRef.current) {
        cancelAnimationFrame(micAnimationFrameRef.current);
      }
      if (micAudioContextRef.current) {
        micAudioContextRef.current.close().catch(() => {});
      }
      return;
    }

    const initMicMeter = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { 
            channelCount: 1, // Force mono
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          } 
        });
        
        micAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const source = micAudioContextRef.current.createMediaStreamSource(stream);
        micAnalyserRef.current = micAudioContextRef.current.createAnalyser();
        micAnalyserRef.current.fftSize = 256;
        source.connect(micAnalyserRef.current);

        const updateMicLevel = () => {
          if (!micAnalyserRef.current) return;
          const dataArray = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
          micAnalyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          const db = average === 0 ? -60 : 20 * Math.log10(average / 255);
          setMicPeakLevel(Math.max(-60, db));
          micAnimationFrameRef.current = requestAnimationFrame(updateMicLevel);
        };
        updateMicLevel();
      } catch (err) {
        console.error('Mic meter init error:', err);
      }
    };

    initMicMeter();

    return () => {
      if (micAnimationFrameRef.current) {
        cancelAnimationFrame(micAnimationFrameRef.current);
      }
      if (micAudioContextRef.current) {
        micAudioContextRef.current.close().catch(() => {});
      }
    };
  }, [isActor]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatOpen && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatOpen]);

  // Reset unread count when chat is open and new messages arrive
  useEffect(() => {
    if (chatOpen && unreadChatCount > 0) {
      onChatRead();
    }
  }, [chatOpen, unreadChatCount, onChatRead]);

  const handleChatToggle = () => {
    const nextOpen = !chatOpen;
    setChatOpen(nextOpen);
    if (nextOpen) onChatRead();
  };

  const handleChatSend = () => {
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput('');
  };

  const handleChatKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  };

  const handleExportTake = async (clip, filename) => {
    if (exportingTake[clip.id]) return;
    setExportingTake(prev => ({ ...prev, [clip.id]: 'loading' }));
    try {
      const blob = await renderSingleClip(clip, audioSettings || { sampleRate: 48000, bitDepth: 24 });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportingTake(prev => ({ ...prev, [clip.id]: 'done' }));
      setTimeout(() => setExportingTake(prev => { const n = { ...prev }; delete n[clip.id]; return n; }), 2000);
    } catch (err) {
      console.error('Take export failed:', err);
      setExportingTake(prev => { const n = { ...prev }; delete n[clip.id]; return n; });
    }
  };

  const myRole = sessionRole === 'host' ? 'director' : 'actor';

  return (
    <aside className={`sidebar session-sidebar ${className || ''}`} style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
      <div className="sidebar-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="app-logo"><Activity size={18} /> VOCALSYNC <span className="v-tag">5.0 PRO</span></h2>
          <button className="settings-trigger" onClick={() => setShowSettings(true)}><Settings2 size={16} /></button>
        </div>

        {/* Recording Status Indicator */}
        {recordingStatus !== 'idle' && (
          <div className={`recording-status-banner recording-status--${recordingStatus}`}>
            {recordingStatus === 'recording' && (
              <>
                <Radio size={16} className="recording-icon" />
                <span className="recording-text">REGISTRAZIONE IN CORSO</span>
                <span className="recording-dot"></span>
              </>
            )}
            {recordingStatus === 'sent' && isActor && (
              <>
                <Upload size={16} className="recording-icon" />
                <span className="recording-text">FILE INVIATO</span>
              </>
            )}
            {recordingStatus === 'received' && isDirector && (
              <>
                <DownloadIcon size={16} className="recording-icon" />
                <span className="recording-text">FILE RICEVUTO</span>
              </>
            )}
          </div>
        )}

        {/* Role indicator - read only for both roles */}
        <div className="role-indicator-wrap">
          <label className="role-selector-label">SESSION ROLE</label>
          <div className="role-display">
            <span className={`role-badge ${sessionRole === 'host' ? 'role-badge--director' : 'role-badge--actor'}`}>
              {sessionRole === 'host' ? 'DIRECTOR' : 'ATTORE / DOPPIATORE'}
            </span>
          </div>
        </div>

        <div className="room-box">
          {isDirector ? (
            // Director: show PIN display
            <div className="pin-display">
              <label className="pin-label"><KeyRound size={12} /> CODICE PIN</label>
              <div className="pin-value">{sessionPin || '----'}</div>
              <span className="pin-hint">Dai questo PIN all'attore per connettersi</span>
            </div>
          ) : (
            // Actor: show connection status only (PIN entered on landing)
            <div className="pin-display" style={{ background: 'transparent', border: '1px solid var(--border)' }}>
              <label className="pin-label" style={{ color: 'var(--text-muted)' }}><KeyRound size={12} /> SESSIONE</label>
              <div className="pin-value" style={{ fontSize: '1.25rem', letterSpacing: '0.1em' }}>{roomName || '----'}</div>
              <span className="pin-hint">Connessione automatica al direttore</span>
            </div>
          )}
          <ConnectionIndicator connectionStatus={connectionStatus || (isConnected ? 'connected' : roomName ? 'waiting' : 'disconnected')} connectionError={connectionError} peerId={peerId} />
        </div>
        
        {/* Director Controls - Users & Password */}
        {isDirector && (
          <div className="director-controls" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button 
              className="btn-project" 
              onClick={onShowUsers}
              style={{ flex: 1, fontSize: '0.65rem' }}
            >
              <Users size={12} />
              USERS {connections?.length > 0 && `(${connections.length})`}
            </button>
            <button 
              className="btn-project" 
              onClick={onShowPassword}
              style={{ flex: 1, fontSize: '0.65rem' }}
            >
              <Lock size={12} />
              PASSWORD
            </button>
          </div>
        )}
      </div>

      {sessionRole === 'host' && (
        <div className={`talkback-wrap${isConnected ? ' talkback-wrap--ready' : ''}`}>
          <button
            className={`ptt-button${isConnected ? ' ptt-button--live' : ' ptt-button--offline'}`}
            disabled={!isConnected}
            onMouseDown={isConnected ? startTalkback : undefined}
            onMouseUp={isConnected ? stopTalkback : undefined}
            onMouseLeave={isConnected ? stopTalkback : undefined}
          >
            <Mic size={18} />
            <span className="ptt-label">TALKBACK</span>
            <span className="ptt-hint">{isConnected ? 'HOLD TO SPEAK' : 'NO CONNECTION'}</span>
          </button>
        </div>
      )}

      {/* Microphone Level Meter for Actor */}
      {isActor && (
        <div className="sidebar-group mic-level-section">
          <label className="role-selector-label">LEAD VOCAL INPUT</label>
          <div className="mic-meter-wrapper">
            <div className="mic-meter-bar">
              <div 
                className="mic-meter-fill"
                style={{ 
                  height: `${Math.max(0, Math.min(100, (micPeakLevel + 60) / 60 * 100))}%`,
                  background: micPeakLevel > -6 ? '#ff4444' : micPeakLevel > -18 ? '#ffaa00' : '#00ff88'
                }}
              />
            </div>
            <div className="mic-meter-scale">
              <span>0</span>
              <span>-30</span>
              <span>-60</span>
            </div>
          </div>
          <div className="mic-gain-control">
            <label>GAIN: {micGain.toFixed(1)}x</label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={micGain}
              onChange={(e) => setMicGain(parseFloat(e.target.value))}
            />
          </div>
        </div>
      )}

      {/* Cue List Section - Hidden for Actor */}
      {isDirector && (
      <div className="sidebar-group cue-list-section">
        <div className="cue-list-header">
          <label style={{ margin: 0 }}><Film size={12} /> CUE LIST</label>
          <div className="cue-nav-controls">
            <button className="cue-nav-btn" onClick={onPrevCue} title="Previous cue"><ChevronLeft size={12} /></button>
            <button className="cue-nav-btn" onClick={onNextCue} title="Next cue"><ChevronRight size={12} /></button>
            {isDirector && (
              <button className="cue-add-btn" onClick={() => onAddCue()} title="Add cue at current timecode">
                <Plus size={10} /> ADD
              </button>
            )}
          </div>
        </div>

        <div className="cue-list-scroll">
          {cues.length === 0 && (
            <div className="cue-empty">
              {isDirector
                ? 'No cues. Click ADD or double-click on the timeline.'
                : 'No cues received from director.'}
            </div>
          )}
          {cues.map((cue, idx) => {
            const isActive  = activeCue?.id === cue.id;
            const cueClips  = tracks ? getClipsForCue(cue, idx, cues, tracks) : [];
            const isEditing = editingCue === cue.id;
            
            const handleEditStart = () => {
              setEditingCue(cue.id);
              setEditValues({
                character: cue.character || '',
                text: cue.text || '',
                timeIn: cue.timeIn || 0
              });
            };
            
            const handleEditSave = () => {
              if (editValues.character !== cue.character) {
                onUpdateCue(cue.id, 'character', editValues.character);
              }
              if (editValues.text !== cue.text) {
                onUpdateCue(cue.id, 'text', editValues.text);
              }
              if (editValues.timeIn !== cue.timeIn) {
                onUpdateCue(cue.id, 'timeIn', parseFloat(editValues.timeIn));
              }
              setEditingCue(null);
              setEditValues({});
            };
            
            const handleEditCancel = () => {
              setEditingCue(null);
              setEditValues({});
            };
            
            const handleDelete = () => {
              if (confirm('Delete this cue?')) {
                onDeleteCue(cue.id);
              }
            };
            
            return (
              <div key={cue.id} className={`cue-item${isActive ? ' cue-item--active' : ''}${isEditing ? ' cue-item--editing' : ''}`}>
                <div className="cue-row-top">
                  <span className="cue-number">#{idx + 1}</span>
                  
                  {isEditing ? (
                    <>
                      <input
                        className="cue-timein-edit"
                        type="number"
                        step="0.1"
                        value={editValues.timeIn}
                        onChange={e => setEditValues(v => ({ ...v, timeIn: e.target.value }))}
                        title="Time in seconds"
                      />
                      <input
                        className="cue-character-edit"
                        value={editValues.character}
                        onChange={e => setEditValues(v => ({ ...v, character: e.target.value }))}
                        placeholder="CHARACTER"
                      />
                    </>
                  ) : (
                    <>
                      <button
                        className="cue-timein"
                        onClick={() => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = cue.timeIn;
                            setCurrentTime(cue.timeIn);
                          }
                        }}
                        title={`Go to ${fmtTime(cue.timeIn)}`}
                      >
                        {fmtTime(cue.timeIn)}
                      </button>
                      <input
                        className="cue-character"
                        value={cue.character}
                        onChange={e => onUpdateCue(cue.id, 'character', e.target.value)}
                        placeholder="CHARACTER"
                        readOnly={!isDirector}
                      />
                    </>
                  )}
                  
                  <button
                    className={`cue-status cue-status--${cue.status}`}
                    onClick={() => {
                      if (!isDirector || isEditing) return;
                      onUpdateCue(cue.id, 'status', STATUS_CYCLE[cue.status]);
                    }}
                    title="Change status"
                  >
                    {STATUS_LABELS[cue.status]}
                  </button>
                  
                  {isDirector && (
                    <div className="cue-actions">
                      {isEditing ? (
                        <>
                          <button className="cue-action-btn cue-action-btn--save" onClick={handleEditSave} title="Save">
                            <CheckIcon size={10} />
                          </button>
                          <button className="cue-action-btn cue-action-btn--cancel" onClick={handleEditCancel} title="Cancel">
                            <X size={10} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="cue-action-btn cue-action-btn--edit" onClick={handleEditStart} title="Edit cue">
                            <Edit2 size={10} />
                          </button>
                          <button className="cue-action-btn cue-action-btn--delete" onClick={handleDelete} title="Delete cue">
                            <Trash2 size={10} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="cue-row-bottom">
                  {isEditing ? (
                    <textarea
                      className="cue-text-edit"
                      value={editValues.text}
                      onChange={e => setEditValues(v => ({ ...v, text: e.target.value }))}
                      placeholder="Line to dub..."
                      rows={2}
                    />
                  ) : (
                    <textarea
                      className="cue-text"
                      value={cue.text}
                      onChange={e => onUpdateCue(cue.id, 'text', e.target.value)}
                      placeholder="Line to dub..."
                      rows={2}
                      readOnly={!isDirector}
                    />
                  )}
                </div>

                {/* Takes sub-row */}
                {cueClips.length > 0 && (
                  <div className="cue-takes-row">
                    {cueClips.map((clip, takeIdx) => {
                      const filename = makeTakeName(videoFileName, idx, takeIdx);
                      const state    = exportingTake[clip.id];
                      return (
                        <button
                          key={clip.id}
                          className={`take-pill${state === 'done' ? ' take-pill--done' : ''}`}
                          onClick={() => handleExportTake(clip, filename)}
                          disabled={state === 'loading'}
                          title={`Export ${filename}`}
                        >
                          {state === 'loading'
                            ? <Activity size={9} className="spin" />
                            : state === 'done'
                              ? <Check size={9} />
                              : <Download size={9} />
                          }
                          T{String(takeIdx + 1).padStart(2, '0')}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Chat Section */}
      <div className="sidebar-group chat-section">
        <button className="chat-header-btn" onClick={handleChatToggle}>
          <span className="chat-header-left">
            <MessageSquare size={12} />
            <span>SESSION CHAT</span>
            {!chatOpen && unreadChatCount > 0 && (
              <span className="chat-unread-badge">{unreadChatCount}</span>
            )}
          </span>
          {chatOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {chatOpen && (
          <>
            <div className="chat-messages" ref={chatScrollRef}>
              {chatMessages.length === 0 && (
                <div className="chat-empty">No messages yet. Start typing.</div>
              )}
              {chatMessages.map(msg => {
                const isMine = msg.sender === myRole;
                return (
                  <div key={msg.id} className={`chat-msg${isMine ? ' chat-msg--mine' : ' chat-msg--theirs'}`}>
                    <div className="chat-msg-meta">
                      <span className="chat-msg-sender">{msg.sender === 'director' ? 'DIRECTOR' : 'ACTOR'}</span>
                      <span className="chat-msg-time">{fmtTimestamp(msg.timestamp)}</span>
                    </div>
                    <div className="chat-msg-text">{msg.text}</div>
                  </div>
                );
              })}
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Type a message..."
                maxLength={500}
              />
              <button
                className="chat-send-btn"
                onClick={handleChatSend}
                disabled={!chatInput.trim()}
                title="Send (Enter)"
              >
                <Send size={12} />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="master-section">
        {isDirector && (
          <>
            <div className="meter-wrapper">
              <div className="meter-label">MASTER PEAK</div>
              <VolumeMeter level={peakLevel} />
            </div>
            <button 
              className={`export-btn ${isExporting ? 'loading' : ''}`} 
              onClick={handleExportMixdown}
              disabled={isExporting}
            >
              {isExporting ? <Activity className="spin" size={14} /> : <Download size={14} />} 
              {isExporting ? 'RENDERING...' : 'EXPORT MIXDOWN'}
            </button>
          </>
        )}
        {isActor && (
          <div className="actor-status">
            <div className="actor-status-indicator">
              <span className={`status-dot ${isConnected ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
              <span>{isConnected ? 'CONNECTED TO DIRECTOR' : 'WAITING FOR CONNECTION'}</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default DawSidebar;
