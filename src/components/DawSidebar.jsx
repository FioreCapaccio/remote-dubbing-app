import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings2, HardDrive, Headphones, Mic, Plus, Trash2, 
  Activity, Download, Copy, Check, Wifi, WifiOff, Clock,
  ChevronLeft, ChevronRight, Film, MessageSquare, Send, ChevronDown, ChevronUp
} from 'lucide-react';
import VolumeMeter from './VolumeMeter';
import { renderSingleClip } from '../utils/audioExport';

const ConnectionIndicator = ({ connectionStatus, peerId }) => {
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
      {peerId && (
        <button className="peer-id-copy" onClick={handleCopy} title="Copy Peer ID">
          <span className="peer-id-text">{peerId}</span>
          {copied
            ? <Check size={10} className="peer-id-copy-icon peer-id-copy-icon--ok" />
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
  isConnected, connectionStatus, peerId, 
  devices, selectedDevice, setSelectedDevice, 
  outputDevices, selectedOutput, setOutputDevice, 
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
}) => {
  const isDirector = sessionRole === 'host';

  // Chat panel state
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const chatScrollRef = useRef(null);

  // Per-take export state: { clipId: 'loading' | 'done' | null }
  const [exportingTake, setExportingTake] = useState({});

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
    <aside className="sidebar session-sidebar" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
      <div className="sidebar-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="app-logo"><Activity size={18} /> VOCALSYNC <span className="v-tag">5.0 PRO</span></h2>
          <button className="settings-trigger" onClick={() => setShowSettings(true)}><Settings2 size={16} /></button>
        </div>

        <div className="role-selector-wrap">
          <label className="role-selector-label">SESSION ROLE</label>
          <div className="role-toggle">
            <button
              className={`role-btn${sessionRole === 'host' ? ' role-btn--active' : ''}`}
              onClick={() => setSessionRole('host')}
            >
              DIRECTOR
            </button>
            <button
              className={`role-btn${sessionRole === 'guest' ? ' role-btn--active' : ''}`}
              onClick={() => setSessionRole('guest')}
            >
              ACTOR
            </button>
          </div>
        </div>

        <div className="room-box">
          <input placeholder="ROOM ID..." value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <ConnectionIndicator connectionStatus={connectionStatus || (isConnected ? 'connected' : roomName ? 'waiting' : 'disconnected')} peerId={peerId} />
        </div>
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

      <div className="sidebar-group hardware-config">
        <label><HardDrive size={12} /> AUDIO INPUT</label>
        <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
          {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Input Device'}</option>)}
        </select>

        <label style={{ marginTop: '1rem' }}><Headphones size={12} /> MONITORING OUTPUT</label>
        <select value={selectedOutput} onChange={(e) => setOutputDevice(e.target.value)}>
          <option value="default">System Default</option>
          {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Output Device'}</option>)}
        </select>
      </div>

      {/* Cue List Section */}
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
            return (
              <div key={cue.id} className={`cue-item${isActive ? ' cue-item--active' : ''}`}>
                <div className="cue-row-top">
                  <span className="cue-number">#{idx + 1}</span>
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
                  <button
                    className={`cue-status cue-status--${cue.status}`}
                    onClick={() => {
                      if (!isDirector) return;
                      onUpdateCue(cue.id, 'status', STATUS_CYCLE[cue.status]);
                    }}
                    title="Change status"
                  >
                    {STATUS_LABELS[cue.status]}
                  </button>
                  {isDirector && (
                    <button className="cue-del" onClick={() => onDeleteCue(cue.id)} title="Delete cue">
                      <Trash2 size={9} />
                    </button>
                  )}
                </div>
                <div className="cue-row-bottom">
                  <textarea
                    className="cue-text"
                    value={cue.text}
                    onChange={e => onUpdateCue(cue.id, 'text', e.target.value)}
                    placeholder="Line to dub..."
                    rows={2}
                    readOnly={!isDirector}
                  />
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
      </div>
    </aside>
  );
};

export default DawSidebar;
