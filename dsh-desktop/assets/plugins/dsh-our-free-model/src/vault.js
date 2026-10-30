/**
 * Sealed credential store for the co-paid lane.
 *
 * The lane's credential and its endpoint never appear anywhere in the package
 * in readable form. At rest they exist only as an AES-256-GCM seal (`src/vault-data.js`
 * and `src/vault-anchor.js`, both generated); the seal's key is not stored at
 * all — it is derived at unlock time from three masked shards split across those
 * two files, so no single shipped file, and no substring search over the package,
 * reconstructs anything.
 *
 * Derivation alone does not open the seal. Unlock runs only after the host gate
 * accepts the running process as one of the shells this lane is published for:
 * the Tauri shell (its home path, its bundled node, its profile argument), the
 * Electron shell (the kernel's own profile context), or a kernel-declared web
 * profile (`web` / `web-desktop` — issues #58/#59: the lane rides the plugin
 * process, so a web host speaks the same wire as a desktop one). Everywhere
 * else the lane is dark: no request, no listing, no roster entry, and no
 * ciphertext work.
 *
 * The plaintext lives for the length of one request build and is never written,
 * logged, cached, or echoed: callers receive the credential object, hand it to
 * the request builder, and drop it.
 *
 * @module src/vault.js
 */

import crypto from 'node:crypto'
import { LANE_SHARDS, LANE_SEAL } from './vault-data.js'
import { LANE_ANCHOR } from './vault-anchor.js'

const HKDF_DIGEST = 'sha256'
const HKDF_SALT = 'ofm-lane-seal/1\x00co-paid\x00desktop-only'
const HKDF_INFO = 'seal-open/ aes-256-gcm/ per-request'
export const SEAL_AAD = 'ofm-eac-desktop/v1'
export const IV_BYTES = 12
export const TAG_BYTES = 16

/** Pepper folded into every shard mask; the seeds ride with the shards. */
const MASK_PEPPER = 'd21f0a5c7be94f13a68d20e4c9b73f58'

/** The shells this lane is published for. */
export const FLAVOR_AIO = 'aio'
export const FLAVOR_HARNESS = 'harness'
export const FLAVOR_WEB = 'web'

/**
 * Which shell this process is running inside, or null.
 *
 * Tauri (DSHEAC AIO): the kernel is a bundled node.exe under the app's
 * `resources\node\`, launched with the `web-desktop` profile and a DSH_HOME
 * that lives under the app's own Roaming identifier. All three are read off
 * the live process; any one alone is forgeable, the trio is not a coincidence.
 *
 * Electron (DeepSeek Harness): the kernel runs with the app-managed `desktop`
 * profile — a profile name the CLI refuses to launch by design (apps/cli
 * rejects it as "managed exclusively by the Electron application"), provided
 * by the kernel's own profile context. The desktop host also stamps
 * `ELECTRON_RUN_AS_NODE=1` on the kernel process at spawn, but Electron
 * scrubs that variable from process.env during startup — verified on a live
 * install — so it exists on the spawn line only and cannot be a gate
 * criterion; the kernel-provided profile name alone is authoritative.
 *
 * Web hosts (dsh web, the "Deepseek Harness EAC" desktop shell that reports
 * profile `web-desktop`): the kernel-declared profile context is the signal.
 * The lane's client is the plugin process itself, so a web composition speaks
 * the identical wire; what the gate keeps out are processes no DSH kernel is
 * running in — a profile context no kernel would mint.
 *
 * `profileName` comes from the kernel's own profile context service, read
 * opportunistically by the caller; older kernel lines may not provide it,
 * which the Tauri branch does not depend on.
 */
export function detectSealedHost({ env = process.env, execPath = process.execPath, argv = process.argv, profileName } = {}) {
  const home = String(env?.DSH_HOME ?? '').toLowerCase()
  if (home.includes('com.deepseek.dsh.desktop.aio')
    && /resources[\\/]+node[\\/]+node\.exe$/i.test(String(execPath ?? ''))
    && (Array.isArray(argv) ? argv : []).includes('web-desktop')) return FLAVOR_AIO
  if (profileName === 'web' || profileName === 'web-desktop') return FLAVOR_WEB
  if (profileName === 'desktop' || profileName === 'tauri') return FLAVOR_HARNESS
  return null
}

/** Unmask one shard: the mask stream is HKDF over the pepper and the shard's seed. */
function unmaskShard(masked, seedB64) {
  const maskedBytes = Buffer.from(masked, 'base64')
  const seed = Buffer.from(seedB64, 'base64')
  const stream = Buffer.from(crypto.hkdfSync(HKDF_DIGEST, seed, Buffer.from(MASK_PEPPER, 'utf8'), Buffer.from('shard-mask', 'utf8'), maskedBytes.length))
  const out = Buffer.alloc(maskedBytes.length)
  for (let i = 0; i < maskedBytes.length; i += 1) out[i] = maskedBytes[i] ^ stream[i]
  return out
}

/**
 * The three shards as they ship, in derivation order: two from the seal file,
 * one from the anchor file. The minting tool derives with the same order.
 */
function sealedShards() {
  return [...LANE_SHARDS, LANE_ANCHOR]
}

