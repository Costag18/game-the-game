import { useEffect, useRef, useState } from 'react';
import styles from './DrawingCanvas.module.css';

const PALETTE = ['#000000', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff'];
const SIZES = [3, 8, 18];

function drawStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || !pts.length) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = stroke.width;
  if (stroke.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = stroke.color; }
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.5, stroke.width / 2), 0, Math.PI * 2);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

export default function DrawingCanvas({ readOnly, strokes = [], onStroke, onClear, onUndo, logicalWidth = 800, logicalHeight = 600, toolbar = true }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(null); // in-progress stroke
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(8);
  const [tool, setTool] = useState('pen');
  const [confirmClear, setConfirmClear] = useState(false);

  // full redraw on authoritative strokes change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    for (const s of strokes) drawStroke(ctx, s);
  }, [strokes, logicalWidth, logicalHeight]);

  function toLogical(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * logicalWidth,
      y: ((e.clientY - r.top) / r.height) * logicalHeight,
    };
  }

  function onPointerDown(e) {
    if (readOnly) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = { color, width, tool, points: [toLogical(e)] };
    paintInProgress();
  }
  function onPointerMove(e) {
    if (readOnly || !drawingRef.current) return;
    drawingRef.current.points.push(toLogical(e));
    paintInProgress();
  }
  function onPointerUp() {
    if (readOnly || !drawingRef.current) return;
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (stroke.points.length && onStroke) onStroke(stroke);
  }
  function paintInProgress() {
    const ctx = canvasRef.current.getContext('2d');
    if (drawingRef.current) drawStroke(ctx, drawingRef.current);
  }

  return (
    <div className={styles.wrap}>
      <canvas
        ref={canvasRef}
        width={logicalWidth}
        height={logicalHeight}
        className={`${styles.canvas} ${readOnly ? styles.readOnly : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {toolbar && !readOnly && (
        <div className={styles.toolbar}>
          <div className={styles.swatches}>
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`${styles.swatch} ${color === c && tool === 'pen' ? styles.swatchSel : ''}`}
                style={{ background: c, border: c === '#ffffff' ? '1px solid #999' : 'none' }}
                onClick={() => { setColor(c); setTool('pen'); }}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          <div className={styles.tools}>
            {SIZES.map((s) => (
              <button key={s} className={`${styles.sizeBtn} ${width === s ? styles.sizeSel : ''}`} onClick={() => setWidth(s)}>
                <span style={{ width: s + 4, height: s + 4 }} className={styles.sizeDot} />
              </button>
            ))}
            <button className={`${styles.toolBtn} ${tool === 'eraser' ? styles.toolSel : ''}`} onClick={() => setTool(tool === 'eraser' ? 'pen' : 'eraser')}>🧽</button>
            <button className={styles.toolBtn} onClick={() => onUndo && onUndo()}>↶</button>
            {confirmClear ? (
              <button className={styles.clearBtn} onClick={() => { setConfirmClear(false); onClear && onClear(); }}>Sure?</button>
            ) : (
              <button className={styles.toolBtn} onClick={() => { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 2500); }}>🗑️</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
