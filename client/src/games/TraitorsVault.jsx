import { useEffect, useRef, useState } from 'react';
import styles from './TraitorsVault.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

export default function TraitorsVaultGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [pick, setPick] = useState(null);      // eject-vote target
  const [iAcked, setIAcked] = useState(false);
  const [iReady, setIReady] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const prevPhase = useRef(null);
  const prevStage = useRef(0);

  const phase = gameState?.phase;
  const deadline = gameState?.deadline;
  const stageIndex = gameState?.stageIndex;

  useEffect(() => {
    if (phase === prevPhase.current && stageIndex === prevStage.current) return;
    if (phase === 'reveal') { setIReady(false); playSound('roundStart'); }
    if (phase === 'stage') { playSound('roundStart'); }
    if (phase === 'stageResult') { setIAcked(false); playSound('voteCast'); }
    if (phase === 'ejectVote') { setPick(null); playSound('roundStart'); }
    prevPhase.current = phase;
    prevStage.current = stageIndex;
  }, [phase, stageIndex, playSound]);

  // countdown to the active deadline
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);

  if (!gameState) {
    return <div className={styles.arena}><p className={styles.loading}>Casing the vault…</p></div>;
  }

  const {
    myId, myRole, amEjected, totalStages, stagesPassed, crackThreshold, ejectAfterStage,
    players = [], activePlayers = [], ejectedPlayers = [], scores = {}, history = [],
    ready = [], iAmReady, readyCount, playerCount,
    myMove, hasSubmittedMove, submittedCount, activeCount,
    stageResult, acknowledged = [],
    myEjectVote, hasEjectVoted, ejectVotedCount,
    outcome,
  } = gameState;

  const isTraitor = myRole === 'TRAITOR';

  function ready_() { if (!iReady) { setIReady(true); onAction({ type: 'ready' }); playSound('click'); } }
  function move(m) {
    if (hasSubmittedMove || amEjected) return;
    onAction({ type: 'submitMove', move: m });
    playSound(m === 'sabotage' ? 'voteCast' : 'click');
  }
  function castEject(targetId) {
    if (hasEjectVoted || amEjected) return;
    setPick(targetId);
    onAction({ type: 'castEject', targetId });
    playSound('click');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  const chosenVote = myEjectVote || pick;
  const ackReady = iReady || iAmReady;

  // progress pips for the 5 stages
  const pips = Array.from({ length: totalStages }, (_, i) => {
    const h = history.find((x) => x.stage === i + 1);
    if (h) return h.passed ? 'pass' : 'fail';
    if (i + 1 === stageIndex && (phase === 'stage' || phase === 'stageResult')) return 'live';
    return 'pending';
  });

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>TRAITOR&apos;S VAULT</h1>
        {phase !== 'finished' && phase !== 'reveal' && (
          <span className={styles.meta}>Stage {Math.min(stageIndex, totalStages)} / {totalStages}</span>
        )}
      </div>

      {/* progress + crack meter (always visible after reveal) */}
      {phase !== 'reveal' && (
        <div className={styles.progress}>
          <div className={styles.pips}>
            {pips.map((s, i) => (
              <span key={i} className={`${styles.pip} ${styles[`pip_${s}`]}`} title={`Stage ${i + 1}`}>
                {s === 'pass' ? '✓' : s === 'fail' ? '✕' : i + 1}
              </span>
            ))}
          </div>
          <p className={styles.crackLine}>
            Stages cracked: <strong>{stagesPassed}</strong> / need <strong>{crackThreshold}</strong>
          </p>
        </div>
      )}

      {(phase === 'stage' || phase === 'ejectVote') && remaining != null && (
        <div className={styles.clockBar}><span className={styles.clock}>{remaining}s</span></div>
      )}

      {/* ---------- REVEAL: private role card ---------- */}
      {phase === 'reveal' && (
        <div className={styles.revealWrap}>
          <div className={`${styles.roleCard} ${isTraitor ? styles.roleTraitor : styles.roleLoyal}`}>
            <span className={styles.roleIcon}>{isTraitor ? '🕵️' : '🔐'}</span>
            <span className={styles.roleLabel}>You are {isTraitor ? 'a TRAITOR' : 'LOYAL'}</span>
            <span className={styles.roleHint}>
              {isTraitor
                ? 'Secretly sabotage stages so fewer than 4 crack. Stay hidden — survive the eject vote.'
                : 'Help every stage crack. Spot the saboteur and eject them after stage 3.'}
            </span>
          </div>
          {remaining != null && <p className={styles.sub}>Starting in {remaining}s…</p>}
          {!ackReady ? (
            <button className={styles.primaryBtn} onClick={ready_}>I&apos;m ready →</button>
          ) : (
            <p className={styles.waitMsg}>Locked in — waiting… {readyCount}/{playerCount}</p>
          )}
          <AckStatus players={players} acknowledged={ready} me={myId} iActed={iReady} nicknames={nicknames} avatars={avatars} />
        </div>
      )}

      {/* ---------- STAGE: private help / sabotage ---------- */}
      {phase === 'stage' && (
        <div className={styles.stageWrap}>
          <p className={styles.roleTag}>
            Your role: <strong className={isTraitor ? styles.tTrait : styles.tLoyal}>{isTraitor ? 'TRAITOR' : 'LOYAL'}</strong>
          </p>
          {amEjected ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>You were ejected 🚪</p>
              <p className={styles.sub}>Sit tight — the crew finishes stages {ejectAfterStage + 1}–{totalStages}.</p>
            </div>
          ) : hasSubmittedMove ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>
                {myMove === 'sabotage' ? 'Sabotage planted 💣' : 'Helping the crack 🤝'}
              </p>
              <p className={styles.sub}>Waiting… {submittedCount}/{activeCount} acted</p>
            </div>
          ) : (
            <>
              <p className={styles.stagePrompt}>Stage {stageIndex}: make your move (secret)</p>
              <div className={styles.moveRow}>
                <button className={`${styles.moveBtn} ${styles.helpBtn}`} onClick={() => move('help')}>
                  <span className={styles.moveIcon}>🤝</span>
                  <span>Help the crack</span>
                </button>
                <button className={`${styles.moveBtn} ${styles.sabBtn}`} onClick={() => move('sabotage')}>
                  <span className={styles.moveIcon}>💣</span>
                  <span>Sabotage</span>
                </button>
              </div>
              <p className={styles.hint}>
                {isTraitor
                  ? 'Sabotage to block the crack — but a sabotaged stage fails, which could expose you.'
                  : 'Loyal crew should Help. (Only a traitor benefits from sabotage.)'}
              </p>
            </>
          )}
        </div>
      )}

      {/* ---------- STAGE RESULT: pass/fail + count (never who) ---------- */}
      {phase === 'stageResult' && stageResult && (
        <div className={styles.resultWrap}>
          <div className={`${styles.resultCard} ${stageResult.passed ? styles.resPass : styles.resFail}`}>
            <span className={styles.resBig}>{stageResult.passed ? 'STAGE CRACKED ✓' : 'STAGE FAILED ✕'}</span>
            <span className={styles.resSub}>
              {stageResult.sabotageCount === 0
                ? 'No sabotage detected.'
                : `${stageResult.sabotageCount} saboteur${stageResult.sabotageCount === 1 ? '' : 's'} struck this stage…`}
            </span>
          </div>
          {phase === 'stageResult' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={players} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
        </div>
      )}

      {/* ---------- EJECT VOTE ---------- */}
      {phase === 'ejectVote' && (
        <div className={styles.ejectWrap}>
          <p className={styles.ejectTitle}>🗳️ Eject Vote</p>
          <p className={styles.ejectSub}>Discuss, then secretly vote out who you think is sabotaging. Ejecting a traitor rewards the crew.</p>
          {amEjected ? (
            <p className={styles.waitMsg}>You&apos;re out of the vote.</p>
          ) : hasEjectVoted ? (
            <div className={styles.waitBox}>
              <p className={styles.waitMsg}>
                Voted to eject <PlayerName playerId={chosenVote} nicknames={nicknames} avatars={avatars} /> 🔒
              </p>
              <p className={styles.sub}>Waiting… {ejectVotedCount}/{activeCount} voted</p>
            </div>
          ) : (
            <div className={styles.voteGrid}>
              {activePlayers.filter((p) => p !== myId).map((pid) => (
                <button
                  key={pid}
                  className={`${styles.voteBtn} ${chosenVote === pid ? styles.voteSel : ''}`}
                  onClick={() => castEject(pid)}
                >
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} size={26} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- FINISHED: full reveal ---------- */}
      {phase === 'finished' && outcome && (
        <div className={styles.finishWrap}>
          <div className={`${styles.outcomeCard} ${outcome.vaultCracked ? styles.outLoyal : styles.outTraitor}`}>
            <span className={styles.outBig}>
              {outcome.vaultCracked ? '🔓 VAULT CRACKED' : '💣 HEIST SABOTAGED'}
            </span>
            <span className={styles.outSub}>
              {outcome.vaultCracked
                ? `The loyal crew cracked ${outcome.stagesPassed}/${totalStages} stages. Loyal wins!`
                : `Only ${outcome.stagesPassed}/${totalStages} stages cracked. The traitors win!`}
            </span>
            {outcome.ejectedId && (
              <span className={styles.outEject}>
                Ejected: <PlayerName playerId={outcome.ejectedId} nicknames={nicknames} avatars={avatars} />
                {' '}— {outcome.caughtTraitor ? 'a TRAITOR! Crew +200 each 🎯' : 'was LOYAL… oops.'}
              </span>
            )}
          </div>

          <div className={styles.rolesReveal}>
            <p className={styles.boardTitle}>Roles revealed</p>
            {players.map((pid) => {
              const role = outcome.roles[pid];
              const wasEjected = ejectedPlayers.includes(pid);
              return (
                <div key={pid} className={`${styles.roleRow} ${role === 'TRAITOR' ? styles.rrTrait : styles.rrLoyal}`}>
                  <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                  <span className={styles.roleBadge}>
                    {role === 'TRAITOR' ? '🕵️ TRAITOR' : '🔐 LOYAL'}{wasEjected ? ' · ejected' : ''}
                  </span>
                </div>
              );
            })}
          </div>

          <div className={styles.scoreboard}>
            <p className={styles.boardTitle}>Scores</p>
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
