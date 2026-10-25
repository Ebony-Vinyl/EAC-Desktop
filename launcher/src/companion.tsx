import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { persist, stored } from "./api";
import { useLauncher } from "./store";
import type { Instance, Task } from "./types";
import { PetSprite } from "./pet-sprite";
import type { PetMood } from "./pet-sprite";

const SPOT_KEY = "eacCompanionSpot";

type Overlay = PetMood | null;

function baseMood(online: boolean, instance: Instance | undefined, runningTasks: Task[]): PetMood {
  if (!online) return "idle";
  if (runningTasks.length > 0 || instance?.status === "starting") return "thinking";
  if (instance?.status === "running") return "success";
  if (instance?.status === "error") return "error";
  return "idle";
}

export function NavigatorCompanion({ instance, online, runningTasks = [] }: { instance?: Instance; online: boolean; runningTasks?: Task[] }) {
  const { settings, skin, petScale } = useLauncher();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [bubble, setBubble] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = JSON.parse(stored(localStorage, SPOT_KEY) || "null") as { x?: number; y?: number } | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x as number, y: saved.y as number };
    } catch { /* default corner anchor */ }
    return null;
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  const bubbleTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(bubbleTimer.current), []);

  // Ambient micro-interrupts while idling: stretch/yawn/eat a token, like the source pet.
  useEffect(() => {
    if (settings.reducedMotion || overlay || dragging) return;
    const delay = 26000 + Math.random() * 22000;
    const timer = window.setTimeout(() => setOverlay(Math.random() < .5 ? "idle_yawn" : "eat_token"), delay);
    return () => window.clearTimeout(timer);
  }, [settings.reducedMotion, overlay, dragging]);

  const message = !online ? "链路暂时离线。我在这里等引擎回来，也可以把我拖到别处。"
    : runningTasks.length ? `${runningTasks[0].label}进行中，我不打扰它。`
      : !instance ? "先创建一座工作舱，我们就能向深海出发。"
        : instance.status === "running" ? `${instance.name} 正在航行。控制台里是真实的引擎输出。`
          : instance.status === "starting" ? "引擎正在响应，完成前我不会提前庆祝。"
            : instance.status === "error" ? "实例报告了异常。看看任务记录，我们一起处理。"
              : `${instance.name} 已就位，随时可以出发。`;
  const speak = useCallback(() => {
    setBubble(true);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(false), 6500);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = rootRef.current?.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: rect?.left ?? 0, baseY: rect?.top ?? 0, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) { drag.moved = true; setDragging(true); setBubble(false); }
    const width = rootRef.current?.offsetWidth ?? 120;
    const height = rootRef.current?.offsetHeight ?? 150;
    const x = Math.min(Math.max(drag.baseX + dx, 6), window.innerWidth - width - 6);
    const y = Math.min(Math.max(drag.baseY + dy, 6), window.innerHeight - height - 6);
    setSpot({ x, y });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved && spot) persist(localStorage, SPOT_KEY, JSON.stringify(spot));
    if (!drag.moved) { setOverlay("poke"); speak(); }
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOverlay("poke"); speak(); }
  };

  if (skin !== "pixel") return null;
  const mood: PetMood = dragging ? "dragging" : overlay ?? baseMood(online, instance, runningTasks);
  return <div ref={rootRef}
    className={`navigator-companion ${dragging ? "is-dragging" : ""} ${bubble ? "has-bubble" : ""}`}
    style={{ ...(spot ? { right: "auto", bottom: "auto", left: spot.x, top: spot.y } : {}), "--pet-scale": petScale } as React.CSSProperties}>
    <div className="companion-speech" role="status" aria-live="polite"><span className="pixel-font">DAFEIYU // PET</span><p>{message}</p></div>
    <button className="companion-button" type="button" aria-label="像素桌宠大飞鱼：点击说话，拖动换位置" title="点击说话 · 拖动换位置"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
      <PetSprite mood={mood} reduced={settings.reducedMotion} onOneShotEnd={() => setOverlay(null)} />
    </button>
  </div>;
}

export function ArchivistCompanion() {
  const { settings } = useLauncher();
  const [awake, setAwake] = useState(false);
  return <button className={`archivist-companion ${awake ? "is-awake" : ""}`} onClick={() => setAwake((value) => !value)} aria-pressed={awake} aria-label="与档案管理员打招呼">
    <img className="archivist-original" src={`${import.meta.env.BASE_URL}companions/archivist.webp`} alt="狐耳档案管理员" draggable={false} />
    <img className="archivist-pixel" src={`${import.meta.env.BASE_URL}companions/archivist-pixel.png`} alt="" draggable={false} />
    <span><strong>{awake ? "今天也辛苦了。" : "档案管理员 · MOMO"}</strong><small>{awake ? "你的每一份真实记录，都被认真收好。" : settings.reducedMotion ? "静态模式已开启 · 点击打招呼" : "PIXEL ARCHIVE · 点击打招呼"}</small></span>
  </button>;
}
