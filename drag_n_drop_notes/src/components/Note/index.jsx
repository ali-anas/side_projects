import React, { forwardRef } from 'react'

const Note = forwardRef(({ content, initialPos, ...props}, ref) => {
  console.log('[D]', 'ref: ', ref);
  return (
    <div ref={ref} style={{ position: 'absolute', left: `${initialPos?.x}px`, top: `${initialPos?.y}px}`, border: '1px solid black', userSelect: 'none', width: '200px', height: '100px', cursor: 'move', backgroundColor: 'lightyellow' }}>{content}</div>
  )
});

export default Note;