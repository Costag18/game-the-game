import { useState, useRef } from 'react';
import PetSidebar from './PetSidebar.jsx';
import styles from './PetWithStream.module.css';

const STREAM_ID = '5vfaDsMhCF4'; // CBC News 24/7 live

export default function PetWithStream({ children }) {
  const [showControls, setShowControls] = useState(false);
  const hideTimerRef = useRef(null);

  function handleOverlayClick() {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 5000);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.streamBox}>
        <iframe
          src={`https://www.youtube.com/embed/${STREAM_ID}?autoplay=1&mute=1&controls=1&modestbranding=1`}
          title="CBC News Live"
          allow="autoplay; encrypted-media"
          allowFullScreen
          className={styles.streamFrame}
        />
        {!showControls && (
          <div className={styles.streamOverlay} onClick={handleOverlayClick} />
        )}
      </div>
      {children && <div className={styles.extraPanel}>{children}</div>}
      <div className={styles.petScroll}>
        <PetSidebar />
      </div>
    </div>
  );
}
