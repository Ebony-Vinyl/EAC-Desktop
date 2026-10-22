/**
 * Every numeric threshold and name string the RTK token saver shares.
 *
 * These values mirror the Rust RTK tool's defaults, and the filters reproduce
 * its output byte-for-byte, so the numbers are a compatibility surface rather
 * than a tuning knob: change one and a compacted `git diff` stops matching the
 * shape the model has already been trained on. They live in one module because
 * the autodetector and the filters must agree on them — the detector decides
 * what a blob is from the same window the filter then compacts — and a
 * threshold that drifted between the two would route a blob to a filter that
 * silently refuses it.
 *
 * @module src/token-saver/rtk/constants.js
 */

/**
 * Hard ceiling on a single tool-output blob (10 MiB).
 *
 * Above this a blob is no longer something a tool returned to a model, it is a
 * runaway dump. Running thirteen regexes across it buys nothing and costs
 * latency on the request's critical path, so the blob passes through untouched.
 */
export const RAW_CAP = 10 * 1024 * 1024

/**
 * Blobs below 500 bytes are never compacted.
 *
 * Every filter's output carries marker lines ("... (N lines truncated)") and a
 * per-file summary; on a small blob those markers are longer than what they
 * replace, so compacting would spend context instead of saving it.
 */
export const MIN_COMPRESS_SIZE = 500

/**
 * The autodetector peeks at the first 1024 characters only.
 *
 * A tool's output identifies itself in its header (the `diff --git` line, the
 * `total N` row, the npm summary), and bounding the window keeps detection O(1)
 * per blob instead of O(size) — the whole point of the saver is to be cheaper
 * than the tokens it saves.
 */
export const DETECT_WINDOW = 1024

/** Per-hunk line cap: one 10 000-line hunk must not eat the whole diff budget. */
export const GIT_DIFF_HUNK_MAX_LINES = 100

/** Context lines kept around changes (Rust parity; the JS port keeps the hunk head verbatim). */
export const GIT_DIFF_CONTEXT_KEEP = 3

/** `git log` output line cap; beyond this the history is older than the turn needs. */
export const GIT_LOG_MAX_LINES = 200

/** dedupLog hard cap; a blob this long is a loop, and the marker says so. */
export const DEDUP_LINE_MAX = 2000

/** Per-file match cap for the grep compactor (Rust: matches.iter().take(10)). */
export const GREP_PER_FILE_MAX = 10

/** Per-directory file cap for the find compactor (Rust: files.iter().take(10)). */
export const FIND_PER_DIR_MAX = 10

/** Total directory cap for the find compactor (Rust: dirs.iter().take(20)). */
export const FIND_TOTAL_DIR_MAX = 20

/** Per-section file cap for `git status` (Rust config::limits().status_max_files). */
export const STATUS_MAX_FILES = 10

/** Untracked-file cap for `git status` (Rust config::limits().status_max_untracked). */
export const STATUS_MAX_UNTRACKED = 10

/** Top-N extensions in the `ls` summary line. */
export const LS_EXT_SUMMARY_TOP = 5

/**
 * Directory names `ls` drops before showing a listing.
 *
 * These are build products and dependency trees: a model reading a project
 * listing learns nothing from 40 000 `node_modules` entries, and the one line
 * naming the directory is enough to know it exists. `.env` is deliberately NOT
 * here — it is a dotfile a listing may legitimately need to reveal, and the
 * legacy virtualenv `env` is matched by name, not by glob.
 */
export const LS_NOISE_DIRS = [
  'node_modules', '.git', 'target', '__pycache__',
  '.next', 'dist', 'build', '.cache', '.turbo',
  '.vercel', '.pytest_cache', '.mypy_cache', '.tox',
  '.venv', 'venv',
  'env', // Python legacy virtualenv; .env (dotenv) intentionally excluded
  'coverage', '.nyc_output', '.DS_Store', 'Thumbs.db',
  '.idea', '.vscode', '.vs', '*.egg-info', '.eggs'
]

/** `tree` output cap (the Rust original has none; this one keeps a cap to be safe). */
export const TREE_MAX_LINES = 200

/** Per-directory cap for Cursor's Glob search-list compactor. */
export const SEARCH_LIST_PER_DIR_MAX = 10

/** Total directory cap for Cursor's Glob search-list compactor. */
export const SEARCH_LIST_TOTAL_DIR_MAX = 20

/** Head lines kept by the smart-truncate fallback. */
export const SMART_TRUNCATE_HEAD = 120

/** Tail lines kept by the smart-truncate fallback. */
export const SMART_TRUNCATE_TAIL = 60

/**
 * Smart truncation only engages above 250 lines.
 *
 * Below that the head+tail window plus its marker is not reliably smaller than
 * the blob, and a model reading a 200-line log benefits from all of it.
 */
export const SMART_TRUNCATE_MIN_LINES = 250

/**
 * Fraction of the first 100 lines that must match `N|` before a blob counts as
 * a numbered file dump. 0.7 tolerates a few wrapped or unnumbered lines.
 */
export const READ_NUMBERED_MIN_HIT_RATIO = 0.7

/**
 * Filter name strings.
 *
 * These are the names that appear in `stats.hits[].filter` and in the log line,
 * and the Rust tool prints the same strings, so they are part of the ported
 * contract rather than display text.
 */
export const FILTERS = {
  GIT_DIFF: 'git-diff',
  GIT_STATUS: 'git-status',
  GIT_LOG: 'git-log',
  GREP: 'grep',
  FIND: 'find',
  LS: 'ls',
  TREE: 'tree',
  DEDUP_LOG: 'dedup-log',
  SMART_TRUNCATE: 'smart-truncate',
  READ_NUMBERED: 'read-numbered',
  SEARCH_LIST: 'search-list',
  BUILD_OUTPUT: 'build-output'
}
