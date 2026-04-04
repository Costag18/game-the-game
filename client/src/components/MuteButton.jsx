import { useSound } from '../context/SoundContext.jsx';
import styles from './MuteButton.module.css';

export default function MuteButton() {
  const { muted, toggleMute } = useSound();

  return (
    <button
      className={`${styles.muteBtn} ${muted ? styles.muted : ''}`}
      onClick={toggleMute}
      title={muted ? 'Unmute sounds' : 'Mute sounds'}
    >
      {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
    </button>
  );
}
