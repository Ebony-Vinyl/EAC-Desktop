import { useEffect, useRef } from "react";
import { useLauncher } from "./store";

interface Particle {
  x: number;
  y: number;
  depth: number;
  size: number;
  phase: number;
  cross: boolean;
}

export function AmbientWorld() {
  const { settings } = useLauncher();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let pointerX = 0;
    let pointerY = 0;
    let lastPaint = 0;
    let pointerFrame = 0;
    const reduced = settings.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const bounds = parent.getBoundingClientRect();
      width = Math.ceil(bounds.width);
      height = Math.ceil(bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(90, Math.floor(width * height / 18000));
      particles = Array.from({ length: count }, (_, index) => ({
        x: ((index * 137.51) % 997) / 997 * width,
        y: ((index * 283.73) % 991) / 991 * height,
        depth: .2 + (index % 7) / 9,
        size: index % 10 === 0 ? 4 : index % 3 === 0 ? 3 : 2,
        phase: index * 1.618,
        cross: index % 12 === 0,
      }));
    };
    const pointer = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth - .5;
      pointerY = event.clientY / window.innerHeight - .5;
      if (!reduced) return;
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => paint());
    };
    const paint = (time = 0) => {
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = false;
      for (const particle of particles) {
        const drift = reduced ? 0 : time * .006 * particle.depth;
        const x = Math.round((particle.x + drift + pointerX * 34 * particle.depth + width) % width / 2) * 2;
        const y = Math.round((particle.y + (reduced ? 0 : Math.sin(time * .0004 + particle.phase) * 9) + pointerY * 24 * particle.depth) / 2) * 2;
        const alpha = .1 + particle.depth * .32 + (reduced ? 0 : Math.sin(time * .001 + particle.phase) * .09);
        context.fillStyle = particle.cross ? `rgba(226, 245, 255, ${Math.max(.08, alpha)})` : `rgba(71, 151, 255, ${Math.max(.06, alpha)})`;
        context.fillRect(x, y, particle.size, particle.size);
        if (particle.cross) {
          context.fillRect(x - 5, y + 1, 15, 2);
          context.fillRect(x + 1, y - 5, 2, 15);
        }
      }
    };
    const tick = (time: number) => {
      if (document.visibilityState === "visible" && time - lastPaint > 48) {
        paint(time);
        lastPaint = time;
      }
      frame = requestAnimationFrame(tick);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    window.addEventListener("pointermove", pointer, { passive: true });
    resize();
    paint();
    if (!reduced) frame = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", pointer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pointerFrame);
    };
  }, [settings.reducedMotion]);

  return <canvas ref={canvasRef} className="ambient-world" aria-hidden="true" />;
}

type PixelRect = [x: number, y: number, width: number, height: number];
type PixelLayer = { color: string; opacity?: number; rects: PixelRect[] };

const whaleLayers: PixelLayer[] = [
  { color: "#72b9ff", rects: [[92, 12, 12, 4], [84, 16, 40, 4], [76, 20, 72, 4], [68, 24, 104, 4], [60, 28, 144, 4], [52, 32, 176, 4], [44, 36, 192, 4], [36, 40, 192, 4], [36, 44, 184, 4], [32, 48, 184, 4], [24, 52, 184, 4], [20, 56, 180, 4], [16, 60, 176, 4], [12, 64, 176, 4], [8, 68, 172, 4], [8, 72, 164, 4], [4, 76, 160, 4], [4, 80, 152, 4], [8, 84, 144, 4], [12, 88, 132, 4], [16, 92, 116, 4], [24, 96, 100, 4], [32, 100, 84, 4], [44, 104, 60, 4]] },
  { color: "#2f7cff", rects: [[92, 44, 124, 4], [80, 48, 144, 4], [68, 52, 156, 4], [56, 56, 164, 4], [44, 60, 168, 4], [36, 64, 164, 4], [32, 68, 160, 4], [28, 72, 152, 4], [28, 76, 144, 4], [32, 80, 132, 4], [40, 84, 120, 4], [52, 88, 104, 4], [68, 92, 84, 4]] },
  { color: "#1550b8", rects: [[48, 88, 108, 4], [60, 92, 96, 4], [76, 96, 80, 4], [96, 100, 64, 4], [120, 104, 40, 4], [128, 108, 24, 4]] },
  { color: "#eaf7ff", rects: [[36, 64, 12, 8], [52, 72, 12, 4], [68, 80, 16, 4], [88, 84, 20, 4], [112, 88, 16, 4], [136, 88, 16, 4]] },
  { color: "#0a234f", rects: [[64, 72, 8, 8], [104, 84, 20, 4], [112, 92, 16, 4], [124, 100, 12, 4], [144, 104, 8, 4]] },
  { color: "#9ed8ff", rects: [[56, 28, 8, 4], [72, 32, 12, 4], [88, 40, 12, 4], [112, 48, 20, 4], [132, 56, 16, 4], [156, 64, 12, 4]] },
];
const tailLayers: PixelLayer[] = [
  { color: "#72b9ff", rects: [[208, 48, 16, 4], [216, 44, 12, 4], [224, 40, 12, 4], [228, 32, 16, 4], [232, 24, 16, 4], [240, 16, 16, 4], [244, 8, 16, 4], [252, 4, 20, 4], [264, 8, 12, 4], [260, 16, 16, 4], [256, 20, 12, 4], [248, 28, 12, 4], [244, 36, 12, 4], [236, 44, 16, 4], [228, 52, 16, 4], [224, 60, 12, 4], [216, 64, 16, 4], [212, 72, 12, 4], [204, 76, 16, 4], [196, 80, 16, 4]] },
  { color: "#eaf7ff", rects: [[252, 4, 20, 4], [260, 8, 12, 4], [244, 16, 8, 4]] },
  { color: "#2f7cff", rects: [[216, 52, 12, 4], [224, 60, 12, 4], [212, 68, 12, 4], [204, 76, 12, 4]] },
];
const fishBody: PixelRect[] = [[8, 4, 24, 4], [4, 8, 20, 4], [8, 12, 12, 4], [20, 8, 4, 4]];

