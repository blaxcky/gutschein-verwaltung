import { describe, expect, it } from 'vitest'
import { configurePin, decryptBackup, decryptText, encryptBackup, encryptText, lockVault, unlockWithPin } from './crypto'

describe('local encryption', () => {
  it('locks and unlocks sensitive text with the correct PIN', async () => {
    const config = await configurePin('4937')
    const encrypted = await encryptText('4711081500')
    expect(encrypted).not.toContain('4711081500')
    lockVault()
    await expect(decryptText(encrypted)).rejects.toThrow('gesperrt')
    await expect(unlockWithPin('0000', config)).rejects.toThrow('nicht richtig')
    await unlockWithPin('4937', config)
    await expect(decryptText(encrypted)).resolves.toBe('4711081500')
  })
  it('rejects a wrong backup password without returning plaintext', async () => {
    const backup = await encryptBackup(new TextEncoder().encode('backup-content'), 'correct-horse')
    await expect(decryptBackup(backup, 'wrong-password')).rejects.toThrow('beschädigt')
    const restored = await decryptBackup(backup, 'correct-horse')
    expect(new TextDecoder().decode(restored)).toBe('backup-content')
  })
})
