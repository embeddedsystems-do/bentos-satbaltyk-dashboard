import { useEffect, useMemo, useRef, useState } from "react";
import { skyTheme, sunPosition } from "../utils/sky";
import { useAnimatedNumber } from "../utils/useAnimatedNumber";

const BASE = import.meta.env.BASE_URL;
const RAYS = [
  { left: "6%", delay: 0, duration: 12 },
  { left: "40%", delay: 3.4, duration: 14 },
  { left: "72%", delay: 5.1, duration: 16 },
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const LIVE_CLOCK_MS = 60000; // jak czesto odswiezamy "teraz", gdy nie gra animacja czasu
const SKY_EASE_MS = 1200; // plynne dobieganie do nowej pory dnia (np. start/stop animacji)

// Drobinki dryfujace w toni - ta sama mechanika co canvas w hero bentos.info.
// colorRef = [r, g, b, mnoznik przezroczystosci] - zmienia sie z pora dnia.
function startParticles(canvas, colorRef) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let particles = [];
  let raf = 0;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(40, Math.floor((w * h) / 6000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.5 + Math.random() * 1.6,
      vy: 0.06 + Math.random() * 0.25,
      vx: (Math.random() - 0.5) * 0.12,
      a: 0.2 + Math.random() * 0.45,
    }));
  }

  function frame() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.y += p.vy;
      p.x += p.vx + Math.sin((p.y + p.x) * 0.01) * 0.08;
      if (p.y > h + 4) {
        p.y = -4;
        p.x = Math.random() * w;
      }
      if (p.x < -4) p.x = w + 4;
      if (p.x > w + 4) p.x = -4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      const [r, g, b, alphaScale] = colorRef.current;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, p.a * alphaScale)})`;
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  frame();
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
  };
}

// Tlo gornej czesci panelu: tafla wody (wideo z hero bentos.info) + promienie
// i drobinki, wygaszane maska w jednolity gradient panelu. `active` = panel
// widoczny; schowany nie zjada CPU/GPU na niewidoczna animacje.
// Kolory, slonce/ksiezyc i drobinki zmieniaja sie z pora dnia nad Trojmiastem:
// `simTime` (ms) to czas klatki z suwaka, gdy gra animacja czasu; bez niego
// (null) bierzemy zegar lokalny.
export default function SidebarWater({ active, simTime = null }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), LIVE_CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  const target = sunPosition(simTime ?? now);
  const altitude = useAnimatedNumber(target.altitude, { duration: SKY_EASE_MS });
  const sinAzimuth = useAnimatedNumber(Math.sin((target.azimuth * Math.PI) / 180), { duration: SKY_EASE_MS });
  const sky = useMemo(() => skyTheme(altitude, sinAzimuth), [altitude, sinAzimuth]);
  const particleColorRef = useRef(sky.particle);
  particleColorRef.current = sky.particle.map((v, i) => (i < 3 ? Math.round(v) : v));

  useEffect(() => {
    const video = videoRef.current;
    if (active && !prefersReducedMotion()) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [active]);

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    return startParticles(canvasRef.current, particleColorRef);
  }, [active]);

  return (
    <div className="sidebar-water" aria-hidden="true" style={sky.vars}>
      <video
        ref={videoRef}
        className="sidebar-water-video"
        src={`${BASE}brand/sidebar-water.mp4`}
        poster={`${BASE}brand/sidebar-water.jpg`}
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className="sidebar-water-tint" />
      <div className="sidebar-water-sun" />
      <div className="sidebar-water-moon" />
      <div className="sidebar-water-rays">
        {RAYS.map((ray) => (
          <span
            key={ray.left}
            className="sidebar-water-ray"
            style={{ left: ray.left, animationDelay: `${ray.delay}s`, animationDuration: `${ray.duration}s` }}
          />
        ))}
      </div>
      <canvas ref={canvasRef} className="sidebar-water-particles" />
    </div>
  );
}