function PixelRects({ layers, className = "" }: { layers: PixelLayer[]; className?: string }) {
  return <g className={className}>{layers.map((layer, layerIndex) =>
    layer.rects.map(([x, y, width, height], index) => <rect key={`${layerIndex}-${index}`} x={x} y={y} width={width} height={height} fill={layer.color} opacity={layer.opacity} />))}</g>;
}

export function PixelFish({ variant = 0 }: { variant?: number }) {
  const colors = variant % 2 ? ["#eaf7ff", "#6fb8ff"] : ["#6fb8ff", "#eaf7ff"];
  return <svg className={`tiny-fish tiny-fish-${variant % 2}`} viewBox="0 0 32 16" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="0" y="8" width="8" height="4" fill={colors[1]} />
    {fishBody.map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} fill={index === 3 ? "#081a3a" : colors[0]} />)}
    <rect x="12" y="12" width="8" height="4" fill={colors[1]} />
  </svg>;
}

export function PixelWhale({ active = false }: { active?: boolean }) {
  return <div className={`whale-world ${active ? "is-active" : ""}`} aria-hidden="true">
    <span className="pixel-cloud cloud-one"><i /><i /><i /></span><span className="pixel-cloud cloud-two"><i /><i /><i /></span>
    <div className="sonar sonar-one" /><div className="sonar sonar-two" />
    <div className="whale-shadow" />
    <svg className="pixel-whale" viewBox="0 0 280 124" shapeRendering="crispEdges">
      <g className="whale-tail"><PixelRects layers={tailLayers} /></g>
      <PixelRects layers={whaleLayers} />
      <g className="whale-belly"><rect x="36" y="92" width="12" height="4" fill="#bde7ff" /><rect x="52" y="96" width="16" height="4" fill="#bde7ff" /><rect x="72" y="100" width="20" height="4" fill="#8fd0ff" /><rect x="96" y="104" width="24" height="4" fill="#6fb8ff" /></g>
    </svg>
    <span className="whale-spark spark-one" /><span className="whale-spark spark-two" /><span className="whale-spark spark-three" />
    <div className="fish-track fish-track-one"><PixelFish /><PixelFish variant={1} /></div>
    <div className="fish-track fish-track-two"><PixelFish variant={1} /></div>
    <div className="sea-floor"><i /><i /><i /><i /><i /><i /><i /><i /></div>
  </div>;
}

export function CockpitTelemetry({ online, running }: { online: boolean; running: number }) {
  return <div className="cockpit-telemetry" aria-hidden="true">
    <span className="telemetry-id pixel-font">DEEP//SEA</span>
    <span className="telemetry-coordinate">X 031.08 / Y 112.74</span>
    <span className="telemetry-bars"><i /><i /><i /><i /><i /><i /><i /><i /></span>
    <span className="telemetry-status"><i className={online ? "online" : ""} />{online ? `LINK STABLE · ${String(running).padStart(2, "0")} ACTIVE` : "AWAITING LINK"}</span>
  </div>;
}
