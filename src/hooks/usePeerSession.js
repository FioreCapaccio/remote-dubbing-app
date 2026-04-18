import { useState, useEffect, useRef, useCallback } from 'react';
import * as PeerModule from 'peerjs';

// Defense against ESM/CJS mismatch across different bundlers/environments
const Peer = PeerModule.Peer || PeerModule.default || PeerModule;

export const usePeerSession = (roomName, role, onRemoteCommand) => {
  const [peerId, setPeerId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const peerRef = useRef(null);
  const callRef = useRef(null);
  const localStreamRef = useRef(null);
  const onRemoteCommandRef = useRef(onRemoteCommand);

  useEffect(() => {
    onRemoteCommandRef.current = onRemoteCommand;
  }, [onRemoteCommand]);

  useEffect(() => {
    if (!roomName) return;

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

    function setupConnection(conn) {
      setConnection(conn);
      conn.on('open', () => setIsConnected(true));
      conn.on('close', () => setIsConnected(false));
      conn.on('data', (data) => {
        if (onRemoteCommandRef.current) onRemoteCommandRef.current(data);
      });
    }

    peer.on('open', (id) => {
      setPeerId(id);
      if (role === 'guest') {
        const conn = peer.connect(fullRoomId);
        setupConnection(conn);
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

    return () => {
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

  return { peerId, isConnected, sendCommand, remoteStream, startTalkback, stopTalkback };
};
