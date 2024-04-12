import { useEffect, useState, useRef } from 'react'
import './App.css';
import Pan from './utilities/PanState';

function App() {
  const [initialScope, setInitialScope] = useState({ lCards: [], rCards: [], targetCardId: 0});
  const [cardDimensions, setCardDimensions] = useState({ h: 0, w: 0});
  const cards = [ ...Array(20).keys() ].map( i => i+1);

  const cardRef = useRef(null);

  useEffect(() => {
    const { clientHeight, clientWidth } = cardRef.current;
    setCardDimensions({ h: clientHeight, w: clientWidth });
  }, []);

  let pan = Pan.getPanFor(cards, initialScope, cardDimensions);
  const { onTouchStart, onWheel, onMouseDown } = pan.listeners

  return (
    <main className="card__wrapper">
      <article className="card__container">
        <div className="card" ref={cardRef} onWheel={onWheel} onMouseDown={onMouseDown} onTouchStart={onTouchStart} role="presentation">
        </div>
      </article>
    </main>
  )
}

export default App
