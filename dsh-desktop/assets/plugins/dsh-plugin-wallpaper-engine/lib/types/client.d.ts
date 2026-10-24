/**
 * dsh-wallpaper-engine — client (browser) half.
 *
 * A compiled browser module in the `window.__ModuleLoader__.load({ id,
 * factory })` form. The factory returns the plugin exports (apply/inject). It
 * is a normal browser module (full access to fetch/document/window; `react` via
 * `require("react")`), distinct from the dynamic cordis_define closure whose
 * traps and withheld globals do not apply here.
 */

/** Browser plugin exports consumed by the Cordis Loader. */
export interface WallpaperEngineClientPlugin {
  apply: (ctx: unknown) => void;
  inject: string[];
}
