import { useEffect, useRef, useState } from 'react';
import styles from './TelephonePictionary.module.css';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import PlayerName from '../components/PlayerName.jsx';
import { useSocketContext } from '../context/SocketContext.jsx';
import { useSound } from '../context/SoundContext.jsx';
import { useScreenShake } from '../hooks/useScreenShake.js';
import { EVENTS } from '../../../shared/events.js';

function Countdown({ deadline }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    if (!deadline) { setS(null); return; }
    const tick = () => setS(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);
  if (s == null) return null;
  return <span className={styles.countdown}>{s}s</span>;
}

function Frame({ frame, nicknames, avatars }) {
  if (!frame) return null;
  return (
    <div className={styles.frame}>
      <p className={styles.frameBy}>
        {frame.mode === 'phrase' ? 'Started by ' : frame.mode === 'draw' ? 'Drawn by ' : 'Guessed by '}
        <PlayerName playerId={frame.authorId} nicknames={nicknames} avatars={avatars} />
      </p>
      {frame.mode === 'draw'
        ? <DrawingCanvas readOnly strokes={frame.strokes || []} toolbar={false} />
        : <p className={styles.frameText}>{frame.blank ? '(blank)' : frame.text}</p>}
    </div>
  );
}

export default function TelephonePictionary({ gameState, onAction, nicknames, avatars }) {
  const { socket } = useSocketContext();
  const { playSound } = useSound();
  const shake = useScreenShake();
  const [strokes, setStrokes] = useState([]);
  const [draft, setDraft] = useState('');
  const stepKey = useRef(null);
  const prevReveal = useRef(-1);

  const phase = gameState?.phase;
  const stepIndex = gameState?.stepIndex;
  const myChainId = gameState?.myChainId;

  // reset the private canvas + draft on each new step
  useEffect(() => {
    const key = `${phase}:${stepIndex}:${myChainId}`;
    if (key !== stepKey.current) { setStrokes([]); setDraft(''); stepKey.current = key; }
  }, [phase, stepIndex, myChainId]);

  // private stroke echoes (author-only) for the draw step
  useEffect(() => {
    if (!socket) return;
    const onBroadcast = (d) => { if (d?.stroke) setStrokes((s) => [...s, d.stroke]); };
    const onUndo = (d) => setStrokes((s) => s.filter((x) => x.id !== d?.strokeId));
    const onClear = () => setStrokes([]);
    socket.on(EVENTS.STROKE_BROADCAST, onBroadcast);
    socket.on(EVENTS.CANVAS_UNDO, onUndo);
    socket.on(EVENTS.CANVAS_CLEAR, onClear);
    return () => { socket.off(EVENTS.STROKE_BROADCAST, onBroadcast); socket.off(EVENTS.CANVAS_UNDO, onUndo); socket.off(EVENTS.CANVAS_CLEAR, onClear); };
  }, [socket]);

  useEffect(() => {
    const idx = gameState?.reveal?.index;
    if (idx != null && idx !== prevReveal.current) { playSound('cardDeal'); prevReveal.current = idx; }
  }, [gameState?.reveal?.index, playSound]);

  if (!gameState) return <div className={styles.arena}><p className={styles.loading}>Setting up chains…</p></div>;

  const { stepMode, prompt, mySubmitted, submittedCount, playerCount, deadline, totalSteps, reveal, voting, results, myId } = gameState;

  function submitPhrase() { const t = draft.trim(); if (t) onAction({ type: 'submitPhrase', text: t }); }
  function submitWrite() { const t = draft.trim(); if (t) onAction({ type: 'submitWrite', text: t }); }
  function submitDraw() { onAction({ type: 'submitDraw' }); }
  const waiting = <p className={styles.waiting}>Waiting… {submittedCount}/{playerCount} <Countdown deadline={deadline} /></p>;

  return (
    <div className={styles.arena}>
      <div className={styles.head}>
        <h1 className={styles.title}>Telephone Pictionary</h1>
        {phase === 'step' && <span className={styles.meta}>Step {stepIndex}/{totalSteps}</span>}
      </div>

      {/* WRITING */}
      {phase === 'writing' && (
        mySubmitted ? waiting : (
          <div className={styles.writeBox}>
            <p className={styles.instr}>Write a starting phrase — funny is good!</p>
            <textarea className={styles.textarea} maxLength={120} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. a cat riding a unicycle" />
            <button className={styles.primary} onClick={submitPhrase} disabled={!draft.trim()}>Lock it in</button>
          </div>
        )
      )}

      {/* STEP: DRAW */}
      {phase === 'step' && stepMode === 'draw' && (
        mySubmitted ? waiting : (
          <div className={styles.stepBox}>
            <p className={styles.promptText}>Draw: <strong>{prompt?.text || '(blank)'}</strong></p>
            <DrawingCanvas
              readOnly={false}
              strokes={strokes}
              onStroke={(s) => socket?.emit(EVENTS.STROKE_SEND, { stroke: s })}
              onUndo={() => socket?.emit(EVENTS.CANVAS_UNDO_SEND)}
              onClear={() => socket?.emit(EVENTS.CANVAS_CLEAR_SEND)}
              toolbar
            />
            <button className={styles.primary} onClick={submitDraw}>Done drawing</button>
          </div>
        )
      )}

      {/* STEP: WRITE */}
      {phase === 'step' && stepMode === 'write' && (
        mySubmitted ? waiting : (
          <div className={styles.stepBox}>
            <p className={styles.instr}>What is this a drawing of?</p>
            <DrawingCanvas readOnly strokes={prompt?.strokes || []} toolbar={false} />
            <textarea className={styles.textarea} maxLength={120} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your best guess…" />
            <button className={styles.primary} onClick={submitWrite} disabled={!draft.trim()}>Submit guess</button>
          </div>
        )
      )}

      {/* REVEAL */}
      {phase === 'reveal' && reveal && (
        <div className={styles.revealBox}>
          <p className={styles.revealOwner}>Chain by <PlayerName playerId={reveal.frame?.ownerId} nicknames={nicknames} avatars={avatars} /></p>
          <Frame frame={reveal.frame} nicknames={nicknames} avatars={avatars} />
          <p className={styles.progress}>{reveal.index + 1} / {reveal.total}</p>
          <button className={styles.primary} onClick={() => onAction({ type: 'advanceReveal' })}>Next →</button>
        </div>
      )}

      {/* VOTING */}
      {phase === 'voting' && voting && (
        <div className={styles.voteBox}>
          <p className={styles.instr}>Vote for the funniest chain!</p>
          <div className={styles.voteGrid}>
            {voting.chains.map((c) => (
              <button
                key={c.id}
                className={`${styles.voteCard} ${c.isMine ? styles.voteMine : ''} ${voting.myVote === c.id ? styles.voteSel : ''}`}
                disabled={c.isMine || voting.myVote !== undefined}
                onClick={() => onAction({ type: 'vote', chainId: c.id })}
              >
                <span className={styles.voteOwner}>by <PlayerName playerId={c.ownerId} nicknames={nicknames} avatars={avatars} />{c.isMine ? ' (yours)' : ''}</span>
                <div className={styles.miniStrip}>
                  {c.items.map((it, i) => (
                    <span key={i} className={styles.miniItem}>
                      {it.mode === 'draw' ? <DrawingCanvas readOnly strokes={it.strokes || []} toolbar={false} /> : <span className={styles.miniText}>{it.blank ? '(blank)' : it.text}</span>}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          {voting.myVote === undefined && <button className={styles.skip} onClick={() => onAction({ type: 'skipVote' })}>Skip vote</button>}
        </div>
      )}

      {/* FINISHED */}
      {phase === 'finished' && results && (
        <div className={styles.results}>
          {results.map((r) => (
            <div key={r.playerId} className={styles.resultRow}>
              <span className={styles.rPlace}>{r.placement}</span>
              <PlayerName playerId={r.playerId} nicknames={nicknames} avatars={avatars} />
              <span className={styles.rScore}>{r.score} pts · {r.votes}🗳</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
