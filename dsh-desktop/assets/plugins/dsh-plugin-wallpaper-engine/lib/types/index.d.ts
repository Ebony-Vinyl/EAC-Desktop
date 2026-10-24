/**
 * dsh-wallpaper-engine — host half type surface.
 *
 * The host plugin contributes no public Cordis services and registers no model
 * tool. It exposes three same-origin HTTP routes through `ctx.webServer` (see
 * README) and unwinds them on unload. It treats `webServer` as optional, so the
 * bundle also composes into a headless/TUI profile (where it is a no-op).
 */

import type { Context } from '@deepseek-ai/cordis';

/** A normalized Wallpaper Engine project as served in the inventory. */
export interface WallpaperDescriptor {
  /** Project directory basename (Workshop id or project folder name). */
  id: string;
  /** Wallpaper title from project.json. */
  title: string;
  /** Wallpaper kind: 'video' | 'web' | 'scene' | 'application'. */
  type: string;
  /** Whether the wallpaper can be rendered by the browser (video/web). */
  playable: boolean;
  /** Served media URL (`/wallpaper-engine/media/<token>`), or null. */
  media: string | null;
  /** Served preview URL (`/wallpaper-engine/preview/<token>`), or null. */
  preview: string | null;
  /** Scene static-frame URL (`/wallpaper-engine/scene-frame/<token>`), or null. */
  frameUrl: string | null;
  /** Live WebGL scene player URL (`/wallpaper-engine/scene-runtime/<token>`), or null. */
  sceneUrl?: string | null;
  /** Scene embedded-animation MP4 URL (`/wallpaper-engine/scene-video/<token>`), or null. */
  sceneVideo?: string | null;
}

/** A Wallpaper Engine playlist read from `config.json`. */
export interface PlaylistDescriptor {
  /** Stable identifier derived from the Wallpaper Engine profile and index. */
  id: string;
  /** Playlist name shown in the picker. */
  name: string;
  /** Wallpaper Engine ordering mode (`sequence` or `random`). */
  order: 'sequence' | 'random';
  /** Wallpaper Engine delay in seconds, when present. */
  delay: number | null;
  /** Inventory ids in the playlist order. */
  wallpaperIds: string[];
  /** Number of resolved entries in the playlist. */
  total: number;
  /** Number of resolved Video/Web entries. */
  portableCount: number;
  /** Number of config entries that could not be matched to the inventory. */
  unresolvedCount: number;
}

/** Shape returned by GET /wallpaper-engine/inventory. */
export interface Inventory {
  /** Absolute Wallpaper Engine install dir, or null when not found. */
  installDir: string | null;
  /** Total installed wallpapers. */
  total: number;
  /** Number of portable (video/web) wallpapers. */
  portableCount: number;
  /** All installed wallpapers. */
  wallpapers: WallpaperDescriptor[];
  /** Saved Wallpaper Engine playlists available for scoped rotation. */
  playlists: PlaylistDescriptor[];
}

/** The host plugin hard-depends on the webserver service (`webServer`). */
export declare const inject: string[];

export declare function apply(ctx: Context): () => void;