/**
 * Derive the seal key from unmasked shard bytes in their fixed order.
 *
 * Exported for the (out-of-repo) minting tool, which needs the same derivation
 * to build a seal; nothing at runtime needs the key except `openSeal`.
 *
 * @param {Buffer[]} shards - unmasked shard bytes, in order
 * @returns {Buffer} 32-byte AES-256 key
 */
export function deriveSealKey(shards) {
  const ikm = Buffer.concat(shards)
  return Buffer.from(crypto.hkdfSync(HKDF_DIGEST, ikm, Buffer.from(HKDF_SALT, 'utf8'), Buffer.from(HKDF_INFO, 'utf8'), 32))
}

/**
 * Open one seal from unmasked shard bytes and the packed payload.
 *
 * Exported so the offline suite can exercise the failure paths — tampered
 * payload, wrong shard set — against the same code the runtime runs.
 *
 * Every failure path — a shard file swapped, a byte flipped, a truncated
 * payload, a wrong AAD — lands on GCM's authentication check and returns null.
 * The function never throws and never returns a partial credential.
 *
 * Two lane modes ship:
 * - `direct` — the seal carries the relay's credential itself (`{u,k}`);
 * - `worker` — the seal carries a signing gateway's URL and its shared signing
 *   secret (`{u,s}`); the upstream credential lives only behind that gateway
 *   (see worker/README.md), so a seal extracted from this package is an
 *   indirect entry the gateway can revoke, not the credential.
 *
 * @param {Buffer[]} unmasked - shard bytes in derivation order
 * @param {Buffer} packed - iv | ciphertext | tag
 * @returns {{ mode: 'direct', base: string, apiKey: string } | { mode: 'worker', base: string, signingSecret: string } | null}
 */
export function openSealWith(unmasked, packed) {
  try {
    if (unmasked.some(shard => shard.length < 16)) return null
    const key = deriveSealKey(unmasked)
    if (packed.length <= IV_BYTES + TAG_BYTES) return null
    // Seal layout: iv | ciphertext | tag (the mint's concat order).
    const iv = packed.subarray(0, IV_BYTES)
    const tag = packed.subarray(packed.length - TAG_BYTES)
    const ciphertext = packed.subarray(IV_BYTES, packed.length - TAG_BYTES)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(SEAL_AAD, 'utf8'))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const seal = JSON.parse(plaintext.toString('utf8'))
    if (seal?.v !== 1 || seal?.m !== 'eac') return null
    const base = typeof seal.u === 'string' ? seal.u : ''
    const url = new URL(base)
    if (url.protocol !== 'https:' || url.pathname.replace(/\/+$/, '') === '') return null
    const cleanBase = base.replace(/\/+$/, '')
    if (seal.t === 'worker') {
      // The gateway's allowlist serves /v1/models and /v1/chat/completions, so
      // a mounted path that does not end in /v1 could only mismatch it.
      if (!/\/v1$/.test(cleanBase)) return null
      if (typeof seal.s !== 'string' || seal.s.length < 32) return null
      return { mode: 'worker', base: cleanBase, signingSecret: seal.s }
    }
    const apiKey = typeof seal.k === 'string' ? seal.k : ''
    if (!/^[\w-]{20,}$/.test(apiKey)) return null
    return { mode: 'direct', base: cleanBase, apiKey }
  } catch {
    return null
  }
}

/**
 * Open a seal from raw shard rows (`{s, w}`) and its packed payload — the
 * shape the data files carry. This is the door the minting tool verifies
 * through: it re-imports the just-written files and hands them here, so the
 * verdict is about the bytes on disk, not about whatever a module cache kept.
 *
 * @param {Array<{s: string, w: string}>} rows - masked shard rows in derivation order
 * @param {string} sealB64 - the packed seal (iv | ciphertext | tag), base64
 * @returns {{ mode: 'direct', base: string, apiKey: string } | { mode: 'worker', base: string, signingSecret: string } | null}
 */
export function openSealFrom(rows, sealB64) {
  try {
    if (!Array.isArray(rows) || rows.length < 2) return null
    const unmasked = rows.map(row => unmaskShard(row.s, row.w))
    return openSealWith(unmasked, Buffer.from(sealB64, 'base64'))
  } catch {
    return null
  }
}

/**
 * Open the seal assembled from the two data files.
 *
 * @returns {{ mode: 'direct', base: string, apiKey: string } | { mode: 'worker', base: string, signingSecret: string } | null}
 */
export function openSeal() {
  return openSealFrom([...LANE_SHARDS, LANE_ANCHOR], LANE_SEAL)
}

/**
 * Gate, then unlock. The one entry point the rest of the plugin calls.
 *
 * Re-run per request on purpose: it costs a fraction of a millisecond, and it
 * means no decrypted byte outlives the call frame that needed it.
 *
 * @param {{ profileName?: string }} [host] - the kernel profile context's name, when the kernel provides one
 * @returns {{ base: string, apiKey: string, flavor: string } | null}
 */
export function unlockSealedLane(host = {}) {
  const flavor = detectSealedHost({ profileName: host.profileName })
  if (flavor === null) return null
  const opened = openSeal()
  return opened === null ? null : { ...opened, flavor }
}
