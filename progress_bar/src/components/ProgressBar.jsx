import React, { useState, useEffect } from 'react';
import { MAX, MIN } from '../constants';

const ProgressBar = ({ value = MIN, onComplete }) => {
  const [progress, setProgress] = useState(value);

  useEffect(() => {
    setProgress(Math.min(MAX, Math.max(MIN, value)));
    if (progress >= 100) {
      onComplete();
    }
  }, [value]);

  return (
    <div className="progress">
      <span style={{ color: progress > 49 ? 'white' : 'black'}}>{`${progress.toFixed()}%`}
    </span>
      <div
        role="progressbar"
        aria-valuemin={MIN} 
        aria-valuemax={MAX} 
        aria-valuenow={progress.toFixed()} 
        style={{
          transform: `scaleX(${progress / MAX})`,
          transformOrigin: 'left',
        }}></div>
    </div>
  )
}

export default ProgressBar;