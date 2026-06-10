import { useEffect, useRef, useState } from 'react';
import styles from './RansomNote.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function RansomNoteGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [note, setNote] = useState([]); // array of {emoji, key} so duplicates from the hand are distinguishable
  const [iActed, setIActed] = useState(false);
  const prevRound = useRef(null);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const roundNumber = gameState?.roundNumber;
  const minNote = gameState?.minNote ?? 3;
  const maxNote = gameState?.maxNote ?? 5;

  // Reset local composition on a new round or when the draw phase (re)starts.
  useEffect(() => {
    if (roundNumber !== prevRound.current) {
      setNote([]);
      setIActed(false);
      prevRound.current = roundNumber;
    }
  }, [roundNumber]);

  useEffect(() => {
    if (phase !== prevPhase.current) {
      if (phase === 'draw') { setNote([]); setIActed(false); }
      if (phase === 'vote') setIActed(false);
      if (phase === 'reveal') setIActed(false);
      prevPhase.current = phase;
    }
  }, [phase]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Dealing emoji…</p></div>;
  }

  const {
    word, scores = {}, myId, myHand, hasSubmitted, submittedCount, playerCount,
    gallery, myVote, votedCount, totalRounds, reveal, acknowledged = [],
  } = gameState;

  // ----- hand index tracking: which hand slots are already used in the note -----
  const usedSlots = new Set(note.map((n) => n.slot));

  function addEmoji(emoji, slot) {
    if (phase !== 'draw' || hasSubmitted) return;
    if (note.length >= maxNote) return;
    if (usedSlots.has(slot)) return;
    playSound('click');
    setNote((n) => [...n, { emoji, slot }]);
  }
  function removeFromNote(idx) {
    if (phase !== 'draw' || hasSubmitted) return;
    playSound('click');
    setNote((n) => n.filter((_, i) => i !== idx));
  }
  function submitNote() {
    if (note.length < minNote || note.length > maxNote) return;
    onAction({ type: 'submit', emojis: note.map((n) => n.emoji) });
    setIActed(true);
    playSound('vote');
  }
  function castVote(entryId) {
    if (myVote != null) return;
    onAction({ type: 'vote', entryId });
    playSound('vote');
  }
  function acknowledge() {
    setIActed(true);
    onAction({ type: 'acknowledge' });
    playSound('click');
  }

  const orderedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>RANSOM NOTE</h1>
        <span className={styles.round}>Round {roundNumber}/{totalRounds}</span>
      </div>

      {/* ---------------- DRAW: compose your emoji note ---------------- */}
      {phase === 'draw' && (
        <div className={styles.section}>
          <div className={styles.wordCard}>
            <span className={styles.wordLabel}>Spell out without writing it:</span>
            <span className={styles.theWord}>{word}</span>
          </div>

          {hasSubmitted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Note delivered ✉️</p>
              <p className={styles.sub}>{submittedCount}/{playerCount} notes in…</p>
              <div className={styles.noteStrip}>
                {(gameState.myNote || []).map((e, i) => <span key={i} className={styles.noteEmoji}>{e}</span>)}
              </div>
            </div>
          ) : (
            <>
              <div className={styles.noteSlots}>
                {note.length === 0 && <span className={styles.notePlaceholder}>Tap emoji below to build your note…</span>}
                {note.map((n, i) => (
                  <button key={i} className={styles.noteEmojiBtn} onClick={() => removeFromNote(i)} title="Remove">
                    {n.emoji}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>
                Use {minNote}–{maxNote} emoji ({note.length} chosen)
              </p>

              <div className={styles.hand}>
                {(myHand || []).map((emoji, slot) => (
                  <button
                    key={slot}
                    className={`${styles.handTile} ${usedSlots.has(slot) ? styles.handUsed : ''}`}
                    disabled={usedSlots.has(slot) || note.length >= maxNote}
                    onClick={() => addEmoji(emoji, slot)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <button
                className={styles.primaryBtn}
                disabled={note.length < minNote || note.length > maxNote}
                onClick={submitNote}
              >
                Send Note
              </button>
            </>
          )}
        </div>
      )}

      {/* ---------------- VOTE: anonymous gallery ---------------- */}
      {phase === 'vote' && (
        <div className={styles.section}>
          <div className={styles.wordCard}>
            <span className={styles.wordLabel}>The word was:</span>
            <span className={styles.theWord}>{word}</span>
          </div>
          <p className={styles.sub}>Vote the cleverest note ({votedCount}/{playerCount} voted)</p>
          <div className={styles.gallery}>
            {(gallery || []).map((e) => {
              const selected = myVote === e.entryId;
              return (
                <button
                  key={e.entryId}
                  className={`${styles.galleryCard} ${selected ? styles.gallerySel : ''} ${e.isMine ? styles.galleryMine : ''}`}
                  disabled={e.isMine || myVote != null}
                  onClick={() => castVote(e.entryId)}
                >
                  <div className={styles.galleryEmojis}>
                    {e.emojis.map((em, i) => <span key={i} className={styles.galleryEmoji}>{em}</span>)}
                  </div>
                  {e.isMine && <span className={styles.mineTag}>your note</span>}
                  {selected && <span className={styles.votedTag}>✓ voted</span>}
                </button>
              );
            })}
          </div>
          {myVote != null && <p className={styles.waitMsg}>Vote locked — waiting on others…</p>}
        </div>
      )}

      {/* ---------------- REVEAL ---------------- */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.section}>
          <div className={styles.wordCard}>
            <span className={styles.wordLabel}>The word was:</span>
            <span className={styles.theWord}>{reveal.word}</span>
          </div>
          <div className={styles.gallery}>
            {[...reveal.entries].sort((a, b) => b.votes - a.votes).map((e) => (
              <div key={e.entryId} className={`${styles.revealCard} ${e.authorId === myId ? styles.revealMine : ''}`}>
                <div className={styles.galleryEmojis}>
                  {e.emojis.map((em, i) => <span key={i} className={styles.galleryEmoji}>{em}</span>)}
                </div>
                <div className={styles.revealMeta}>
                  <PlayerName playerId={e.authorId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.voteCount}>{e.votes} {e.votes === 1 ? 'vote' : 'votes'}</span>
                </div>
              </div>
            ))}
          </div>
          {phase === 'reveal' && (
            <>
              <button className={styles.primaryBtn} disabled={iActed || acknowledged.includes(myId)} onClick={acknowledge}>
                Continue
              </button>
              <AckStatus
                players={Object.keys(scores)}
                acknowledged={acknowledged}
                me={myId}
                iActed={iActed}
                nicknames={nicknames}
                avatars={avatars}
              />
            </>
          )}
        </div>
      )}

      {/* ---------------- SCOREBOARD ---------------- */}
      <div className={styles.scoreboard}>
        {orderedScores.map(([pid, sc]) => (
          <div key={pid} className={styles.scoreRow}>
            <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
            <span className={styles.scoreVal}>{sc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
