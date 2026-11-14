# Plugin Distribution Migration Report

Status: source audit baseline for Task 2.1. This report is not a removal authorization.

## Reading This Report

The 33 rows below are the complete non-builtin set from `.sync/plugin-distribution.json`. Current-source evidence comes from `.sync/plugins.json`, `dsh-desktop/assets/SOURCES.json`, and each plugin's `dsh-plugin.json`. A vendored version or repository URL is not proof of an immutable installable release, so it is never promoted to `sourceRef`, `version`, or `integrity` without a verified EAC release artifact.

All 33 entries remain `source-pending`. In particular, an audit result of `byte-identical` does not satisfy the immutable-source, lifecycle, recovery, configuration-migration, or platform-matrix gates. No vendored plugin may be removed on the strength of this report alone.

Patch status values are existing audit conclusions. `same-version-modified`, `cross-version-diff-pending`, `fork-of-upstream`, and `no-upstream` require an EAC-controlled release or a verified upstream absorption conclusion before removal. `byte-identical` means the audited vendored bytes matched that audit baseline only.

## Migration Ledger

| Plugin id | Class | Current source evidence | EAC patch status | Verified target source | Migration state |
| --- | --- | --- | --- | --- | --- |
| `agent-teams` | external | upstream `0.1.13-eac.3`; package repository declared | `same-version-modified` | none; EAC fork release, immutable ref, version and SHA-256 pending | `source-pending` |
| `better-sidebar` | recommended | upstream `0.15.3-eac.2`; package repository declared | `cross-version-diff-pending` | none; EAC package and resolved diff pending | `source-pending` |
| `change-review` | recommended | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `composer-dynamic-island` | recommended | upstream `2.1.0`; package repository declared | `same-version-modified` | none; exact GitHub commit and release SHA-256 pending | `source-pending` |
| `computer-user` | external | upstream `0.3.6`; package repository declared | `same-version-modified` | none; EAC fork or upstream absorption evidence pending | `source-pending` |
| `conversation-tweaks` | recommended | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `dock-settings` | recommended | EAC-original `0.1.0`; no independent upstream proof | `no-upstream` | none; EAC release source pending | `source-pending` |
| `dsh-dafeiyu` | external | upstream `0.1.0-alpha.6`; package repository declared | `same-version-modified` | none; immutable EAC-compatible release pending | `source-pending` |
| `dsh-feature-toggles` | external | EAC-original `0.1.1`; no independent upstream proof | `no-upstream` | retirement pending merge into plugin-manager | `source-pending` |
| `dsh-navbar` | recommended | upstream `0.3.0`; README/registry attribution | `same-version-modified` | none; EAC release pending | `source-pending` |
| `dsh-pet` | external | upstream `0.1.3`; package repository declared | `same-version-modified` | none; immutable EAC-compatible release pending | `source-pending` |
| `dsh-pet-settings` | external | EAC-original `0.1.0`; no independent upstream proof | `no-upstream` | none; EAC release source pending | `source-pending` |
| `dsh-raw-html` | recommended | upstream `0.6.2`; README/registry attribution | `cross-version-diff-pending` | none; EAC-managed release preserving bundle semantics pending | `source-pending` |
| `dsh-session-manager` | recommended | upstream `0.1.0`; README/registry attribution | `same-version-modified` | none; EAC release with host-patch dependency pending | `source-pending` |
| `dsh-stt` | external | upstream `0.3.0`; package repository declared | `byte-identical` | none; immutable ref, archive SHA-256 and removal gates pending | `source-pending` |
| `dsh-undo` | external | upstream `0.3.4`; README/registry attribution | `cross-version-diff-pending` | none; resolved diff and EAC-compatible release pending | `source-pending` |
| `dsh-webui-prompt-optimizer` | external | upstream `0.1.0`; README/registry attribution | `same-version-modified` | none; immutable EAC-compatible release pending | `source-pending` |
| `dsh-whale-widget` | external | upstream `0.2.10`; package repository declared | `byte-identical` | none; immutable ref, archive SHA-256 and removal gates pending | `source-pending` |
| `float-window` | external | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone release pending | `source-pending` |
| `font-custom` | external | EAC-original `0.1.0`; no independent upstream proof | `no-upstream` | none; EAC release source pending | `source-pending` |
| `image-paste` | external | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `meow-smooth` | external | upstream `0.5.0`; package repository declared | `same-version-modified` | none; EAC fork or upstream absorption evidence pending | `source-pending` |
| `message-rewind` | recommended | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `mobile-fix` | recommended | upstream `1.0.1`; package repository declared | `same-version-modified` | none; EAC release or verified upstream absorption pending | `source-pending` |
| `offpeak` | recommended | upstream `9.9.9`; package repository declared | `cross-version-diff-pending` | none; resolved diff and EAC package pending | `source-pending` |
| `openclaw-bridge` | external | upstream `0.7.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `picturereader` | recommended | upstream `3.3.3`; package repository declared | `same-version-modified` | none; release containing EAC settings/image bridge changes pending | `source-pending` |
| `prompt-custom` | recommended | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `settings-groups` | external | upstream `0.1.0`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `side-session` | external | upstream `0.2.8`; no independent upstream proof | `no-upstream` | none; standalone EAC release pending | `source-pending` |
| `soul-md` | recommended | upstream `0.2.8`; package repository declared | `same-version-modified` | none; release containing EAC adaptation pending | `source-pending` |
| `think-zh-expand-eac` | external | upstream `1.0.0`; package repository declared | `fork-of-upstream` | none; immutable EAC fork release pending | `source-pending` |

## Removal Gate

An entry may move to `removal-ready` or `migrated` only after the distribution ledger records all of the following evidence:

1. An immutable npm version plus integrity, or a GitHub 40-character commit plus release archive SHA-256.
2. `patchConclusion` is `not-patched`, `upstream-absorbed`, or `eac-fork-published`.
3. The release artifact contains its package metadata, cordis patch, plugin manifest, license, and runtime entry, and passes offline inspection.
4. Install, start, disable, upgrade, uninstall, and rollback pass in an isolated profile.
5. The artifact introduces no second `@deepseek-ai/*` kernel instance or duplicated module symbols.
6. Installation and recovery entry points are available while `unified-market` and the recovery path remain builtin.
7. Existing user enable/disable configuration migration is verified.
8. Windows, macOS, and Linux support or explicit unavailable behavior is verified.

The machine-readable `removalEvidence` object represents gates 3 through 8. Missing evidence keeps the entry at `source-pending`; the validator rejects incomplete `removal-ready` and `migrated` entries.

## Recommended Pack Draft

`.sync/packs/desktop-recommended.pack.json` is a formatVersion 1 draft. Its `x-eac.intendedPluginIds` exactly names the 14 recommended plugins, while its installable `plugins` array contains only source-ready entries. It is currently empty because the ledger has 0/14 verified source-ready recommended plugins. `x-eac.status` therefore remains `draft`, `conflictsPending` remains true, and publication or insertion into `packs-snapshot.json` is prohibited.
