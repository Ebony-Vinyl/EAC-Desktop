window.__ModuleLoader__.load({id:"dsh-client-liang-intensity-skin",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// src/client/skin.css
var skin_default = `.liang-skin-backdrop {
  position: fixed;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--liang-page, transparent);
  opacity: 0;
  transition: opacity 220ms ease, background-color 180ms linear;
}

body[data-liang-skin="on"] .liang-skin-backdrop {
  opacity: 1;
}

.liang-skin-backdrop img {
  position: absolute;
  top: 50%;
  right: 0;
  display: block;
  width: min(42vw, 720px);
  height: 100vh;
  object-fit: cover;
  object-position: 50% 42%;
  opacity: var(--liang-portrait-opacity, 0.45);
  transform: translateY(-50%);
  filter: none;
  mask-image: linear-gradient(90deg, transparent 0%, rgb(0 0 0 / 20%) 10%, black 30%, black 100%);
  transition: filter 180ms linear;
}

.liang-skin-backdrop img {
  display: none;
}

.liang-skin-backdrop[data-media="sequence"] .liang-skin-sequence-frame {
  display: block;
  opacity: var(--liang-portrait-opacity, 0.82);
}

.liang-skin-backdrop[data-media="color"] img {
  display: none;
}

.liang-skin-backdrop::after {
  position: absolute;
  inset: 0;
  content: "";
  background: linear-gradient(90deg, var(--liang-page, transparent) 0 28%, transparent 57% 100%);
}

body[data-liang-skin="on"] {
  --dsw-alias-bg-base: var(--liang-bg-base) !important;
  --dsw-alias-bg-layer-1: var(--liang-layer-1) !important;
  --dsw-alias-bg-layer-2: var(--liang-layer-2) !important;
  --dsw-alias-bg-layer-3: var(--liang-layer-3) !important;
  --dsw-specific-sidebar-fill: var(--liang-sidebar) !important;
  --dsw-alias-label-primary: var(--liang-ink) !important;
  --dsw-alias-label-primary-dimmed: var(--liang-ink) !important;
  --dsw-alias-label-secondary: var(--liang-secondary) !important;
  --dsw-alias-label-tertiary: var(--liang-tertiary) !important;
  --dsw-alias-label-caption: var(--liang-tertiary) !important;
  --dsw-alias-border-l1: var(--liang-border) !important;
  --dsw-alias-border-l2-darkmode-thin: var(--liang-border) !important;
  --dsw-alias-border-l2: var(--liang-border) !important;
  --dsw-alias-border-l3: var(--liang-border) !important;
  --dsw-alias-button-primary-fill: var(--liang-accent) !important;
  --dsw-alias-button-primary-hover: var(--liang-accent-hover) !important;
  --dsw-alias-button-info-fill: var(--liang-accent) !important;
  --dsw-alias-button-info-hover: var(--liang-accent-hover) !important;
  --dsw-alias-state-business-primary: var(--liang-accent) !important;
  --dsw-alias-interactive-bg-hover: var(--liang-hover) !important;
  --dsw-alias-interactive-bg-active: var(--liang-hover) !important;
  --dsw-alias-button-elevated-fill: var(--liang-layer-1) !important;
  --dsw-alias-button-floating-fill: var(--liang-layer-2) !important;
  --dsw-alias-button-floating-hover: var(--liang-layer-3) !important;
  --dsw-alias-interactive-bg-hover-solid: var(--liang-layer-2) !important;
  --dsw-specific-bubble: var(--liang-layer-2) !important;
  --dsw-specific-input-major: var(--liang-layer-1) !important;
  --dsw-specific-menu: var(--liang-layer-3) !important;
  --dsw-specific-selector: var(--liang-layer-2) !important;
  --dsw-alias-markdown-citation: var(--liang-layer-2) !important;
  --dsw-alias-markdown-code-block-banner: var(--liang-layer-1) !important;
  --dsw-alias-markdown-code-block: var(--liang-layer-1) !important;
  --dsw-alias-markdown-code-segment-selected: var(--liang-layer-2) !important;
  --dsw-alias-markdown-code-segment-unselected: var(--liang-layer-1) !important;
  --dsw-alias-markdown-inline-code: var(--liang-layer-2) !important;
  --dsw-alias-markdown-placeholder: var(--liang-layer-1) !important;
  --dsw-alias-markdown-tag: var(--liang-layer-2) !important;
  background: var(--liang-page) !important;
}

body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) {
  --dsw-alias-brand-primary-new-colorprimary-new-color: rgb(65 118 230) !important;
  --dsw-alias-brand-primary: rgb(15 17 21) !important;
  --dsw-alias-brand-text: rgb(15 17 21) !important;
  --dsw-alias-button-primary-fill: rgb(15 17 21) !important;
  --dsw-alias-button-primary-hover: rgb(53 54 56) !important;
  --dsw-alias-button-info-fill: rgb(65 118 230) !important;
  --dsw-alias-button-info-hover: rgb(103 158 254) !important;
  --dsw-alias-state-business-primary: rgb(65 118 230) !important;
  --dsw-alias-label-primary-inverted: rgb(249 250 251) !important;
  --dsw-alias-button-elevated-fill: rgb(255 255 255) !important;
  --dsw-alias-button-floating-fill: rgb(255 255 255) !important;
  --dsw-alias-button-floating-hover: rgb(241 243 245) !important;
  --dsw-alias-interactive-bg-hover-solid: rgb(241 243 245) !important;
  --dsw-specific-bubble: rgb(237 243 254) !important;
  --dsw-specific-input-major: rgb(255 255 255) !important;
  --dsw-specific-menu: rgb(255 255 255) !important;
  --dsw-specific-selector: rgb(245 246 247) !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] {
  --dsw-alias-brand-primary-new-colorprimary-new-color: #c19a49 !important;
  --dsw-alias-brand-primary: #c19a49 !important;
  --dsw-alias-brand-text: #d5b56e !important;
  --dsw-alias-button-info-fill: #c19a49 !important;
  --dsw-alias-button-info-hover: #d5b56e !important;
  --dsw-alias-state-business-primary: #c19a49 !important;
  --dsw-alias-bg-module-platform: var(--liang-layer-3) !important;
  --dsw-specific-sidebar-nav-item-active: var(--liang-layer-3) !important;
  --dsw-specific-sidebar-nav-item-hover: var(--liang-hover) !important;
}

/* The low-intensity skin is light by default, but it must not turn a dark
   Harness document into a light surface. Keep the skin's portrait progression
   while switching the shared UI layers back to a readable charcoal palette. */
body[data-liang-skin="on"][data-ds-dark-theme]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) {
  --liang-page: rgb(17 17 17) !important;
  --liang-bg-base: rgb(17 17 17 / 42%) !important;
  --liang-layer-1: rgb(30 27 25 / 94%) !important;
  --liang-layer-2: rgb(41 35 30 / 96%) !important;
  --liang-layer-3: rgb(41 35 30 / 99%) !important;
  --liang-sidebar: rgb(23 20 18 / 96%) !important;
  --liang-ink: rgb(244 241 232) !important;
  --liang-secondary: rgb(184 180 169) !important;
  --liang-tertiary: rgb(137 134 126) !important;
  --liang-border: rgb(244 241 232 / 15%) !important;
  --liang-hover: rgb(244 241 232 / 9%) !important;
  --dsw-alias-brand-primary: var(--liang-accent) !important;
  --dsw-alias-brand-text: var(--liang-accent) !important;
  --dsw-alias-button-primary-fill: var(--liang-accent) !important;
  --dsw-alias-button-primary-hover: var(--liang-accent-hover) !important;
  --dsw-alias-button-info-fill: var(--liang-accent) !important;
  --dsw-alias-button-info-hover: var(--liang-accent-hover) !important;
  --dsw-alias-state-business-primary: var(--liang-accent) !important;
  --dsw-alias-button-elevated-fill: var(--liang-layer-1) !important;
  --dsw-alias-button-floating-fill: var(--liang-layer-2) !important;
  --dsw-alias-button-floating-hover: var(--liang-layer-3) !important;
  --dsw-alias-interactive-bg-hover-solid: var(--liang-layer-2) !important;
  --dsw-specific-bubble: var(--liang-layer-2) !important;
  --dsw-specific-input-major: var(--liang-layer-1) !important;
  --dsw-specific-menu: var(--liang-layer-3) !important;
  --dsw-specific-selector: var(--liang-layer-2) !important;
  background: var(--liang-page) !important;
}

body[data-liang-skin="on"][data-ds-dark-theme]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) .liang-skin-backdrop {
  background: var(--liang-page) !important;
}

body[data-liang-skin="on"][data-ds-dark-theme]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) .liang-skin-backdrop::after {
  background: linear-gradient(90deg, var(--liang-page) 0 28%, transparent 57% 100%);
}

/* The host renders the running-turn label as a clipped blue text gradient.
   Retarget only that gradient's color tokens in the custom dark skin; keep
   the host's text clipping and shimmer behavior, and leave light mode alone. */
body[data-liang-skin="on"][data-liang-stage="5"] [class*="_turnStatus"] {
  --dsw-static-deepseek-500: #c19a49 !important;
  --dsw-static-deepseek-200: #d5b56e !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] [class*="_turnStatusClock"] {
  color: #c19a49 !important;
  -webkit-text-fill-color: #c19a49 !important;
}

/* Preserve the wordmark badge contrast in the low-intensity shell. */
body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) button[aria-label="\u65B0\u5EFA\u4F1A\u8BDD"] svg[viewBox="0 0 182 24"] > rect[width="52"] {
  fill: rgb(15 17 21) !important;
}

body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) button[aria-label="\u65B0\u5EFA\u4F1A\u8BDD"] svg[viewBox="0 0 182 24"] > g[clip-path*="badge"] path {
  fill: rgb(249 250 251) !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] button[aria-label="\u65B0\u5EFA\u4F1A\u8BDD"] svg[viewBox="0 0 182 24"] > rect[width="52"] {
  fill: #c19a49 !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] button[aria-label="\u65B0\u5EFA\u4F1A\u8BDD"] svg[viewBox="0 0 182 24"] > g[clip-path*="badge"] path {
  fill: #171816 !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] [aria-label^="\u9009\u62E9\u6A21\u578B"] > span:nth-of-type(2) {
  color: #d5b56e !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] [class*="heroGlow"] ellipse {
  fill: #c19a49 !important;
  fill-opacity: 0.16 !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] span[class*="_previewBadge"] {
  color: #171816 !important;
  background: #c19a49 !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] button[aria-label="\u53D1\u9001\u6D88\u606F"] {
  color: #171816 !important;
}

body[data-liang-skin="on"][data-liang-stage="5"] button[aria-label="\u53D1\u9001\u6D88\u606F"]:disabled {
  opacity: 0.62;
}

body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) button[aria-label="\u53D1\u9001\u6D88\u606F"] {
  color: #fff !important;
}

body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) button[aria-label="\u53D1\u9001\u6D88\u606F"]:disabled {
  color: rgb(255 255 255 / 92%) !important;
  background: rgb(65 118 230 / 42%) !important;
  opacity: 1;
}

body[data-liang-skin="on"] > #root {
  position: relative;
  z-index: 1;
  background: transparent !important;
}

body[data-liang-skin="on"] button,
body[data-liang-skin="on"] input,
body[data-liang-skin="on"] textarea {
  transition: color 160ms linear, background-color 160ms linear, border-color 160ms linear;
}

/* The composer card has a native theme-mode fill, so keep its surface and
   readable ink aligned with the active Liang palette. */
body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) [data-composer-card="true"] {
  border-color: var(--liang-border) !important;
  color: var(--liang-ink) !important;
  background: var(--liang-layer-1) !important;
  box-shadow: 0 8px 28px rgb(20 22 20 / 8%);
}

body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) [data-composer-card="true"] :is(textarea, button, [data-input-mirror="true"]) {
  color: var(--liang-ink) !important;
  caret-color: var(--liang-accent) !important;
}

body[data-liang-skin="on"]:is(
  [data-liang-stage="0"],
  [data-liang-stage="1"],
  [data-liang-stage="2"],
  [data-liang-stage="3"]
) [data-composer-card="true"] textarea::placeholder {
  color: var(--liang-tertiary) !important;
  opacity: 1;
}

.liang-effort-control {
  --liang-control-accent: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6);
  --liang-control-rail: var(--dsw-alias-border-l3, rgb(0 0 0 / 16%));
  position: relative;
  display: flex;
  width: 124px;
  height: 28px;
  align-items: center;
  margin: 0 3px;
  overflow: visible;
}

body[data-liang-skin="on"] .liang-effort-control {
  --liang-control-accent: var(--liang-secondary);
  --liang-control-rail: color-mix(in srgb, var(--liang-secondary) 28%, transparent);
}

.liang-effort-control__ticks {
  position: absolute;
  z-index: 0;
  inset: 0 10px;
  pointer-events: none;
}

.liang-effort-control__ticks::before {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 1px;
  content: "";
  background: var(--liang-control-rail);
  transform: translateY(-50%);
}

.liang-effort-control__tooltip {
  position: absolute;
  z-index: 4;
  bottom: calc(100% + 7px);
  left: calc(10px + (100% - 20px) * var(--liang-slider-ratio));
  min-width: max-content;
  padding: 5px 8px;
  border: 1px solid var(--liang-border, rgb(0 0 0 / 12%));
  border-radius: 7px;
  color: var(--liang-ink, #171816);
  background: var(--liang-layer-1, #fff);
  box-shadow: 0 5px 16px rgb(0 0 0 / 16%);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.01em;
  pointer-events: none;
  transform: translateX(-50%);
  white-space: nowrap;
}

.liang-effort-control__tooltip::after {
  position: absolute;
  top: 100%;
  left: 50%;
  width: 7px;
  height: 7px;
  content: "";
  background: inherit;
  transform: translate(-50%, -4px) rotate(45deg);
}

.liang-effort-control__tick {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 7px;
  background: var(--liang-control-accent);
  opacity: 0.42;
  transform: translate(-50%, -50%);
}

.liang-effort-control__range {
  position: relative;
  z-index: 1;
  width: calc(100% - 7px);
  height: 28px;
  margin: 0 3.5px;
  cursor: ew-resize;
  appearance: none;
  background: transparent;
  touch-action: pan-y;
}

.liang-effort-control__range:disabled {
  cursor: progress;
  opacity: 0.58;
}

.liang-effort-control__range::-webkit-slider-runnable-track {
  height: 1px;
  border-radius: 1px;
  background: transparent;
}

.liang-effort-control__range::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  margin-top: -6px;
  border: 1.5px solid color-mix(in srgb, var(--liang-control-accent) 72%, transparent);
  border-radius: 50%;
  appearance: none;
  background: radial-gradient(circle, var(--liang-control-accent) 0 2px, color-mix(in srgb, var(--liang-control-accent) 22%, var(--dsw-alias-bg-layer-1, #fff)) 2.5px);
  box-shadow: 0 1px 4px rgb(0 0 0 / 14%);
}

body[data-liang-skin="on"] .liang-effort-control__range::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  margin-top: -6px;
  border-color: color-mix(in srgb, var(--liang-control-accent) 72%, transparent);
  background: radial-gradient(circle, var(--liang-control-accent) 0 2px, color-mix(in srgb, var(--liang-control-accent) 22%, var(--liang-layer-1)) 2.5px);
}

.liang-effort-control__range::-moz-range-track {
  height: 1px;
  background: transparent;
}

.liang-effort-control__range::-moz-range-progress {
  height: 1px;
  background: transparent;
}

.liang-effort-control__range::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border: 1.5px solid color-mix(in srgb, var(--liang-control-accent) 72%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--liang-control-accent) 24%, var(--dsw-alias-bg-layer-1, #fff));
}

.liang-effort-control__range:focus-visible {
  outline: none;
}

.liang-effort-control[data-state="error"] {
  --liang-control-accent: var(--dsw-alias-state-error-primary, #e43c3c);
}

.liang-appearance-choice {
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  flex: 180px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 20px 32px;
  border-radius: 16px;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  font-size: 14px;
  line-height: 22px;
  display: flex;
}

[class*="_8HJdBW_cubeRow"]:has(.liang-appearance-choice) {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.liang-appearance-choice:hover:not([aria-pressed="true"]) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.liang-appearance-choice[aria-pressed="true"] {
  border-color: var(--dsw-static-neutral-bluish-400);
  background: var(--dsw-alias-bg-module-platform);
}

.liang-appearance-choice__icon {
  display: block;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  color: currentColor;
  font-size: 16px;
  line-height: 16px;
}

.liang-appearance-choice__label {
  display: block;
}

/* Keep the host's three theme cubes untouched. These rules only style the
   fourth button that is appended to the host cube row. */
.liang-appearance-choice:disabled {
  cursor: progress;
  opacity: 0.7;
}

.liang-appearance-binding {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0 0;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

.liang-appearance-binding__label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liang-appearance-binding__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.liang-appearance-binding__description {
  display: block;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liang-appearance-binding__input {
  position: relative;
  flex: 0 0 36px;
  width: 36px;
  height: 20px;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  appearance: none;
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-module-platform));
}

.liang-appearance-binding__input::before {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  content: "";
  background: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
  transition: transform 160ms ease, background-color 160ms ease;
}

.liang-appearance-binding__input:checked {
  border-color: var(--dsw-static-neutral-bluish-400);
  background: var(--dsw-static-neutral-bluish-400);
}

.liang-appearance-binding__input:checked::before {
  background: var(--dsw-alias-bg-layer-1, #fff);
  transform: translateX(16px);
}

.liang-appearance-binding__input:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-hover);
}

.liang-appearance-binding__input:disabled {
  cursor: progress;
  opacity: 0.7;
}

@media (max-width: 760px) {
  .liang-effort-control {
    width: 92px;
  }

  .liang-skin-backdrop img {
    right: -18vw;
    width: 92vw;
    opacity: calc(var(--liang-portrait-opacity, 0.45) * 0.72);
  }

}

@media (prefers-reduced-motion: reduce) {
  .liang-skin-backdrop,
  .liang-skin-backdrop img,
  body[data-liang-skin="on"] button,
  body[data-liang-skin="on"] input,
  body[data-liang-skin="on"] textarea {
    transition: none;
  }
}
`;

// src/client/logic.ts
var PREVIEW_MAX_FRAME = 240;
var MAX_LEVEL = 30;
var LIANG_RANKS = ["\u5C0F\u96BE\u6881", "\u7262\u6881", "\u6881\u5B50", "\u6881\u5723", "\u6881\u795E", "\u6881\u7956"];
var STOPS = [
  { at: 0, page: [232, 233, 229], surface: [248, 248, 245], surface2: [238, 239, 235], ink: [23, 24, 22], secondary: [112, 116, 111], accent: [181, 43, 36], portraitOpacity: 0.92 },
  { at: 6, page: [211, 211, 206], surface: [239, 239, 234], surface2: [224, 224, 218], ink: [26, 26, 24], secondary: [101, 101, 96], accent: [181, 43, 36], portraitOpacity: 0.93 },
  { at: 12, page: [171, 168, 162], surface: [211, 208, 201], surface2: [190, 186, 179], ink: [27, 26, 24], secondary: [83, 79, 74], accent: [166, 54, 42], portraitOpacity: 0.94 },
  { at: 18, page: [117, 112, 106], surface: [154, 148, 140], surface2: [128, 122, 115], ink: [24, 22, 20], secondary: [65, 61, 56], accent: [154, 56, 42], portraitOpacity: 0.94 },
  { at: 24, page: [43, 39, 37], surface: [48, 43, 40], surface2: [58, 51, 46], ink: [244, 241, 232], secondary: [184, 180, 169], accent: [181, 92, 54], portraitOpacity: 0.94 },
  { at: 30, page: [17, 17, 17], surface: [30, 27, 25], surface2: [41, 35, 30], ink: [244, 241, 232], secondary: [184, 180, 169], accent: [193, 154, 73], portraitOpacity: 0.94 }
];
function clampFrame(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PREVIEW_MAX_FRAME, Math.max(0, Math.round(value)));
}
function frameForEffort(index, count) {
  if (count <= 1 || !Number.isFinite(index)) return 0;
  const safe = Math.min(count - 1, Math.max(0, Math.round(index)));
  return Math.round(safe / (count - 1) * PREVIEW_MAX_FRAME);
}
function nearestEffortIndex(frame, efforts) {
  if (efforts.length === 0) return -1;
  const safe = clampFrame(frame);
  let best = 0;
  let distance = Math.abs(safe - frameForEffort(0, efforts.length));
  for (let index = 1; index < efforts.length; index += 1) {
    const next = Math.abs(safe - frameForEffort(index, efforts.length));
    if (next < distance) {
      best = index;
      distance = next;
    }
  }
  return best;
}
function selectedEffortIndex(efforts, selectedId, defaultId) {
  const id = selectedId ?? defaultId;
  return id === void 0 ? -1 : efforts.findIndex((effort) => effort.id === id);
}
function portraitBlendForLevel(level, anchors) {
  if (anchors.length === 0) return { lowerIndex: -1, upperIndex: -1, mix: 0 };
  const safeLevel = Number.isFinite(level) ? Math.min(anchors[anchors.length - 1], Math.max(anchors[0], level)) : anchors[0];
  let upperIndex = anchors.findIndex((anchor) => anchor >= safeLevel);
  if (upperIndex < 0) upperIndex = anchors.length - 1;
  const lowerIndex = Math.max(0, upperIndex - (anchors[upperIndex] > safeLevel ? 1 : 0));
  const span = anchors[upperIndex] - anchors[lowerIndex];
  return {
    lowerIndex,
    upperIndex,
    mix: span === 0 ? 0 : (safeLevel - anchors[lowerIndex]) / span
  };
}
function liangRankForFrame(rawFrame) {
  const level = clampFrame(rawFrame) / PREVIEW_MAX_FRAME * MAX_LEVEL;
  const index = level >= MAX_LEVEL ? LIANG_RANKS.length - 1 : Math.floor(level / 6);
  return LIANG_RANKS[Math.min(LIANG_RANKS.length - 1, Math.max(0, index))];
}
function indicatorLabel(rawFrame, efforts) {
  const effort = efforts[nearestEffortIndex(rawFrame, efforts)];
  return effort === void 0 ? liangRankForFrame(rawFrame) : `${liangRankForFrame(rawFrame)} \xB7 ${effort.name}`;
}
function lerp(a, b, amount) {
  return a + (b - a) * amount;
}
function mix(a, b, amount) {
  return [
    Math.round(lerp(a[0], b[0], amount)),
    Math.round(lerp(a[1], b[1], amount)),
    Math.round(lerp(a[2], b[2], amount))
  ];
}
function rgb(value, alpha = 1) {
  return alpha === 1 ? `rgb(${value[0]} ${value[1]} ${value[2]})` : `rgb(${value[0]} ${value[1]} ${value[2]} / ${alpha})`;
}
function paletteForFrame(rawFrame) {
  const frame = clampFrame(rawFrame);
  const level = frame / PREVIEW_MAX_FRAME * MAX_LEVEL;
  const portraitStage = Math.min(5, Math.floor(level / 6));
  const portraitFrom = STOPS[portraitStage];
  const portraitTo = STOPS[Math.min(5, portraitStage + 1)];
  const portraitAmount = portraitFrom === portraitTo ? 0 : (level - portraitFrom.at) / (portraitTo.at - portraitFrom.at);
  const dark = level >= 24;
  const stage = dark ? 5 : 0;
  const ui = dark ? STOPS[5] : STOPS[0];
  const page = ui.page;
  const surface = ui.surface;
  const surface2 = ui.surface2;
  const sidebar = mix(page, surface2, 0.25);
  const ink = ui.ink;
  const secondary = ui.secondary;
  const accent = dark ? [193, 154, 73] : [65, 118, 230];
  const accentHover = mix(accent, ink, 0.13);
  return {
    level,
    stage,
    strength: level / MAX_LEVEL,
    page: rgb(page),
    // Keep the shell readable while allowing the right-side portrait to remain
    // visibly present. Dense controls use the opaque layer tokens below.
    base: rgb(page, dark ? 0.42 : 0.28),
    layer1: rgb(surface, 0.94),
    layer2: rgb(surface2, 0.96),
    layer3: rgb(surface2, 0.99),
    sidebar: rgb(sidebar, 0.96),
    ink: rgb(ink),
    secondary: rgb(secondary),
    tertiary: rgb(mix(secondary, page, 0.28)),
    border: rgb(ink, dark ? 0.15 : 0.12),
    accent: rgb(accent),
    accentHover: rgb(accentHover),
    hover: rgb(ink, dark ? 0.09 : 0.07),
    portraitOpacity: String(lerp(
      portraitFrom.portraitOpacity,
      portraitTo.portraitOpacity,
      portraitAmount
    ))
  };
}

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var PACKAGE_ID = "dsh-client-liang-intensity-skin";
var LOCALE_NAMESPACE = "liang.skin";
var ASSET_PREFIX = `/plugins/${PACKAGE_ID}/assets`;
var FIRST_PORTRAIT_FILE = "portrait-source-v2/stage-00.webp";
var BIND_EFFORT_KEY = "dsh-liang-intensity-skin.bind-effort";
var PORTRAIT_ANCHORS = [
  { level: 0, file: "stage-00.webp" },
  { level: 1, file: "level-01.webp" },
  { level: 3, file: "level-03.webp" },
  { level: 4, file: "level-04.webp" },
  { level: 6, file: "stage-06.webp" },
  { level: 7, file: "level-07.webp" },
  { level: 9, file: "level-09.webp" },
  { level: 10, file: "level-10.webp" },
  { level: 12, file: "stage-12.webp" },
  { level: 13, file: "level-13.webp" },
  { level: 14, file: "level-14.webp" },
  { level: 15, file: "bridge-15.webp" },
  { level: 16, file: "level-16.webp" },
  { level: 17, file: "level-17.webp" },
  { level: 18, file: "stage-18.webp" },
  { level: 19, file: "level-19.webp" },
  { level: 21, file: "level-21.webp" },
  { level: 22, file: "level-22.webp" },
  { level: 24, file: "stage-24.webp" },
  { level: 25, file: "level-25.webp" },
  { level: 27, file: "bridge-27.webp" },
  { level: 28, file: "level-28.webp" },
  { level: 29, file: "level-29.webp" },
  { level: 30, file: "stage-30.webp" }
];
var ANCHOR_LEVELS = PORTRAIT_ANCHORS.map((anchor) => anchor.level);
var cssVariables = [
  "--liang-strength",
  "--liang-page",
  "--liang-bg-base",
  "--liang-layer-1",
  "--liang-layer-2",
  "--liang-layer-3",
  "--liang-sidebar",
  "--liang-ink",
  "--liang-secondary",
  "--liang-tertiary",
  "--liang-border",
  "--liang-accent",
  "--liang-accent-hover",
  "--liang-hover",
  "--liang-portrait-opacity"
];
var SkinPresenter = class {
  scope;
  theme;
  root;
  portrait;
  preloads;
  portraitReady = false;
  enabled = true;
  // Default to the max frame so the first paint after load is the dark shell;
  // starting at 0 flashed the light palette before the directory resolved.
  frame = PREVIEW_MAX_FRAME;
  pendingFrame = PREVIEW_MAX_FRAME;
  raf = 0;
  disposed = false;
  unsubscribe;
  constructor(scope, theme) {
    this.scope = scope;
    this.theme = theme;
    this.root = document.createElement("div");
    this.root.className = "liang-skin-backdrop";
    this.root.dataset.plugin = PACKAGE_ID;
    this.root.dataset.media = "sequence";
    this.root.setAttribute("aria-hidden", "true");
    this.portrait = document.createElement("img");
    this.portrait.className = "liang-skin-sequence-frame";
    this.portrait.alt = "";
    this.portrait.draggable = false;
    this.portrait.decoding = "async";
    this.portrait.src = `${ASSET_PREFIX}/${FIRST_PORTRAIT_FILE}`;
    this.portrait.addEventListener("error", this.handleSequenceError);
    this.preloads = PORTRAIT_ANCHORS.map(({ file }) => {
      const image = new Image();
      image.loading = "eager";
      image.decoding = "async";
      image.src = `${ASSET_PREFIX}/portrait-source-v2/${file}`;
      return image;
    });
    void Promise.all(this.preloads.map((image) => image.decode())).then(
      () => {
        if (this.disposed) return;
        this.portraitReady = true;
        this.root.dataset.media = "sequence";
        this.updatePortrait(paletteForFrame(this.frame).level);
      },
      () => {
      }
    );
    this.root.append(this.portrait);
    document.body.prepend(this.root);
    this.unsubscribe = scope.subscribe(() => this.syncSettings());
    this.syncSettings();
  }
  handleSequenceError = () => {
    if (this.portrait.src.endsWith(FIRST_PORTRAIT_FILE)) {
      this.root.dataset.media = "color";
      return;
    }
    this.portraitReady = false;
    this.portrait.src = `${ASSET_PREFIX}/${FIRST_PORTRAIT_FILE}`;
    this.root.dataset.media = "sequence";
  };
  syncSettings() {
    this.setEnabled(this.scope.getSnapshot().enabled);
  }
  isEnabled() {
    return this.enabled;
  }
  getFrame() {
    return this.frame;
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      if (!this.root.isConnected) document.body.prepend(this.root);
      document.body.dataset.liangSkin = "on";
      this.applyFrame();
    } else {
      this.root.remove();
      delete document.body.dataset.liangSkin;
      delete document.body.dataset.liangStage;
      for (const name of cssVariables) document.body.style.removeProperty(name);
    }
  }
  setFrame(frame) {
    this.pendingFrame = Math.min(PREVIEW_MAX_FRAME, Math.max(0, Math.round(frame)));
    this.frame = this.pendingFrame;
    if (!this.enabled) return;
    if (this.raf !== 0) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.frame = this.pendingFrame;
      this.applyFrame();
    });
  }
  applyFrame() {
    const palette = paletteForFrame(this.frame);
    const body = document.body;
    this.syncNativeTheme(palette.stage === 5 ? "dark" : "light");
    body.dataset.liangStage = String(palette.stage);
    body.style.setProperty("--liang-strength", String(palette.strength));
    body.style.setProperty("--liang-page", palette.page);
    body.style.setProperty("--liang-bg-base", palette.base);
    body.style.setProperty("--liang-layer-1", palette.layer1);
    body.style.setProperty("--liang-layer-2", palette.layer2);
    body.style.setProperty("--liang-layer-3", palette.layer3);
    body.style.setProperty("--liang-sidebar", palette.sidebar);
    body.style.setProperty("--liang-ink", palette.ink);
    body.style.setProperty("--liang-secondary", palette.secondary);
    body.style.setProperty("--liang-tertiary", palette.tertiary);
    body.style.setProperty("--liang-border", palette.border);
    body.style.setProperty("--liang-accent", palette.accent);
    body.style.setProperty("--liang-accent-hover", palette.accentHover);
    body.style.setProperty("--liang-hover", palette.hover);
    body.style.setProperty("--liang-portrait-opacity", palette.portraitOpacity);
    this.updatePortrait(palette.level);
  }
  syncNativeTheme(theme = paletteForFrame(this.frame).stage === 5 ? "dark" : "light") {
    if (!this.enabled || this.theme.getTheme().preference === theme) return;
    this.theme.setTheme(theme);
  }
  updatePortrait(level) {
    if (!this.portraitReady) return;
    const { lowerIndex, upperIndex, mix: mix2 } = portraitBlendForLevel(
      level,
      ANCHOR_LEVELS
    );
    const lower = PORTRAIT_ANCHORS[lowerIndex];
    const upper = PORTRAIT_ANCHORS[upperIndex];
    const selected = mix2 >= 0.5 ? upper : lower;
    const source = `${ASSET_PREFIX}/portrait-source-v2/${selected.file}`;
    if (this.portrait.getAttribute("src") !== source) this.portrait.src = source;
  }
  async choose(enabled) {
    this.setEnabled(enabled);
    try {
      await this.scope.set(enabled);
    } catch (error) {
      this.syncSettings();
      throw error;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.portrait.removeEventListener("error", this.handleSequenceError);
    for (const image of this.preloads) image.src = "";
    this.root.remove();
    document.body.removeAttribute("data-liang-skin");
    delete document.body.dataset.liangStage;
    for (const name of cssVariables) document.body.style.removeProperty(name);
  }
};
function modelReasoning(state) {
  const current = state.current;
  if (current === null) return null;
  const group = state.groups.find((item) => item.id === current.provider);
  const model = group?.models.find((item) => item.id === current.model);
  if (model?.reasoning === void 0) return null;
  return {
    selection: current,
    efforts: model.reasoning.efforts,
    defaultEffort: model.reasoning.defaultEffort
  };
}
function LiangEffortSlider({ directory, load, select, presenter, scope }) {
  const state = (0, import_react.useSyncExternalStore)(
    (listener) => directory.subscribe(listener),
    () => directory.getSnapshot()
  );
  const skin = (0, import_react.useSyncExternalStore)(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot()
  );
  const reasoning = (0, import_react.useMemo)(() => modelReasoning(state), [state]);
  const efforts = reasoning?.efforts ?? [];
  const committedIndex = selectedEffortIndex(
    efforts,
    reasoning?.selection.reasoningEffort,
    reasoning?.defaultEffort
  );
  const committedFrame = committedIndex < 0 ? PREVIEW_MAX_FRAME : frameForEffort(committedIndex, efforts.length);
  const bindEffort = skin.bindEffort;
  const [frame, setFrame] = (0, import_react.useState)(() => bindEffort ? committedFrame : presenter.getFrame());
  const [pending, setPending] = (0, import_react.useState)(false);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const [interacting, setInteracting] = (0, import_react.useState)(false);
  const dragging = (0, import_react.useRef)(false);
  const dragStartFrame = (0, import_react.useRef)(frame);
  const enabled = skin.enabled;
  (0, import_react.useEffect)(() => {
    if (enabled) load();
  }, [enabled, load]);
  (0, import_react.useEffect)(() => {
    if (!bindEffort || dragging.current || pending) return;
    setFrame(committedFrame);
    presenter.setFrame(committedFrame);
  }, [bindEffort, committedFrame, pending, presenter]);
  if (!enabled) return null;
  if (bindEffort && (reasoning === null || efforts.length < 2)) return null;
  const previewIndex = nearestEffortIndex(frame, efforts);
  const previewEffort = efforts[previewIndex];
  const progressRatio = frame / PREVIEW_MAX_FRAME;
  const tooltipLabel = indicatorLabel(frame, bindEffort ? efforts : []);
  const commit = async (rawFrame) => {
    if (!bindEffort) {
      dragging.current = false;
      setFrame(rawFrame);
      presenter.setFrame(rawFrame);
      return;
    }
    const targetIndex = nearestEffortIndex(rawFrame, efforts);
    const target = efforts[targetIndex];
    if (target === void 0) return;
    const targetFrame = frameForEffort(targetIndex, efforts.length);
    dragging.current = false;
    setFrame(targetFrame);
    presenter.setFrame(targetFrame);
    if (targetIndex === committedIndex || pending) return;
    setPending(true);
    setFailed(false);
    const accepted = await select({
      provider: reasoning.selection.provider,
      model: reasoning.selection.model,
      reasoningEffort: target.id
    });
    setPending(false);
    if (!accepted) {
      setFailed(true);
      setFrame(committedFrame);
      presenter.setFrame(committedFrame);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: "liang-effort-control",
      "data-plugin": PACKAGE_ID,
      "data-state": failed ? "error" : pending ? "pending" : "ready",
      title: bindEffort ? previewEffort?.name : void 0,
      children: [
        interacting && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "output",
          {
            className: "liang-effort-control__tooltip",
            style: { "--liang-slider-ratio": progressRatio },
            children: tooltipLabel
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "liang-effort-control__ticks", "aria-hidden": "true", children: efforts.map((effort, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "i",
          {
            className: "liang-effort-control__tick",
            style: { left: `${frameForEffort(index, efforts.length) / PREVIEW_MAX_FRAME * 100}%` }
          },
          effort.id
        )) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "liang-effort-control__range",
            type: "range",
            min: 0,
            max: PREVIEW_MAX_FRAME,
            step: 1,
            value: frame,
            disabled: pending || state.status === "selecting",
            "aria-label": bindEffort ? "\u601D\u8003\u7B49\u7EA7" : "\u76AE\u80A4\u8FDB\u5EA6",
            "aria-valuetext": bindEffort ? previewEffort?.name ?? "" : tooltipLabel,
            onPointerDown: () => {
              dragging.current = true;
              dragStartFrame.current = frame;
              setInteracting(true);
            },
            onInput: (event) => {
              dragging.current = true;
              const next = Number(event.currentTarget.value);
              setFrame(next);
              presenter.setFrame(next);
            },
            onPointerUp: (event) => {
              setInteracting(false);
              void commit(Number(event.currentTarget.value));
            },
            onPointerCancel: () => {
              setInteracting(false);
              dragging.current = false;
              setFrame(dragStartFrame.current);
              presenter.setFrame(dragStartFrame.current);
            },
            onKeyUp: (event) => {
              setInteracting(false);
              if (event.key !== "Escape") void commit(Number(event.currentTarget.value));
            },
            onBlur: (event) => {
              setInteracting(false);
              if (dragging.current) void commit(Number(event.currentTarget.value));
            },
            onKeyDown: (event) => {
              setInteracting(true);
              if (event.key === "Escape" && !pending) {
                setInteracting(false);
                dragging.current = false;
                setFrame(dragStartFrame.current);
                presenter.setFrame(dragStartFrame.current);
              }
            }
          }
        )
      ]
    }
  );
}
var NATIVE_APPEARANCE_GROUP = '[class*="_8HJdBW_group"]';
var NATIVE_APPEARANCE_ROW = '[class*="_8HJdBW_cubeRow"]';
var LIANG_APPEARANCE_BUTTON = "liang-appearance-choice";
var LIANG_BINDING_CONTROL = "liang-appearance-binding";
var LIANG_BINDING_INPUT = "liang-appearance-binding__input";
function installLiangAppearanceButton(scope, presenter) {
  let pending = false;
  const hookedNativeButtons = /* @__PURE__ */ new Set();
  const nativeClickHandlers = /* @__PURE__ */ new Map();
  const sync = () => {
    const group = [...document.querySelectorAll(NATIVE_APPEARANCE_GROUP)].find((node) => node.querySelector('[class*="_8HJdBW_themeCube"]'));
    const row = group?.querySelector(NATIVE_APPEARANCE_ROW);
    if (row === void 0 || row === null) return;
    let customButton = row.querySelector(`.${LIANG_APPEARANCE_BUTTON}`);
    if (customButton === null) {
      customButton = document.createElement("button");
      customButton.className = LIANG_APPEARANCE_BUTTON;
      customButton.type = "button";
      customButton.dataset.plugin = PACKAGE_ID;
      customButton.setAttribute("aria-label", "\u6ED1\u52A8\u53D8\u7956");
      const icon = document.createElement("span");
      icon.className = "liang-appearance-choice__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\u25C8";
      const label = document.createElement("span");
      label.className = "liang-appearance-choice__label";
      label.textContent = document.documentElement.lang.toLowerCase().startsWith("en") ? "Slider" : "\u6ED1\u52A8\u53D8\u7956";
      customButton.append(icon, label);
      customButton.addEventListener("click", () => {
        if (pending || scope.getSnapshot().enabled) return;
        pending = true;
        sync();
        void presenter.choose(true).finally(() => {
          pending = false;
          sync();
        });
      });
    }
    if (customButton.parentElement !== row) row.append(customButton);
    const snapshot = scope.getSnapshot();
    customButton.disabled = pending;
    customButton.setAttribute("aria-pressed", String(snapshot.enabled));
    let bindingControl = group.querySelector(`.${LIANG_BINDING_CONTROL}`);
    if (!snapshot.enabled) {
      bindingControl?.remove();
      bindingControl = null;
    } else if (bindingControl === null) {
      bindingControl = document.createElement("label");
      bindingControl.className = LIANG_BINDING_CONTROL;
      bindingControl.dataset.plugin = PACKAGE_ID;
      const bindingCopy = document.createElement("span");
      bindingCopy.className = "liang-appearance-binding__copy";
      const bindingLabel = document.createElement("span");
      bindingLabel.className = "liang-appearance-binding__label";
      const bindingText = document.documentElement.lang.toLowerCase().startsWith("en") ? "Bind slider to reasoning level" : "\u6ED1\u52A8\u53D8\u7956\u7ED1\u5B9A\u601D\u8003\u7B49\u7EA7";
      bindingLabel.textContent = bindingText;
      const bindingDescription = document.createElement("span");
      bindingDescription.className = "liang-appearance-binding__description";
      bindingDescription.id = "liang-appearance-binding-description";
      bindingDescription.textContent = document.documentElement.lang.toLowerCase().startsWith("en") ? "When off, the slider does not change the reasoning level." : "\u5173\u95ED\u4E4B\u540E\u6ED1\u5757\u4E0D\u8054\u52A8\u601D\u8003\u7B49\u7EA7";
      bindingCopy.append(bindingLabel, bindingDescription);
      const bindingInput = document.createElement("input");
      bindingInput.className = LIANG_BINDING_INPUT;
      bindingInput.type = "checkbox";
      bindingInput.setAttribute("role", "switch");
      bindingInput.setAttribute("aria-label", bindingText);
      bindingInput.setAttribute("aria-describedby", bindingDescription.id);
      bindingInput.addEventListener("change", () => {
        void scope.setBindEffort(bindingInput.checked).catch(() => sync());
      });
      bindingControl.append(bindingCopy, bindingInput);
      group.append(bindingControl);
    }
    if (bindingControl !== null) {
      const bindingInput = bindingControl.querySelector(`.${LIANG_BINDING_INPUT}`);
      if (bindingInput !== null) {
        bindingInput.checked = snapshot.bindEffort;
        bindingInput.setAttribute("aria-checked", String(snapshot.bindEffort));
        bindingInput.disabled = pending;
      }
    }
    for (const nativeButton of row.querySelectorAll('[class*="_8HJdBW_themeCube"]')) {
      if (hookedNativeButtons.has(nativeButton)) continue;
      hookedNativeButtons.add(nativeButton);
      const handleNativeClick = () => {
        if (pending || !scope.getSnapshot().enabled) return;
        pending = true;
        sync();
        void presenter.choose(false).finally(() => {
          pending = false;
          sync();
        });
      };
      nativeClickHandlers.set(nativeButton, handleNativeClick);
      nativeButton.addEventListener("click", handleNativeClick, { capture: true });
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = scope.subscribe(sync);
  sync();
  return () => {
    observer.disconnect();
    unsubscribe();
    for (const [nativeButton, handleNativeClick] of nativeClickHandlers) {
      nativeButton.removeEventListener("click", handleNativeClick, { capture: true });
    }
    document.querySelectorAll(`.${LIANG_APPEARANCE_BUTTON}`).forEach((button) => button.remove());
    document.querySelectorAll(`.${LIANG_BINDING_CONTROL}`).forEach((control) => control.remove());
  };
}
var inject = [
  "slots",
  "sessions",
  "modelDirectories",
  "locale",
  "theme"
];
function createPreferenceStore() {
  try {
    localStorage.removeItem("dsh-liang-intensity-skin.enabled");
  } catch {
  }
  let snapshot = {
    enabled: true,
    bindEffort: localStorage.getItem(BIND_EFFORT_KEY) !== "0"
  };
  const listeners = /* @__PURE__ */ new Set();
  const onStorage = (event) => {
    if (event.key !== BIND_EFFORT_KEY) return;
    const next = {
      enabled: snapshot.enabled,
      bindEffort: event.newValue !== "0"
    };
    if (next.enabled === snapshot.enabled && next.bindEffort === snapshot.bindEffort) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  window.addEventListener("storage", onStorage);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async set(enabled) {
      if (enabled === snapshot.enabled) return;
      snapshot = { ...snapshot, enabled };
      for (const listener of listeners) listener();
    },
    async setBindEffort(bindEffort) {
      if (bindEffort === snapshot.bindEffort) return;
      localStorage.setItem(BIND_EFFORT_KEY, bindEffort ? "1" : "0");
      snapshot = { ...snapshot, bindEffort };
      for (const listener of listeners) listener();
    },
    dispose() {
      window.removeEventListener("storage", onStorage);
      listeners.clear();
    }
  };
}
function apply(ctx) {
  const style = document.createElement("style");
  style.dataset.plugin = PACKAGE_ID;
  style.textContent = skin_default;
  document.head.append(style);
  ctx.effect(() => () => style.remove(), "liang-intensity-skin: scoped styles");
  const scope = createPreferenceStore();
  ctx.effect(() => () => scope.dispose(), "liang-intensity-skin: appearance preference");
  const theme = ctx.get("theme");
  const presenter = new SkinPresenter(scope, theme);
  ctx.effect(() => () => presenter.dispose(), "liang-intensity-skin: backdrop presenter");
  ctx.effect(
    () => installLiangAppearanceButton(scope, presenter),
    "liang-intensity-skin: native appearance extension"
  );
  ctx.effect(
    () => ctx.locale.register(LOCALE_NAMESPACE, {
      zh: {
        "appearance.title": "\u5916\u89C2",
        "appearance.light": "\u6D45\u8272",
        "appearance.dark": "\u6DF1\u8272",
        "appearance.system": "\u8DDF\u968F\u7CFB\u7EDF",
        "appearance.liang": "\u6ED1\u52A8\u53D8\u7956"
      },
      en: {
        "appearance.title": "Appearance",
        "appearance.light": "Light",
        "appearance.dark": "Dark",
        "appearance.system": "System",
        "appearance.liang": "Slider"
      }
    }),
    "liang-intensity-skin: settings locale"
  );
  ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    name: "conversation.input.right",
    id: "liang-intensity-control",
    order: 10,
    inject: (sessionId) => {
      const available = ctx.sessions.subagentAddress(sessionId) === void 0;
      const directory = ctx.modelDirectories.directoryFor(sessionId);
      return {
        directory: directory.store,
        presenter,
        scope,
        load: () => {
          if (available) void directory.load().catch(() => void 0);
        },
        select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false)
      };
    }
  }, LiangEffortSlider));
}
return module.exports;}});
//# sourceMappingURL=client.js.map
