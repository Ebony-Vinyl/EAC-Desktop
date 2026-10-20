import crypto = require('node:crypto');
import fs = require('node:fs');

// Compatible with minisign's Ed (raw) and ED (BLAKE2b-512 prehashed) signatures.
// The public key is a build-owned trust root, never supplied by an update source.
function signatureText(text: string): string {
  const value = text.trim();
  if (!value.startsWith('untrusted comment:') && !value.includes('\n') && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (decoded.startsWith('untrusted comment:')) return decoded;
  }
  return value;
}
function decodeLine(text: string, length: number): Buffer {
  text = signatureText(text);
  const line = text.trim().split(/\r?\n/).find(v => !v.startsWith('untrusted comment:')) || '';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(line)) throw new Error('invalid-signature-encoding');
  const bytes = Buffer.from(line, 'base64');
  if (bytes.length !== length) throw new Error('invalid-signature-length');
  return bytes;
}
export function signatureAlgorithm(signature: string): 'Ed' | 'ED' {
  const algorithm = decodeLine(signature, 74).subarray(0, 2).toString('ascii');
  if (algorithm !== 'Ed' && algorithm !== 'ED') throw new Error('unsupported-signature-algorithm');
  return algorithm;
}
export function verifyMinisign(message: Buffer, signature: string, publicKey: string, prehashed = false): void {
  const key = decodeLine(publicKey, 42);
  const signed = decodeLine(signature, 74);
  if (key.subarray(0, 2).toString('ascii') !== 'Ed'
    || !crypto.timingSafeEqual(key.subarray(2, 10), signed.subarray(2, 10))) throw new Error('unknown-signing-key');
  const algorithm = signatureAlgorithm(signature);
  if (prehashed && (algorithm !== 'ED' || message.length !== 64)) throw new Error('invalid-prehash');
  const data = algorithm === 'ED' && !prehashed ? crypto.createHash('blake2b512').update(message).digest() : message;
  const publicObject = crypto.createPublicKey({key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10),
  ]), format: 'der', type: 'spki'});
  if (!crypto.verify(null, data, publicObject, signed.subarray(10))) throw new Error('signature-verification-failed');
  const lines = signatureText(signature).split(/\r?\n/);
  const commentIndex = lines.findIndex(line => line.startsWith('trusted comment: '));
  if (commentIndex < 0 || !lines[commentIndex + 1]) throw new Error('missing-trusted-comment-signature');
  const globalSignature = Buffer.from(lines[commentIndex + 1]!, 'base64');
  const comment = Buffer.from(lines[commentIndex]!.slice('trusted comment: '.length));
  if (globalSignature.length !== 64 || !crypto.verify(null,
    Buffer.concat([signed.subarray(10), comment]), publicObject, globalSignature)) throw new Error('trusted-comment-verification-failed');
}
export async function verifyPackage(file: string, expected: {size: number; sha256: string; signature: string}, publicKey: string): Promise<void> {
  const hash = crypto.createHash('sha256');
  const prehash = crypto.createHash('blake2b512');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) {
    const data = Buffer.from(chunk as Buffer); size += data.length; hash.update(data); prehash.update(data);
    if (size > expected.size) throw new Error('package-size-mismatch');
  }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('package-identity-mismatch');
  // Complete packages use prehashed minisign so verification has bounded memory.
  if (signatureAlgorithm(expected.signature) !== 'ED') throw new Error('package-requires-prehashed-signature');
  verifyMinisign(prehash.digest(), expected.signature, publicKey, true);
}
