/**
 * VocalSync Audio Export Utility
 * Handles mixing multiple clips into a single WAV file using OfflineAudioContext.
 * Supports Pro ADR Standards: 44.1/48kHz, 16/24-bit.
 */

export async function renderMixdown(tracks, totalDuration, videoURL, settings = { sampleRate: 48000, bitDepth: 24 }) {
  const sampleRate = settings.sampleRate;
  const offlineCtx = new OfflineAudioContext(2, Math.max(1, sampleRate * totalDuration), sampleRate);

  // 1. Process Video/Original Track
  const videoTrack = tracks.find(t => t.id === 'video');
  if (videoTrack && !videoTrack.muted) {
    try {
      const response = await fetch(videoURL);
      const arrayBuffer = await response.arrayBuffer();
      const videoBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
      
      const source = offlineCtx.createBufferSource();
      source.buffer = videoBuffer;
      const gain = offlineCtx.createGain();
      gain.gain.value = videoTrack.volume;
      source.connect(gain);
      gain.connect(offlineCtx.destination);
      source.start(0);
    } catch (err) {
      console.warn("Could not include original video audio in mixdown:", err);
    }
  }

  // 2. Process Audio Tracks
  for (const track of tracks) {
    if (track.type === 'video' || track.muted) continue;
    
    for (const clip of track.clips) {
      try {
        const response = await fetch(clip.url);
        const arrayBuffer = await response.arrayBuffer();
        const clipBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
        
        const source = offlineCtx.createBufferSource();
        source.buffer = clipBuffer;
        const gain = offlineCtx.createGain();
        gain.gain.value = track.volume;
        source.connect(gain);
        gain.connect(offlineCtx.destination);
        
        source.start(clip.startTime, clip.mediaOffset || 0, clip.duration);
      } catch (err) {
        console.error(`Error rendering clip ${clip.id}:`, err);
      }
    }
  }

  // 3. Render
  const renderedBuffer = await offlineCtx.startRendering();

  // 4. Encode to WAV with Bit-Depth Selection
  const wavBlob = bufferToWav(renderedBuffer, settings.bitDepth);
  return wavBlob;
}

function bufferToWav(abuffer, bitDepth = 16) {
  const numOfChan = abuffer.numberOfChannels;
  const numSamples = abuffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numOfChan * bytesPerSample;

  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  let pos = 0;

  const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };

  // RIFF header
  setUint32(0x46464952);                        // "RIFF"
  setUint32(36 + dataSize);                     // file length - 8
  setUint32(0x45564157);                        // "WAVE"

  // fmt chunk
  setUint32(0x20746d66);                        // "fmt "
  setUint32(16);                                // chunk size
  setUint16(1);                                 // PCM
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * blockAlign);   // byte rate
  setUint16(blockAlign);
  setUint16(bitDepth);

  // data chunk
  setUint32(0x61746164);                        // "data"
  setUint32(dataSize);

  // Gather channel data
  const channels = [];
  for (let i = 0; i < numOfChan; i++) channels.push(abuffer.getChannelData(i));

  // Interleave samples (iterate by sample index, not byte position)
  for (let s = 0; s < numSamples; s++) {
    for (let c = 0; c < numOfChan; c++) {
      let sample = Math.max(-1, Math.min(1, channels[c][s] || 0));

      if (bitDepth === 24) {
        const int24 = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7FFFFF);
        view.setUint8(pos,     int24 & 0xFF);
        view.setUint8(pos + 1, (int24 >> 8)  & 0xFF);
        view.setUint8(pos + 2, (int24 >> 16) & 0xFF);
        pos += 3;
      } else {
        const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7FFF);
        view.setInt16(pos, int16, true);
        pos += 2;
      }
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
