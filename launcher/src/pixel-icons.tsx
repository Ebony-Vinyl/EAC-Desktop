export type PixelIconName =
  | "overview" | "instances" | "kernels"
  | "market" | "packs" | "releases"
  | "tasks" | "settings" | "profile" | "achievements";

type PixelRect = [x: number, y: number, width: number, height: number];

const icons: Record<PixelIconName, PixelRect[]> = {
  overview: [
    [1, 1, 6, 6], [9, 1, 6, 6], [1, 9, 6, 6], [9, 9, 6, 6],
    [3, 3, 2, 2], [11, 3, 2, 2], [3, 11, 2, 2], [11, 11, 2, 2],
  ],
  instances: [
    [2, 3, 12, 2], [1, 5, 2, 7], [13, 5, 2, 7], [2, 12, 12, 2],
    [7, 5, 2, 7], [4, 7, 2, 2], [10, 7, 2, 2],
  ],
  kernels: [
    [2, 2, 12, 2], [4, 5, 8, 2], [2, 8, 12, 2], [4, 11, 8, 2],
    [7, 4, 2, 1], [7, 7, 2, 1], [7, 10, 2, 1],
  ],
  market: [
    [5, 1, 6, 2], [3, 3, 2, 6], [11, 3, 2, 6],
    [6, 5, 4, 5], [7, 10, 2, 4], [5, 13, 6, 2],
  ],
  packs: [
    [2, 2, 12, 2], [1, 4, 2, 8], [13, 4, 2, 8], [2, 12, 12, 2],
    [7, 4, 2, 8], [4, 7, 2, 2], [10, 7, 2, 2],
  ],
  releases: [
    [7, 1, 2, 7], [4, 7, 2, 2], [10, 7, 2, 2],
    [3, 9, 10, 2], [5, 11, 6, 2], [7, 13, 2, 2],
  ],
  tasks: [
    [1, 7, 3, 2], [4, 5, 2, 6], [6, 2, 2, 12],
    [8, 5, 2, 6], [10, 7, 5, 2],
  ],
  settings: [
    [6, 1, 4, 2], [6, 13, 4, 2], [1, 6, 2, 4], [13, 6, 2, 4],
    [3, 3, 2, 2], [11, 3, 2, 2], [3, 11, 2, 2], [11, 11, 2, 2],
    [6, 6, 4, 4],
  ],
  profile: [
    [6, 1, 4, 4], [5, 2, 1, 1], [10, 2, 1, 1],
    [3, 7, 10, 2], [2, 9, 12, 2], [2, 11, 3, 3], [11, 11, 3, 3],
  ],
  achievements: [
    [5, 1, 6, 2], [3, 3, 2, 3], [11, 3, 2, 3], [5, 6, 6, 2],
    [7, 8, 2, 3], [6, 11, 4, 2], [4, 13, 8, 2],
  ],
};

export function PixelIcon({ name, size = 16, className = "" }: { name: PixelIconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    {icons[name].map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} fill="currentColor" />)}
  </svg>;
}
