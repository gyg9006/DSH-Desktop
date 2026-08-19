import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { snapshotCustomizations, readCustomizationManifest, verifyCustomizations } from '../customizations'

describe('customizations snapshot/manifest', () => {
  it('snapshots and restores personalized files without overwriting existing files', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-custom-'))
    fs.mkdirSync(path.join(ws, 'themes', 'custom'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'themes', 'custom', 'theme.css'), 'theme')
    fs.mkdirSync(path.join(ws, 'data', 'session-bg'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'data', 'session-bg', 'bg.txt'), 'bg')
    fs.mkdirSync(path.join(ws, 'skills', 'my-skill'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'skills', 'my-skill', 'SKILL.md'), 'skill')
    fs.mkdirSync(path.join(ws, 'config'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'config', 'shortcuts.json'), '{}')
    const snapshot = snapshotCustomizations(ws, 1700000000000)
    expect(fs.existsSync(path.join(snapshot, 'theme-custom'))).toBe(true)
    expect(readCustomizationManifest(ws)?.entries.length).toBeGreaterThanOrEqual(4)
    fs.rmSync(path.join(ws, 'themes'), { recursive: true, force: true })
    fs.writeFileSync(path.join(ws, 'skills', 'my-skill', 'SKILL.md'), 'modified')
    const checked = verifyCustomizations(ws, snapshot)
    expect(checked.ok).toBe(true)
    expect(fs.readFileSync(path.join(ws, 'themes', 'custom', 'theme.css'), 'utf8')).toBe('theme')
    expect(fs.readFileSync(path.join(ws, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe('skill')
    fs.rmSync(ws, { recursive: true, force: true })
  })
})
