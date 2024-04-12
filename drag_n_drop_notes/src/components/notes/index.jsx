import React, { useEffect, useRef } from 'react';
import Note from '../Note';


const Notes = (props) => {
  const { notes, setNotes } = props;
  const noteRefs = useRef([]);

  useEffect(() => {
    // localStorage notes
    const savedNotes = JSON.parse(localStorage.getItem("notes")) || [];

    const updatedNotes = notes.map(note => {
      const savedNote = savedNotes.find(savedNote => savedNote.id === note.id);

      if (savedNote) {
        return { ...note, position: savedNote.position};
      } else {
        const position = determineNewPosition();
        return { ...note, position: position };
      }
    });
    setNotes(updatedNotes);
    localStorage.setItem('notes', JSON.stringify(updatedNotes));
    console.log('useEffect');
  }, [notes.length]);

  const handleDragStart = (id, e) => {
    e.preventDefault();
    console.log('handleDrag start');
    const noteRef = noteRefs.current[id];
    const rect = noteRef.current.getBoundingClientRect();
    console.log('[D]', rect);
  }



  const determineNewPosition = () => {
    const maxX = window.innerWidth - 200;
    const maxY = window.innerHeight - 100;
    const x = Math.floor(Math.random() * maxX);
    const y = Math.floor(Math.random() * maxY);
    return { x, y };
  }

  const handleClick = () => {
    console.log('[D]', "clicked");
  }

  return (
    <>{notes.map((note, idx) => <Note ref={noteRefs.current[note.id] ? noteRefs.current[note.id] : (noteRefs.current[note.id] = React.createRef())} key={note.id} initialPos={note.position} content={note.text} setNotes={setNotes} onMouseDown={(e) => handleDragStart(note.id, e)} onClick={handleClick} />)}</>
  );
}

export default Notes;