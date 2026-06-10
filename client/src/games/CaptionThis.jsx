import { useEffect, useRef, useState } from 'react';
import styles from './CaptionThis.module.css';
import PlayerName from '../components/PlayerName.jsx';
import AckStatus from '../components/AckStatus.jsx';
import { useSound } from '../context/SoundContext.jsx';

function pollinationsUrl(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
}

function Countdown({ deadline }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  return <span className={styles.timer}>{left}s</span>;
}

function SceneImage({ prompt }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [prompt]);
  if (!prompt) return null;
  return (
    <div className={styles.imageWrap}>
      {!loaded && !failed && (
        <div className={styles.imagePlaceholder}>
          <div className={styles.spinner} />
          <span className={styles.placeholderText}>Conjuring the scene…</span>
        </div>
      )}
      {failed ? (
        <div className={styles.imagePlaceholder}><span className={styles.placeholderText}>“{prompt}”</span></div>
      ) : (
        <img
          src={pollinationsUrl(prompt)}
          alt={prompt}
          className={styles.image}
          style={{ display: loaded ? 'block' : 'none' }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export default function CaptionThisGame({ gameState, onAction, nicknames, avatars }) {
  const { playSound } = useSound();
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState(null);
  const [iAcked, setIAcked] = useState(false);
  const prevPhase = useRef(null);

  const phase = gameState?.phase;
  const hasSubmitted = gameState?.hasSubmitted;
  const myVote = gameState?.myVote;

  useEffect(() => {
    if (phase === prevPhase.current) return;
    if (phase === 'writing') setDraft('');
    if (phase === 'voting') setPick(null);
    if (phase === 'reveal') { setIAcked(false); playSound('voteCast'); }
    prevPhase.current = phase;
  }, [phase, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Loading the gallery…</p></div>;

  const {
    roundNumber, totalRounds, imagePrompt, deadline, scores = {}, myId,
    submittedCount, playerCount, ballot, votedCount, reveal, acknowledged = [],
  } = gameState;

  const allPlayers = Object.keys(scores);

  function submitCaption() {
    const t = draft.trim();
    if (!t || hasSubmitted) return;
    onAction({ type: 'submitCaption', text: t });
    playSound('click');
  }
  function confirmVote() {
    if (!pick || myVote) return;
    onAction({ type: 'castVote', optionId: pick });
    playSound('voteCast');
  }
  function ack() { if (!iAcked) { setIAcked(true); onAction({ type: 'acknowledge' }); } }

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>Caption This</h1>
        <span className={styles.round}>
          Image {roundNumber} / {totalRounds}
          {phase !== 'finished' && deadline ? <> · <Countdown deadline={deadline} /></> : null}
        </span>
      </div>

      {phase !== 'finished' && <SceneImage prompt={imagePrompt} />}

      {/* WRITING */}
      {phase === 'writing' && (
        hasSubmitted ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Caption submitted ✍️</p>
            <p className={styles.sub}>Waiting for others… {submittedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.writeBox}>
            <p className={styles.hint}>Write the funniest one-line caption for this image.</p>
            <input
              className={styles.input}
              value={draft}
              maxLength={120}
              placeholder="Your caption…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitCaption(); }}
              autoFocus
            />
            <button className={styles.primaryBtn} onClick={submitCaption} disabled={!draft.trim()}>Submit Caption</button>
          </div>
        )
      )}

      {/* VOTING */}
      {phase === 'voting' && ballot && (
        myVote ? (
          <div className={styles.waitBox}>
            <p className={styles.waitMsg}>Vote locked in ✅</p>
            <p className={styles.sub}>Votes in… {votedCount}/{playerCount}</p>
          </div>
        ) : (
          <div className={styles.ballot}>
            <p className={styles.hint}>Tap the funniest caption (not your own), then lock it in.</p>
            {ballot.map((o) => (
              <button
                key={o.optionId}
                className={`${styles.option} ${pick === o.optionId ? styles.optionSel : ''} ${o.isMine ? styles.optionMine : ''}`}
                disabled={o.isMine}
                onClick={() => !o.isMine && setPick(o.optionId)}
              >
                {o.text}{o.isMine && <span className={styles.mineTag}> (yours)</span>}
              </button>
            ))}
            <button className={styles.primaryBtn} onClick={confirmVote} disabled={!pick}>Lock in vote</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {(phase === 'reveal' || phase === 'finished') && reveal && (
        <div className={styles.reveal}>
          {reveal.options.map((o, i) => (
            <div key={o.optionId} className={`${styles.revOption} ${i === 0 && o.votes > 0 ? styles.revTop1 : ''}`}>
              <div className={styles.revTop}>
                <span className={styles.revText}>{o.text}</span>
                <span className={styles.voteCount}>{o.votes} {o.votes === 1 ? 'vote' : 'votes'}</span>
              </div>
              <div className={styles.revMeta}>
                <span className={styles.byTag}>by <PlayerName playerId={o.authorId} nicknames={nicknames} avatars={avatars} /></span>
                {o.voters.length > 0 && (
                  <div className={styles.voters}>
                    {o.voters.map((v) => <span key={v} className={styles.voterChip}><PlayerName playerId={v} nicknames={nicknames} avatars={avatars} /></span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className={styles.scoreboard}>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([pid, sc]) => (
              <div key={pid} className={styles.scoreRow}>
                <PlayerName playerId={pid} nicknames={nicknames} avatars={avatars} />
                <span className={styles.scoreVal}>{sc}{reveal.awards?.[pid]?.gained ? ` (+${reveal.awards[pid].gained})` : ''}</span>
              </div>
            ))}
          </div>
          {phase === 'reveal' && (
            <>
              {!iAcked && <button className={styles.primaryBtn} onClick={ack}>Continue →</button>}
              <AckStatus players={allPlayers} acknowledged={acknowledged} me={myId} iActed={iAcked} nicknames={nicknames} avatars={avatars} />
            </>
          )}
          {phase === 'finished' && <p className={styles.waitMsg}>Final captions are in! 🏆</p>}
        </div>
      )}
    </div>
  );
}
