import { useEffect, useRef } from 'react';

const COLORS = ['#d4a843', '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#ffffff', '#e67e22'];
const PARTICLE_COUNT = 150;
const DURATION = 4000; // ms

export default function ConfettiOverlay() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    let animId;
    const start = performance.now();

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * -h,
      w: 4 + Math.random() * 6,
      h: 6 + Math.random() * 10,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.2,
      gravity: 0.04 + Math.random() * 0.03,
    }));

    function frame(now) {
      const elapsed = now - start;
      const alpha = elapsed > DURATION * 0.7 ? 1 - (elapsed - DURATION * 0.7) / (DURATION * 0.3) : 1;
      if (elapsed > DURATION) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, alpha);
      for (const p of particles) {
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotV;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);

    function onResize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    />
  );
}
