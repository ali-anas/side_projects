import { useState, useRef } from 'react'
import './App.css'

function App() {
  const containerRef = useRef(null);

  const getNewElement = () => {
    const elem = document.createElement('span');
    elem.className = 'point';
    return elem;
  };

  let frameId;

  const animate = (timestamp) => {
    const container = containerRef.current;
    console.log('hey', container);
    const childElement = getNewElement();
    container.appendChild(childElement);
    frameId = requestAnimationFrame(animate);
  }
  const handleStartClick = () => {
    frameId = requestAnimationFrame(animate);
  };

  const handeResetClick = () => {
    const container = containerRef.current;
    while (container.lastChild) {
      container.removeChild(container.lastChild);
    }
    const childElement = getNewElement();
    container.appendChild(childElement);
  }
  const handleStopClick = () => {
    cancelAnimationFrame(frameId);
  };

  return (
    <div className="app">
      <h1>Request Animation Frame Example</h1>
      <button onClick={handleStartClick}>Start</button>
      <button onClick={handleStopClick}>Stop</button>
      <button onClick={handeResetClick}>Reset</button>

      <div ref={containerRef} className="container">
        <span className="point" />
      </div>
    </div>
  )
}

export default App
