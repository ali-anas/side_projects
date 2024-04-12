import { useRef } from 'react'
import './App.css'

function App() {

  const containerRef = useRef(null);

  const stars = Array(5).fill(0).map((_, index) => {
    return index;
  });

  const handleClick = (idx) => {
    const parentEle = containerRef.current;
    const childrens = parentEle.childNodes;
    console.log(idx);
    console.log('[]', parentEle);
    console.log('[]', childrens);

    for (let i = 0; i <= idx; i++) {
      childrens[i].className = 'star__glow';
    }
  }



  return (
    <div className="app">
      <div className="stars__wrapper" ref={containerRef}>
        {stars.map((star, idx) => (
          <span className="star" id="star_1" key={`star_${idx + 1}`} onClick={(idx) => handleClick(idx)}>&#9733;</span>
        ))}
      </div>  
    </div>
  )
}

export default App
