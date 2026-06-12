import { useEffect, useRef, useState } from 'react';
import styles from './ChameleonClues.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function ChameleonCluesGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [votePick, setVotePick] = useState(null);
  const [cellPick, setCellPick] = useState(null);
  const [iReady, setIReady] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);
  const autoSubmitted = useRef(false);
  const draftRef = useRef('');
  draftRef.current = draft; // keep the latest typed clue reachable from the countdown closure

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const hasSubmittedClue = gameState?.hasSubmittedClue;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'reveal') { setIReady(false); playSound('roundStart'); }
    if (phase === 'clues') { setDraft(''); autoSubmitted.current = false; }
    if (phase === 'voting') { setVotePick(null); playSound('voteCast'); }
    if (phase === 'chameleonGuess') { setCellPick(null); }
    if (phase === 'finished') { playSound('roundStart'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(rem);
      // auto-submit the typed clue ~1s before the deadline so nothing is lost on timeout
      if (phase === 'clues' && rem <= 1 && !autoSubmitted.current && !hasSubmittedClue) {
        autoSubmitted.current = true;
        const t = draftRef.current.trim();
        if (t && !/\s/.test(t)) onAction({ type: 'submitClue', clue: t });
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, phase, hasSubmittedClue, onAction]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Blending in…</p></div>;

  const {
    myId, theme, grid = [], players = [], scores = {}, playerCount,
    isChameleon, targetIndex, targetWord,
    ready = [], myClue, cluesSubmitted,
    clues, myVote, hasVoted, votedCount, hasGuessed,
    chameleonId, accused, chameleonGuessIndex, outcome,
  } = gameState;

  function submitClue() {
    const t = draft.trim();
    if (!t || hasSubmittedClue) return;
    onAction({ type: 'submitClue', clue: t });
    playSound('click');
  }
  function castVote(targetId) {
    if (hasVoted || targetId === myId) return;
    setVotePick(targetId);
    onAction({ type: 'castVote', targetId });
    playSound('voteCast');
  }
  function guessCell(index) {
    if (hasGuessed) return;
    setCellPick(index);
  }
  function confirmGuess() {
    if (cellPick == null || hasGuessed) return;
    onAction({ type: 'guessCell', index: cellPick });
    playSound('click');
  }
  function ready_() { if (!iReady) { setIReady(true); onAction({ type: 'ready' }); } }

  const cluesPublic = Array.isArray(clues);
  const cluesByPlayer = cluesPublic
    ? Object.fromEntries(clues.map((c) => [c.playerId, c.clue]))
    : {};

  // grid cell highlight rules
  const renderGrid = (opts = {}) => {
    const { highlightTarget = false, picker = false, revealGuess = false } = opts;
    return (
      <div className={styles.grid}>
        {grid.map((w, i) => {
          const isTarget = highlightTarget && targetIndex === i;
          const isFinalTarget = revealGuess && targetIndex === i;
          const isGuess = revealGuess && chameleonGuessIndex === i;
          const isPicked = picker && cellPick === i;
          return (
            <button
              key={i}
              className={[
                styles.cell,
                isTarget ? styles.cellTarget : '',
                isFinalTarget ? styles.cellTarget : '',
                isGuess ? styles.cellGuess : '',
                isPicked ? styles.cellPicked : '',
                picker && !hasGuessed ? styles.cellTappable : '',
              ].join(' ')}
              disabled={!picker || hasGuessed}
              onClick={() => picker && guessCell(i)}
            >
              {w}
              {isFinalTarget && <span className={styles.cellTag}>secret</span>}
              {isGuess && !isFinalTarget && <span className={styles.cellTag}>guess</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>CHAMELEON</h1>
        <span className={styles.theme}>Theme: {theme}</span>
        {remaining != null && phase !== 'finished' && <span className={styles.clock}>{remaining}s</span>}
      </div>

      {/* REVEAL — private role card */}
      {phase === 'reveal' && (
        <div className={styles.section}>
          {isChameleon ? (
            <div className={styles.roleCardChameleon}>
              <p className={styles.roleBig}>YOU ARE THE CHAMELEON 🦎</p>
              <p className={styles.roleSub}>You do NOT know the secret word. Blend in — give a clue that sounds right.</p>
            </div>
          ) : (
            <div className={styles.roleCardCrew}>
              <p className={styles.roleBig}>The secret word is</p>
              <p className={styles.secretWord}>{targetWord}</p>
              <p className={styles.roleSub}>Hint it with a one-word clue — but don't make it obvious to the chameleon.</p>
            </div>
          )}
          {renderGrid({ highlightTarget: !isChameleon })}
          {!iReady ? (
            <button className={styles.primaryBtn} onClick={ready_}>I'm ready</button>
          ) : (
            <AckStatus players={players} acknowledged={ready} me={myId} iActed={iReady} nicknames={nicknames} avatars={avatars} />
          )}
        </div>
      )}

      {/* CLUES — simultaneous one-word submit */}
      {phase === 'clues' && (
        <div className={styles.section}>
          {!isChameleon ? (
            <p className={styles.bannerCrew}>Secret word: <strong>{targetWord}</strong></p>
          ) : (
            <p className={styles.bannerChameleon}>You're the chameleon — bluff a clue that fits the theme.</p>
          )}
          {renderGrid({ highlightTarget: !isChameleon })}
          {hasSubmittedClue ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>Clue submitted: <strong>{myClue}</strong> 🤫</p>
              <p className={styles.sub}>Waiting for clues… {cluesSubmitted}/{playerCount}</p>
            </div>
          ) : (
            <div className={styles.writeBox}>
              <input
                className={styles.input}
                value={draft}
                maxLength={32}
                placeholder="One word only…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitClue(); }}
                autoFocus
              />
              {/\s/.test(draft.trim()) && draft.trim() && (
                <p className={styles.reject}>One word only — no spaces.</p>
              )}
              <button
                className={styles.primaryBtn}
                onClick={submitClue}
                disabled={!draft.trim() || /\s/.test(draft.trim())}
              >
                Submit clue
              </button>
            </div>
          )}
        </div>
      )}

      {/* VOTING — secret vote for the chameleon */}
      {phase === 'voting' && (
        <div className={styles.section}>
          <p className={styles.heading}>Who is the chameleon?</p>
          {cluesPublic && (
            <div className={styles.clueList}>
              {clues.map((c) => (
                <div key={c.playerId} className={styles.clueRow}>
                  <PlayerName playerId={c.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.clueWord}>{c.clue}</span>
                </div>
              ))}
            </div>
          )}
          {hasVoted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>
                Voted for <PlayerName playerId={myVote || votePick} nicknames={nicknames} avatars={avatars} /> 🔒
              </p>
              <p className={styles.sub}>Votes in… {votedCount}/{playerCount}</p>
            </div>
          ) : (
            <div className={styles.voteGrid}>
              {players.map((pid) => (
                <button
                  key={pid}
                  className={`${styles.voteBtn} ${votePick === pid ? styles.voteSel : ''}`}
                  disabled={pid === myId}
                  onClick={() => castVote(pid)}
                >
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} size={26} />
                  {pid === myId && <span className={styles.youTag}>you</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CHAMELEON GUESS */}
      {phase === 'chameleonGuess' && (
        <div className={styles.section}>
          {isChameleon ? (
            <>
              <p className={styles.heading}>You're caught? Maybe. Guess the secret word to win!</p>
              {renderGrid({ picker: true })}
              {!hasGuessed && (
                <button className={styles.primaryBtn} onClick={confirmGuess} disabled={cellPick == null}>
                  Lock in my guess
                </button>
              )}
              {hasGuessed && <p className={styles.sub}>Guess locked. Revealing…</p>}
            </>
          ) : (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>The chameleon is guessing the secret word…</p>
              <p className={styles.sub}>Hold tight.</p>
            </div>
          )}
        </div>
      )}

      {/* FINISHED — full reveal + scoreboard */}
      {phase === 'finished' && outcome && (
        <div className={styles.section}>
          <div className={`${styles.outcomeBox} ${outcome.chameleonWon ? styles.outcomeChameleon : styles.outcomeCrew}`}>
            <p className={styles.outcomeLine}>
              The chameleon was <PlayerName playerId={chameleonId} nicknames={nicknames} avatars={avatars} size={24} /> 🦎
            </p>
            <p className={styles.outcomeResult}>
              {outcome.chameleonWon ? 'The chameleon WINS! 🦎🏆' : 'The crew caught the chameleon! 🎯'}
            </p>
            <p className={styles.outcomeDetail}>
              {accused
                ? <>Accused: <PlayerName playerId={accused} nicknames={nicknames} avatars={avatars} /> — {outcome.caught ? 'correct' : 'wrong person'}.</>
                : 'No one was clearly accused (tie / no votes).'}
              {' '}{outcome.guessedRight ? 'And the chameleon guessed the word!' : ''}
            </p>
          </div>

          {renderGrid({ revealGuess: true })}

          {Array.isArray(clues) && (
            <div className={styles.clueList}>
              {clues.map((c) => (
                <div key={c.playerId} className={`${styles.clueRow} ${c.playerId === chameleonId ? styles.clueChameleon : ''}`}>
                  <PlayerName playerId={c.playerId} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.clueWord}>{c.clue}{c.playerId === chameleonId ? ' 🦎' : ''}</span>
                </div>
              ))}
            </div>
          )}

          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
