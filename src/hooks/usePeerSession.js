import { useState, useEffect, useRef, useCallback } from 'react';
import * as PeerModule from 'peerjs';

// Defense against ESM/CJS mismatch across different bundlers/environments
const Peer = PeerModule.Peer || PeerModule.default || PeerModule;

// Configurazione PeerJS - usa server pubblico con fallback
const PEER_CONFIG = {
  // Server PeerJS pubblico (gratuito ma potenzialmente instabile)
  // In produzione, considera di usare un server dedicato
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  // Configurazione ICE per NAT traversal
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ]
  },
  // Retry configuration
  retry: {
    maxRetries: 5,
    retryDelay: 3000,
    backoffMultiplier: 1.5
  }
};

// connectionStatus: 'disconnected' | 'waiting' | 'connected'
export const usePeerSession = (roomName, role, onRemoteCommand, audioSettings = { sampleRate: 48000, bitDepth: 24 }) => {
  const [peerId, setPeerId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [connectionError, setConnectionError] = useState(null);

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const localStreamRef = useRef(null);
  const onRemoteCommandRef = useRef(onRemoteCommand);
  const reconnectTimerRef = useRef(null);
  const retryCountRef = useRef(0);
  const isDestroyedRef = useRef(false);
  const connectionRef = useRef(null);

  const [connections, setConnections] = useState([]);
  const connectionsRef = useRef([]);

  useEffect(() => {
    onRemoteCommandRef.current = onRemoteCommand;
  }, [onRemoteCommand]);

  // Funzione interna per avviare il talkback - può essere chiamata sia automaticamente che manualmente
  const startTalkbackInternal = useCallback(async (conn) => {
    if (!peerRef.current) {
      console.error('[PeerSession] Cannot start talkback - peer not initialized');
      return;
    }
    // Usa la connessione passata o quella nello state
    const targetConn = conn || connectionRef.current;
    if (!targetConn) {
      console.error('[PeerSession] Cannot start talkback - no connection available');
      return;
    }
    try {
      console.log('[PeerSession] Starting talkback...');
      // Audio di alta qualità per il direttore: usa le impostazioni audioSettings
      const audioConstraints = {
        audio: {
          channelCount: 1, // Force mono
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: audioSettings.sampleRate || 48000,
          sampleSize: audioSettings.bitDepth || 24
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
      console.log('[PeerSession] Got talkback stream:', stream.getAudioTracks()[0]?.getSettings());
      localStreamRef.current = stream;
      
      // Chiama l'altro peer e invia il proprio stream
      console.log('[PeerSession] Calling peer:', targetConn.peer);
      const call = peerRef.current.call(targetConn.peer, stream);
      callRef.current = call;
      
      // Se siamo l'host (director), riceviamo anche lo stream remoto dall'actor
      // quando l'actor risponde
      call.on('stream', (remote) => {
        console.log('[PeerSession] Received remote stream in talkback');
        setRemoteStream(remote);
      });
      
      call.on('error', (err) => {
        console.error('[PeerSession] Talkback call error:', err);
      });
      
      call.on('close', () => {
        console.log('[PeerSession] Talkback call closed');
      });
    } catch (err) {
      console.error("[PeerSession] Talkback error:", err);
    }
  }, []);

  useEffect(() => {
    if (!roomName) {
      setConnectionStatus('disconnected');
      setPeerId(null);
      setIsConnected(false);
      setConnectionError(null);
      return;
    }

    // Il roomName è ora il PIN a 4 cifre
    const fullRoomId = `vocal-sync-pin-${roomName}`;
    const myId = role === 'host' ? fullRoomId : `guest-${roomName}-${Date.now()}`;
    
    isDestroyedRef.current = false;
    retryCountRef.current = 0;

    let peer;
    try {
      if (!Peer || typeof Peer !== 'function') {
        throw new Error("PeerJS constructor not found. Verification: " + typeof Peer);
      }
      console.log('[PeerSession] Creating Peer with ID:', myId);
      console.log('[PeerSession] PeerJS config:', PEER_CONFIG);
      peer = new Peer(myId, PEER_CONFIG);
    } catch (err) {
      console.error("[PeerSession] PeerJS init error:", err);
      setConnectionError(err.message);
      return;
    }
    peerRef.current = peer;
    setConnectionStatus('waiting');

    function setupConnection(conn) {
      console.log('[PeerSession] Setting up data connection...');
      setConnection(conn);
      connectionRef.current = conn;
      
      // Track connections for host (director)
      if (role === 'host') {
        connectionsRef.current = [...connectionsRef.current, conn];
        setConnections(prev => [...prev, conn]);
      }
      
      conn.on('open', () => {
        console.log('[PeerSession] Data connection OPEN');
        setIsConnected(true);
        setConnectionStatus('connected');
        setConnectionError(null);
        retryCountRef.current = 0;
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        
        // Avvia automaticamente il talkback quando la connessione dati è aperta
        // Solo l'host (direttore) inizia la chiamata audio per ricevere lo stream del doppiatore
        if (role === 'host') {
          console.log('[PeerSession] Host auto-starting talkback...');
          // Piccolo delay per assicurarsi che la connessione sia stabile
          setTimeout(() => {
            if (!isDestroyedRef.current) {
              startTalkbackInternal(conn);
            }
          }, 500);
        }
      });
      
      conn.on('close', () => {
        console.log('[PeerSession] Data connection CLOSED');
        setIsConnected(false);
        setConnection(null);
        setConnectionStatus('waiting');
        
        // Remove from connections list for host
        if (role === 'host') {
          connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
          setConnections(prev => prev.filter(c => c !== conn));
        }
        
        // Auto-reconnect for guest side con backoff esponenziale
        if (role === 'guest' && peer && !peer.destroyed && !isDestroyedRef.current) {
          const delay = Math.min(
            PEER_CONFIG.retry.retryDelay * Math.pow(PEER_CONFIG.retry.backoffMultiplier, retryCountRef.current),
            30000 // Max 30 secondi
          );
          retryCountRef.current++;
          
          if (retryCountRef.current <= PEER_CONFIG.retry.maxRetries) {
            console.log(`[PeerSession] Reconnecting in ${delay}ms (attempt ${retryCountRef.current}/${PEER_CONFIG.retry.maxRetries})`);
            reconnectTimerRef.current = setTimeout(() => {
              if (peer && !peer.destroyed && !isDestroyedRef.current) {
                console.log('[PeerSession] Attempting to reconnect...');
                setupConnection(peer.connect(fullRoomId));
              }
            }, delay);
          } else {
            console.error('[PeerSession] Max retry attempts reached');
            setConnectionError('Failed to connect after multiple attempts');
          }
        }
      });
      
      conn.on('error', (err) => {
        console.error('[PeerSession] DataConnection error:', err);
        setConnectionError(err.message || 'Connection error');
        setIsConnected(false);
        setConnection(null);
        setConnectionStatus('waiting');
        
        if (role === 'guest' && peer && !peer.destroyed && !isDestroyedRef.current) {
          const delay = Math.min(
            PEER_CONFIG.retry.retryDelay * Math.pow(PEER_CONFIG.retry.backoffMultiplier, retryCountRef.current),
            30000
          );
          retryCountRef.current++;
          
          if (retryCountRef.current <= PEER_CONFIG.retry.maxRetries) {
            console.log(`[PeerSession] Reconnecting after error in ${delay}ms (attempt ${retryCountRef.current})`);
            reconnectTimerRef.current = setTimeout(() => {
              if (peer && !peer.destroyed && !isDestroyedRef.current) {
                setupConnection(peer.connect(fullRoomId));
              }
            }, delay);
          }
        }
      });
      
      conn.on('data', (data) => {
        console.log('[PeerSession] Received data:', data.type);
        if (onRemoteCommandRef.current) onRemoteCommandRef.current(data);
      });
    }

    peer.on('open', (id) => {
      console.log('[PeerSession] Peer opened with ID:', id);
      setPeerId(id);
      if (role === 'guest') {
        console.log('[PeerSession] Guest connecting to host:', fullRoomId);
        setupConnection(peer.connect(fullRoomId));
      }
    });

    peer.on('connection', (conn) => {
      console.log('[PeerSession] Host received connection from:', conn.peer);
      setupConnection(conn);
    });

    peer.on('call', (call) => {
      console.log('[PeerSession] Incoming call from:', call.peer);
      // Quando riceviamo una chiamata, rispondiamo con il nostro stream audio
      // Il guest (doppiatore) invia il proprio microfono con qualità alta usando audioSettings
      const audioConstraints = {
        audio: {
          channelCount: 1, // Force mono
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: audioSettings.sampleRate || 48000,
          sampleSize: audioSettings.bitDepth || 24
        }
      };
      navigator.mediaDevices.getUserMedia(audioConstraints).then(stream => {
        console.log('[PeerSession] Got local mic stream:', stream.getAudioTracks()[0]?.getSettings());
        localStreamRef.current = stream;
        call.answer(stream);
        console.log('[PeerSession] Answered call with high-quality local stream');
      }).catch((err) => {
        console.error('[PeerSession] Failed to get mic for call answer:', err);
        // Se non riusciamo ad ottenere il microfono, rispondiamo comunque
        call.answer();
      });
      
      call.on('stream', (remote) => {
        console.log('[PeerSession] Received remote stream from call');
        setRemoteStream(remote);
      });
      
      call.on('error', (err) => {
        console.error('[PeerSession] Call error:', err);
      });
      
      call.on('close', () => {
        console.log('[PeerSession] Call closed');
      });
    });

    peer.on('error', (err) => {
      console.error('[PeerSession] PeerJS error:', err.type, err.message || err);
      
      // Gestione specifica degli errori
      switch (err.type) {
        case 'peer-unavailable':
          console.warn('[PeerSession] Host not available (peer-unavailable)');
          setConnectionError('Host not available. Waiting for host to join...');
          break;
        case 'network':
          console.error('[PeerSession] Network error');
          setConnectionError('Network error. Check your connection.');
          break;
        case 'webrtc':
          console.error('[PeerSession] WebRTC error');
          setConnectionError('WebRTC connection failed. Try refreshing.');
          break;
        case 'disconnected':
          console.warn('[PeerSession] Peer disconnected from server');
          setConnectionStatus('waiting');
          break;
        case 'socket-error':
        case 'server-error':
          console.error('[PeerSession] PeerJS server error:', err.type);
          setConnectionError('Signaling server error. Retrying...');
          break;
        default:
          console.error('[PeerSession] Unknown PeerJS error:', err.type);
          setConnectionError(`Connection error: ${err.type}`);
      }
      
      if (err.type !== 'peer-unavailable') {
        setConnectionStatus('waiting');
      }
    });
    
    peer.on('disconnected', () => {
      console.warn('[PeerSession] Peer disconnected from signaling server');
      setConnectionStatus('waiting');
      
      // Tentativo di riconnessione al server di segnalazione
      if (peer && !peer.destroyed && !isDestroyedRef.current) {
        console.log('[PeerSession] Attempting to reconnect to signaling server...');
        setTimeout(() => {
          if (peer && !peer.destroyed && !isDestroyedRef.current) {
            peer.reconnect();
          }
        }, 2000);
      }
    });

    return () => {
      console.log('[PeerSession] Cleaning up PeerJS connection...');
      isDestroyedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (peer) peer.destroy();
    };
  }, [roomName, role, audioSettings]);

  const sendCommand = useCallback((cmd) => {
    if (connection && isConnected) {
      console.log('[PeerSession] Sending command:', cmd.type);
      connection.send(cmd);
    } else {
      console.warn('[PeerSession] Cannot send command - not connected');
    }
  }, [connection, isConnected]);

  // Invia blob audio dal guest al host
  const sendAudioBlob = useCallback((blob, metadata = {}) => {
    if (!connection || !isConnected) {
      console.warn('[PeerSession] Cannot send audio blob - not connected');
      return false;
    }
    
    // Il guest invia il blob audio al host
    if (role !== 'guest') {
      console.warn('[PeerSession] Only guest can send audio blob');
      return false;
    }

    console.log('[PeerSession] Sending audio blob:', blob.size, 'bytes');
    
    // Invia prima i metadati
    connection.send({
      type: 'AUDIO_BLOB_START',
      size: blob.size,
      mimeType: blob.type,
      ...metadata
    });
    
    // Invia il blob come ArrayBuffer
    blob.arrayBuffer().then(buffer => {
      connection.send({
        type: 'AUDIO_BLOB_DATA',
        buffer: buffer,
        mimeType: blob.type
      });
      console.log('[PeerSession] Audio blob sent successfully');
    }).catch(err => {
      console.error('[PeerSession] Error sending audio blob:', err);
    });
    
    return true;
  }, [connection, isConnected, role]);

  const disconnectUser = useCallback((conn) => {
    if (conn) {
      console.log('[PeerSession] Disconnecting user:', conn.peer);
      conn.close();
      connectionsRef.current = connectionsRef.current.filter(c => c !== conn);
      setConnections(prev => prev.filter(c => c !== conn));
    }
  }, []);

  const startTalkback = useCallback(async () => {
    console.log('[PeerSession] Manual startTalkback called');
    await startTalkbackInternal();
  }, [startTalkbackInternal]);

  const stopTalkback = useCallback(() => {
    console.log('[PeerSession] Stopping talkback...');
    if (callRef.current) {
      callRef.current.close();
      callRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  return { peerId, isConnected, connectionStatus, connectionError, sendCommand, sendAudioBlob, remoteStream, startTalkback, stopTalkback, connections, disconnectUser };
};
