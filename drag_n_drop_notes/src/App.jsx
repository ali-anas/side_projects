import { useState } from 'react'
import Notes from './components/notes';
import './App.css'

function App() {
  const [notes, setNotes] = useState([{
    id: 1,
    text: 'First Note',
  }, {
    id: 2,
    text: 'Second Note',
  }]);

  return (
    <div>
      <Notes notes={notes} setNotes={setNotes} />
    </div>
  )
}

export default App
