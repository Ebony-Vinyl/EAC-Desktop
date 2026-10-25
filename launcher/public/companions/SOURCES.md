# Companion artwork

The launcher uses local, packable companion assets only; runtime code never reads the source QQ/Emoji directory or any remote URL.

## Desk pet (`pet/*.webp`)

- Derived from [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) `assets/pet/` frame sets, which are MIT-licensed.
- Those frames in turn originate from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) (MIT, AI-generated green-screen animations, upstream commit `549fff2`), per the source repository's `ASSET_LICENSE.md`.
- Re-encoded here as 16-column WebP grid sheets at 240px cells, quality 84 (`sheets.json` records per-sheet frame counts). Total ~11MB for 8 clips / 1668 frames instead of the original 60MB+ frame dump.
- Clips used: `idle`, `poke`, `dragging`, `success`, `error`, `thinking`, `idle_yawn`, `eat_token`.

## Settings archivist

- `archivist-pixel.png` / `archivist-pixel-large.png` derive from the user-supplied local fox-eared artwork; `archivist.webp` is the soft fallback. Original authorship and redistribution rights have not been verified; do not publish derived artwork externally without confirming permission.
