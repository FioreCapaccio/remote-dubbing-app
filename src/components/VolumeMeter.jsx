import React from 'react';

const VolumeMeter = ({ level }) => {
  // Level is in dBFS (-Infinity to 0)
  // We want to map this to a percentage (0% to 100%)
  // -60dB is silence, 0dB is full scale
  const minDb = -60;
  const percentage = Math.max(0, ((level - minDb) / Math.abs(minDb)) * 100);
  
  const getColor = () => {
    if (level > -3) return '#f43f5e'; // Red (Clipping risk)
    if (level > -12) return '#f59e0b'; // Orange
    return '#10b981'; // Green
  };

  return (
    <div style={{ width: '150px', height: '10px', background: '#334155', borderRadius: '5px', overflow: 'hidden', display: 'flex' }}>
      <div 
        style={{ 
          width: `${percentage}%`, 
          height: '100%', 
          background: getColor(), 
          transition: 'width 0.1s ease, background 0.2s ease',
          boxShadow: level > -3 ? '0 0 10px rgba(244, 63, 94, 0.8)' : 'none'
        }} 
      />
    </div>
  );
};

export default VolumeMeter;
