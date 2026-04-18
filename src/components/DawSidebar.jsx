import React from 'react';
import { 
  Settings2, Globe, HardDrive, Headphones, Mic, Type, Plus, Trash2, 
  Activity, Download 
} from 'lucide-react';
import VolumeMeter from './VolumeMeter';

const DawSidebar = ({ 
  sidebarWidth, 
  roomName, setRoomName, 
  isConnected, peerId, 
  devices, selectedDevice, setSelectedDevice, 
  outputDevices, selectedOutput, setOutputDevice, 
  sessionRole, setSessionRole, 
  startTalkback, stopTalkback, 
  adrMarkers, setAdrMarkers, 
  addAdrMarker, 
  peakLevel, 
  isExporting, handleExportMixdown,
  setShowSettings,
  videoRef,
  setCurrentTime
}) => {
  return (
    <aside className="sidebar session-sidebar" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}>
      <div className="sidebar-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="app-logo"><Activity size={18} /> VOCALSYNC <span className="v-tag">5.0 PRO</span></h2>
          <button className="settings-trigger" onClick={() => setShowSettings(true)}><Settings2 size={16} /></button>
        </div>
        <div className="room-box">
          <input placeholder="ROOM ID..." value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <div className="status" style={{ color: isConnected ? 'var(--accent)' : '#f87171' }}>
            <Globe size={10} /> 
            {isConnected ? 'LIVE CONNECTION' : 'WAITING FOR PEER...'}
          </div>
          {peerId && <div style={{ fontSize: '0.5rem', color: 'var(--text-muted)', marginTop: '2px' }}>ID: {peerId}</div>}
        </div>
      </div>

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

      <div className="sidebar-group">
        <label>SESSION ROLE</label>
        <select value={sessionRole} onChange={(e) => setSessionRole(e.target.value)}>
          <option value="host">DIRECTOR / HOST</option>
          <option value="guest">SPEAKER / GUEST</option>
        </select>
      </div>

      {sessionRole === 'host' && isConnected && (
        <button className="ptt-button" onMouseDown={startTalkback} onMouseUp={stopTalkback} onMouseLeave={stopTalkback}>
          <Mic size={16} /> TALKBACK (PTT)
        </button>
      )}

      {/* ADR Scripting Section */}
      <div className="sidebar-group adr-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <label style={{ margin: 0 }}><Type size={12} /> ADR SCRIPT</label>
          <button className="adr-add-btn" onClick={addAdrMarker}><Plus size={10} /> PIN POINT</button>
        </div>
        {adrMarkers.map(m => (
          <div key={m.id} className="adr-item">
            <span className="adr-time" onClick={() => { if(videoRef.current) { videoRef.current.currentTime = m.time; setCurrentTime(m.time); } }}>
              {Math.floor(m.time/60)}:{(m.time%60).toFixed(1).padStart(4,'0')}
            </span>
            <input 
              className="adr-input" 
              value={m.text} 
              onChange={(e) => setAdrMarkers(adrMarkers.map(x => x.id === m.id ? {...x, text: e.target.value} : x))} 
              placeholder="Enter script..." 
            />
            <button className="adr-del" onClick={() => setAdrMarkers(adrMarkers.filter(x => x.id !== m.id))}><Trash2 size={10}/></button>
          </div>
        ))}
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
