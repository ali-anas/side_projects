import { useState } from 'react';
import ProgressBar from './components/ProgressBar';
import './App.css'
import { useEffect } from 'react';

function App() {
  const [value, setValue] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      if (value >= 100) {
        clearInterval(timer); 
        return;
      }
      setValue(value => value + 1);
    }, 100);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="app">
      <span>Progress Bar</span>
      <ProgressBar value={value} onComplete={() => setIsComplete(true)} />
      <span>{isComplete ? 'Completed!' : 'In Progress...'}</span>
    </div>
  )
}

export default App
