/**
 * The co-paid lane's per-user GitHub authorization token, as the plugin holds
 * it on disk.
 *
 * This is not part of the seal and deliberately so: the seal carries material
 * every install shares (the gateway endpoint and the signing secret), while
 * this file is what makes one install *this user* to the gateway's gate —
 * GitHub login plus a live star verdict, minted server-side and revocable
 * there. It lives beside the rest of the plugin's state under
 * `DSH_HOME/our-free-model/`, 0600, written through a temp file + rename so a
 * crash mid-write cannot leave a half-token.
 *
 * Nothing here ever reaches a log, an error message, or a catalog entry; the
 * lane's request builder is the only reader, and it drops the value with the
 * call frame.
 *
 * @module src/eac-user.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { resolveDshHome, DATA_DIR_NAME } from './store.js'

export const EAC_USER_FILE = 'eac-user.json'

/** Absolute path of the authorization file. */
export function eacUserPath() {
  return path.join(resolveDshHome(), DATA_DIR_NAME, EAC_USER_FILE)
}

/**
 * Read the stored authorization, or null when this install has none (the
 * normal state before login, and the state after logout).
 *
 * @returns {{token: string, login: string, avatar: string, savedAt: number} | null}
 */
export function readEacUser(file = eacUserPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const token = typeof parsed.token === 'string' ? parsed.token : ''
    if (token === '') return null
    return {
      token,
      login: typeof parsed.login === 'string' ? parsed.login : '',
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : '',
      savedAt: Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
    }
  } catch {
    return null
  }
}

/**
 * Persist a freshly collected authorization. Returns the stored record, or
 * null when the write failed (a read-only home must not break the lane's
 * request path — the caller surfaces the failure where a user can see it).
 *
 * @param {{token: string, login?: string, avatar?: string}} user
 */
export function writeEacUser({ token, login = '', avatar = '' }, file = eacUserPath()) {
  if (typeof token !== 'string' || token === '') return null
  const record = { token, login, avatar, savedAt: Date.now() }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(record, undefined, 2), { mode: 0o600 })
    fs.renameSync(temp, file)
    return record
  } catch {
    return null
  }
}

/** Forget the local authorization. The server-side token is revoked separately. */
export function clearEacUser(file = eacUserPath()) {
  try {
    fs.rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}
