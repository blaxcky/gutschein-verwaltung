const encoder = new TextEncoder()
const decoder = new TextDecoder()
let activeDataKey: CryptoKey | null = null

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

const base64ToBytes = (value: string) => {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array, iterations = 250_000) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function encryptBytes(data: Uint8Array, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) }
}

async function decryptBytes(data: string, iv: string, key: CryptoKey) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(data)))
}

export async function configurePin(pin: string) {
  if (pin.length < 4) throw new Error('Der App-PIN muss mindestens vier Zeichen lang sein.')
  const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const rawDataKey = new Uint8Array(await crypto.subtle.exportKey('raw', dataKey))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const pinKey = await deriveKey(pin, salt)
  const wrapped = await encryptBytes(rawDataKey, pinKey)
  const verifier = await encryptBytes(encoder.encode('gutscheinbox-pin-ok'), pinKey)
  activeDataKey = dataKey
  return {
    keySalt: bytesToBase64(salt),
    wrappedDataKey: wrapped.data,
    wrappedDataKeyIv: wrapped.iv,
    pinVerifier: `${verifier.iv}.${verifier.data}`
  }
}

export async function unlockWithPin(pin: string, values: { keySalt?: string; wrappedDataKey?: string; wrappedDataKeyIv?: string; pinVerifier?: string }) {
  if (!values.keySalt || !values.wrappedDataKey || !values.wrappedDataKeyIv || !values.pinVerifier) throw new Error('PIN-Konfiguration ist unvollständig.')
  try {
    const pinKey = await deriveKey(pin, base64ToBytes(values.keySalt))
    const [verifierIv, verifierData] = values.pinVerifier.split('.')
    const verifier = decoder.decode(await decryptBytes(verifierData, verifierIv, pinKey))
    if (verifier !== 'gutscheinbox-pin-ok') throw new Error()
    const rawKey = await decryptBytes(values.wrappedDataKey, values.wrappedDataKeyIv, pinKey)
    activeDataKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
    return true
  } catch {
    throw new Error('Der PIN ist nicht richtig.')
  }
}

export const isUnlocked = () => activeDataKey !== null
export const lockVault = () => { activeDataKey = null }

export async function encryptText(value: string) {
  if (!activeDataKey || !value) return value
  const encrypted = await encryptBytes(encoder.encode(value), activeDataKey)
  return `enc:v1:${encrypted.iv}:${encrypted.data}`
}

export async function decryptText(value: string) {
  if (!value.startsWith('enc:v1:')) return value
  if (!activeDataKey) throw new Error('Gutscheinbox ist gesperrt.')
  const [, , iv, data] = value.split(':')
  return decoder.decode(await decryptBytes(data, iv, activeDataKey))
}

export async function encryptBlob(blob: Blob) {
  if (!activeDataKey) return blob
  const encrypted = await encryptBytes(new Uint8Array(await blob.arrayBuffer()), activeDataKey)
  return new Blob([JSON.stringify({ v: 1, type: blob.type, ...encrypted })], { type: 'application/x-gutscheinbox-encrypted' })
}

export async function decryptBlob(blob: Blob) {
  if (blob.type !== 'application/x-gutscheinbox-encrypted') return blob
  if (!activeDataKey) throw new Error('Gutscheinbox ist gesperrt.')
  const payload = JSON.parse(await blob.text()) as { type: string; iv: string; data: string }
  return new Blob([await decryptBytes(payload.data, payload.iv, activeDataKey)], { type: payload.type })
}

export async function encryptBackup(payload: Uint8Array, password: string) {
  if (password.length < 8) throw new Error('Das Backup-Passwort muss mindestens acht Zeichen lang sein.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt, 350_000)
  const encrypted = await encryptBytes(payload, key)
  return JSON.stringify({ format: 'gutscheinbox', version: 1, kdf: 'PBKDF2-SHA-256', iterations: 350000, salt: bytesToBase64(salt), iv: encrypted.iv, payload: encrypted.data })
}

export async function decryptBackup(content: string, password: string) {
  try {
    const backup = JSON.parse(content) as { format: string; version: number; iterations: number; salt: string; iv: string; payload: string }
    if (backup.format !== 'gutscheinbox' || backup.version !== 1) throw new Error()
    const key = await deriveKey(password, base64ToBytes(backup.salt), backup.iterations)
    return await decryptBytes(backup.payload, backup.iv, key)
  } catch {
    throw new Error('Passwort falsch oder Backup beschädigt.')
  }
}

export const blobToBase64 = async (blob: Blob) => bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
export const base64ToBlob = (data: string, type: string) => new Blob([base64ToBytes(data)], { type })
