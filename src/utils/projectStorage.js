/**
 * VocalSync Project Persistence Utility
 * Handles saving/loading projects using IndexedDB with base64 audio blob storage
 */

const DB_NAME = 'VocalSyncDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Convert Blob to Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Convert Base64 to Blob
function base64ToBlob(base64, type = 'audio/wav') {
  const byteString = atob(base64.split(',')[1]);
  const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString || type });
}

// Fetch and convert URL to base64
async function urlToBase64(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await blobToBase64(blob);
  } catch (err) {
    console.error('Failed to convert URL to base64:', err);
    return null;
  }
}

// Create a new project object from current state
export async function createProjectSnapshot(projectName, state) {
  const {
    cues,
    tracks,
    audioSettings,
    videoFileName,
    videoURL
  } = state;

  // Process tracks: convert clip URLs to base64 for persistence
  const processedTracks = await Promise.all(
    tracks.map(async (track) => {
      const processedClips = await Promise.all(
        (track.clips || []).map(async (clip) => {
          // Convert blob URL to base64 for storage
          let audioData = null;
          if (clip.url && clip.url.startsWith('blob:')) {
            audioData = await urlToBase64(clip.url);
          }
          return {
            id: clip.id,
            startTime: clip.startTime,
            duration: clip.duration,
            gain: clip.gain ?? 1,
            mediaOffset: clip.mediaOffset || 0,
            audioData // base64 encoded audio or null
          };
        })
      );

      return {
        id: track.id,
        name: track.name,
        volume: track.volume,
        muted: track.muted,
        solo: track.solo,
        type: track.type,
        clips: processedClips.filter(c => c.audioData !== null) // Only save clips with audio data
      };
    })
  );

  // Filter out tracks with no clips (except video track)
  const tracksToSave = processedTracks.filter(t => 
    t.type === 'video' || t.clips.length > 0
  );

  return {
    id: `project_${Date.now()}`,
    name: projectName || 'Untitled Project',
    timestamp: Date.now(),
    cues: cues.map(c => ({
      id: c.id,
      timeIn: c.timeIn,
      timeOut: c.timeOut,
      character: c.character || '',
      text: c.text || '',
      status: c.status || 'todo'
    })),
    tracks: tracksToSave,
    audioSettings: {
      sampleRate: audioSettings?.sampleRate || 48000,
      bitDepth: audioSettings?.bitDepth || 24,
      format: audioSettings?.format || 'wav'
    },
    videoFileName: videoFileName || null
    // Note: videoURL is not saved as it's a blob URL that can't be persisted
  };
}

// Save project to IndexedDB
export async function saveProject(projectName, state) {
  const db = await initDB();
  const snapshot = await createProjectSnapshot(projectName, state);
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(snapshot);
    
    request.onsuccess = () => resolve(snapshot);
    request.onerror = () => reject(request.error);
  });
}

// Load all saved projects (metadata only, without audio data)
export async function listProjects() {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev'); // Most recent first
    
    const projects = [];
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const { id, name, timestamp, cues, tracks, audioSettings, videoFileName } = cursor.value;
        projects.push({
          id,
          name,
          timestamp,
          cueCount: cues?.length || 0,
          clipCount: tracks?.reduce((sum, t) => sum + (t.clips?.length || 0), 0) || 0,
          audioSettings,
          videoFileName
        });
        cursor.continue();
      } else {
        resolve(projects);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Load a specific project by ID
export async function loadProject(projectId) {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(projectId);
    
    request.onsuccess = async () => {
      const data = request.result;
      if (!data) {
        reject(new Error('Project not found'));
        return;
      }

      // Reconstruct tracks with blob URLs from base64 data
      const reconstructedTracks = data.tracks.map(track => {
        const reconstructedClips = track.clips.map(clip => {
          // Convert base64 back to blob URL
          const blob = base64ToBlob(clip.audioData, 'audio/wav');
          const url = URL.createObjectURL(blob);
          
          return {
            id: clip.id,
            url,
            startTime: clip.startTime,
            duration: clip.duration,
            gain: clip.gain ?? 1,
            mediaOffset: clip.mediaOffset || 0
          };
        });

        return {
          id: track.id,
          name: track.name,
          volume: track.volume ?? 1,
          muted: track.muted ?? false,
          solo: track.solo ?? false,
          type: track.type || 'audio',
          clips: reconstructedClips
        };
      });

      // Ensure we have at least the default tracks
      const hasVideoTrack = reconstructedTracks.some(t => t.type === 'video');
      const hasAudioTrack = reconstructedTracks.some(t => t.id === 'track-1');

      const finalTracks = [...reconstructedTracks];
      if (!hasVideoTrack) {
        finalTracks.unshift({
          id: 'video',
          name: 'ORIGINAL FILMAUDIO',
          volume: 1,
          muted: false,
          solo: false,
          type: 'video',
          clips: []
        });
      }
      if (!hasAudioTrack) {
        finalTracks.push({
          id: 'track-1',
          name: 'LEAD VOCAL',
          volume: 1,
          muted: false,
          solo: false,
          type: 'audio',
          clips: []
        });
      }

      resolve({
        id: data.id,
        name: data.name,
        timestamp: data.timestamp,
        cues: data.cues || [],
        tracks: finalTracks,
        audioSettings: data.audioSettings || { sampleRate: 48000, bitDepth: 24, format: 'wav' },
        videoFileName: data.videoFileName || null
      });
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Delete a project
export async function deleteProject(projectId) {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(projectId);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Export project as JSON file (for backup/sharing)
export async function exportProjectToFile(projectName, state) {
  const snapshot = await createProjectSnapshot(projectName, state);
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_VocalSync.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Import project from JSON file
export async function importProjectFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Validate required fields
        if (!data.cues || !data.tracks || !data.audioSettings) {
          throw new Error('Invalid project file format');
        }
        
        // Assign new ID and timestamp
        data.id = `project_${Date.now()}`;
        data.timestamp = Date.now();
        
        // Save to IndexedDB
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await new Promise((res, rej) => {
          const req = store.put(data);
          req.onsuccess = () => res();
          req.onerror = () => rej(req.error);
        });
        
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
