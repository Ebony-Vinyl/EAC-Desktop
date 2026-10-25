import { useEffect, useRef, useState } from "react";

export type PetMood = "idle" | "poke" | "dragging" | "success" | "error" | "thinking" | "idle_yawn" | "eat_token";

interface SheetMeta { frames: number; cellHeight: number; cols: number; cellWidth: number }

// Grid sheets generated from QCYTSN/dsh-dafeiyu (MIT; upstream PC2005-cloud/dsh-pet).
const SHEETS: Record<PetMood, SheetMeta> = {
  idle: { frames: 241, cellHeight: 200, cols: 16, cellWidth: 240 },
  poke: { frames: 241, cellHeight: 200, cols: 16, cellWidth: 240 },
  dragging: { frames: 144, cellHeight: 200, cols: 16, cellWidth: 240 },
  success: { frames: 241, cellHeight: 200, cols: 16, cellWidth: 240 },
  error: { frames: 118, cellHeight: 200, cols: 16, cellWidth: 240 },
  thinking: { frames: 241, cellHeight: 200, cols: 16, cellWidth: 240 },
  idle_yawn: { frames: 241, cellHeight: 200, cols: 16, cellWidth: 240 },
  eat_token: { frames: 241, cellHeight: 200, cols: 16, cellWidth: 240 },
};
const FRAME_MS = 42; // upstream is 24fps
const LOOP: Record<PetMood, boolean> = {
  idle: true, dragging: true, thinking: true,
  poke: false, success: false, error: false, idle_yawn: false, eat_token: false,
};

const asset = (mood: PetMood) => `${import.meta.env.BASE_URL}companions/pet/${mood}.webp`;
const PRELOAD = Object.keys(SHEETS) as PetMood[];
let preloaded = false;
function preloadSheets() {
  if (preloaded) return;
  preloaded = true;
  for (const mood of PRELOAD) {
    const img = new Image();
    img.decoding = "async";
    img.src = asset(mood);
  }
}

export function PetSprite({ mood, reduced, paused = false, onOneShotEnd, className = "" }:
  { mood: PetMood; reduced: boolean; paused?: boolean; onOneShotEnd?: () => void; className?: string }) {
  const [frame, setFrame] = useState(0);
  const sheet = SHEETS[mood];
  const endRef = useRef(onOneShotEnd);
  endRef.current = onOneShotEnd;

  useEffect(() => { preloadSheets(); setFrame(0); }, []);

  useEffect(() => { setFrame(0); }, [mood]);

  useEffect(() => {
    if (paused) return;
    if (reduced) { setFrame(0); return; }
    let raf = 0;
    let last = performance.now();
    let current = 0;
    let elapsed = 0;
    const tick = (now: number) => {
      elapsed += now - last;
      last = now;
      while (elapsed >= FRAME_MS) {
        elapsed -= FRAME_MS;
        current += 1;
        if (current >= sheet.frames) {
          if (LOOP[mood]) current = 0;
          else { current = sheet.frames - 1; setFrame(current); endRef.current?.(); return; }
        }
      }
      setFrame(current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mood, paused, reduced, sheet.frames]);

  const col = frame % sheet.cols;
  const row = Math.floor(frame / sheet.cols);
  return <span
    className={`pet-sprite ${className}`}
    aria-hidden="true"
    style={{
      width: sheet.cellWidth,
      height: sheet.cellHeight,
      backgroundImage: `url(${asset(mood)})`,
      backgroundPosition: `-${col * sheet.cellWidth}px -${row * sheet.cellHeight}px`,
    }}
  />;
}
