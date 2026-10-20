import fs = require('node:fs');
import path = require('node:path');
import {writeJsonAtomic} from '../atomic-json';
export interface EnvironmentBinding {
  schemaVersion: 1; product: 'eac-desktop'; channel: string;
  environmentRoot: string; storageRoot: string; dshHome: string; registryHome: string; profile: string;
}
const CHANNEL = /^[a-z][a-z0-9-]{0,59}$/;
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
}
export function readEnvironmentBinding(productRoot: string, storageRoot?: string): EnvironmentBinding | null {
  const file = path.join(productRoot, 'eac-data-binding.json');
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('update-data-binding-link');
  let binding: EnvironmentBinding;
  try {binding = JSON.parse(fs.readFileSync(file, 'utf8')) as EnvironmentBinding;} catch {throw new Error('update-data-binding-invalid');}
  if (binding.schemaVersion !== 1 || binding.product !== 'eac-desktop' || typeof binding.channel !== 'string'
    || !CHANNEL.test(binding.channel) || binding.channel.endsWith('-')
    || !['environmentRoot', 'storageRoot', 'dshHome', 'registryHome', 'profile'].every(key => typeof binding[key as keyof EnvironmentBinding] === 'string')
    || !path.isAbsolute(binding.environmentRoot) || !path.isAbsolute(binding.storageRoot) || !path.isAbsolute(binding.dshHome) || !path.isAbsolute(binding.registryHome)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(binding.profile)
    || (storageRoot !== undefined && !samePath(binding.storageRoot, storageRoot))
    || !samePath(binding.environmentRoot, path.join(binding.storageRoot, 'dsh-environments', 'eac-' + binding.channel))
    || !samePath(binding.dshHome, path.join(binding.environmentRoot, 'dsh-home'))) throw new Error('update-data-binding-invalid');
  return binding;
}
export function boundEnvironmentChannel(productRoot: string, storageRoot: string): string | null {
  const binding = readEnvironmentBinding(productRoot, storageRoot);
  if (binding) return binding.channel;
  // Bootstrap existing installations from the dpx-owned identity, never from a release label.
  const legacyRoot = path.join(storageRoot, 'dsh-environments', 'eac-beta');
  const legacyManifest = path.join(legacyRoot, '.dpx-environment.json');
  if (fs.existsSync(legacyManifest)) {
    let record: {kind?: string; name?: string; root?: string};
    try {record = JSON.parse(fs.readFileSync(legacyManifest, 'utf8'));} catch {throw new Error('update-legacy-binding-invalid');}
    if (record.kind !== 'DPXEnvironment' || record.name !== 'eac-beta' || typeof record.root !== 'string' || !samePath(record.root, legacyRoot)) throw new Error('update-legacy-binding-invalid');
    return 'beta';
  }
  if (fs.existsSync(legacyRoot)) throw new Error('update-legacy-binding-unidentified');
  return null;
}
export function persistEnvironmentBinding(productRoot: string, binding: EnvironmentBinding): void {
  const existingFile = path.join(productRoot, 'eac-data-binding.json');
  if (fs.existsSync(existingFile) && fs.lstatSync(existingFile).isSymbolicLink()) throw new Error('update-data-binding-link');
  writeJsonAtomic(existingFile, binding);
}
