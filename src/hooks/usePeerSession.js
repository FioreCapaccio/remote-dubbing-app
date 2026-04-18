import { useState, useEffect, useRef, useCallback } from 'react';
import * as PeerModule from 'peerjs';

// Defense against ESM/CJS mismatch across different bundlers/environments
const Peer = PeerModule.Peer || PeerModule.default || PeerModule;

// connectionStatus: 'disconnected' | 'waiting' | 'connected'
export const usePeerSession = (roomName, role, onRemoteCommand) => {
  const [peerId, setPeerId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const localStreamRef = useRef(null);
  const onRemoteCommandRef = useRef(onRemoteCommand);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    onRemoteCommandRef.current = onRemoteCommand;
  }, [onRemoteCommand]);

  useEffect(() => {
    if (!roomName) {
      setConnectionStatus('disconnected');
      setPeerId(null);
      setIsConnected(false);
      return;
    }

    const fullRoomId = `vocal-sync-room-${roomName}`;
    const myId = role === 'host' ? fullRoomId : `guest-${Date.now()}`;

    let peer;
    try {
      if (!Peer || typeof Peer !== 'function') {
        throw new Error("PeerJS constructor not found. Verification: " + typeof Peer);
      }
      peer = new Peer(myId);
    } catch (err) {
      console.error("PeerJS init error:", err);
      return;
    }
    peerRef.current = peer;
    setConnectionStatus('waiting');

    function setupConnection(conn) {
      setConnection(conn);
      conn.on('open', () => {
        setIsConnected(true);
        setConnectionStatus('connected');
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      });
      conn.on('close', () => {
        setIsConnected(false);
        setConnection(null);
        setConnectionStatus('waiting');
        // Auto-reconnect for guest side
        if (role === 'guest' && peer && !peer.destroyed) {
          reconnectTimerRef.current = setTimeout(() => {
            if (peer && !peer.destroyed) {
              setupConnection(peer.connect(fullRoomId));
            }
          }, 3000);
        }
      });
      conn.on('error', (err) => {
        console.warn('DataConnection error:', err);
        setIsConnected(false);
        setConnection(null);
        setConnectionStatus('waiting');
        if (role === 'guest' && peer && !peer.destroyed) {
          reconnectTimerRef.current = setTimeout(() => {
            if (peer && !peer.destroyed) {
              setupConnection(peer.connect(fullRoomId));
            }
          }, 3000);
        }
      });
      conn.on('data', (data) => {
        if (onRemoteCommandRef.current) onRemoteCommandRef.current(data);
      });
    }

    peer.on('open', (id) => {
      setPeerId(id);
      if (role === 'guest') {
        setupConnection(peer.connect(fullRoomId));
      }
    });

    peer.on('connection', (conn) => {
      setupConnection(conn);
    });

    peer.on('call', (call) => {
      call.answer();
      call.on('stream', (remote) => {
        setRemoteStream(remote);
      });
    });

    peer.on('error', (err) => {
      console.warn('PeerJS error:', err.type, err.message || err);
      if (err.type !== 'peer-unavailable') {
        setConnectionStatus('waiting');
      }
    });

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peer) peer.destroy();
    };
  }, [roomName, role]);

  const sendCommand = useCallback((cmd) => {
    if (connection && isConnected) {
      connection.send(cmd);
    }
  }, [connection, isConnected]);

  const startTalkback = useCallback(async () => {
    if (!peerRef.current || role === 'guest') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      if (connection) {
        const call = peerRef.current.call(connection.peer, stream);
        callRef.current = call;
      }
    } catch (err) {
      console.error("Talkback error:", err);
    }
  }, [role, connection]);

  const stopTalkback = useCallback(() => {
    if (callRef.current) {
      callRef.current.close();
      callRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  return { peerId, isConnected, connectionStatus, sendCommand, remoteStream, startTalkback, stopTalkback };
};
