/** 扫描候选 npm 包，找出含 SKILL.md 的真实技能包。 */
import zlib from 'node:zlib'

async function scanTarball(pkg) {
  try {
    const res = await fetch('https://registry.npmmirror.com/' + encodeURIComponent(pkg), { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { pkg, status: res.status }
    const j = await res.json()
    const latest = j['dist-tags']?.latest
    const ver = j.versions?.[latest]
    if (!ver?.dist?.tarball) return { pkg, status: 'no-tarball' }
    const tar = await (await fetch(ver.dist.tarball)).arrayBuffer()
    const gunzip = zlib.gunzipSync(Buffer.from(tar))
    let off = 0
    const skillMds = []
    const allFiles = []
    while (off + 512 <= gunzip.length) {
      const header = gunzip.subarray(off, off + 512)
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
      if (!name) break
      const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8) || 0
      const type = header.subarray(156, 157).toString('utf8') || '0'
      if (type === '0' || type === '') {
        allFiles.push(name.replace(/^\.\//, ''))
        if (/SKILL\.md$/i.test(name)) skillMds.push(name)
      }
      off += 512 + Math.ceil(size / 512) * 512
    }
    return { pkg, status: 'ok', latest, skillMds, fileCount: allFiles.length }
  } catch (e) {
    return { pkg, status: 'FAIL:' + e.message }
  }
}

const candidates = [
  'claude-skills', '@tloncorp/tlon-skill', 'skills', 'openclaw-skills', '@openclaw/agent-skills',
  '@aarnes/agent-skills', 'claude-code-skills', 'awesome-claude-skills', '@anthropic/claude-skills',
  'agent-skills', 'skill-packs', '@skills-sh/skills', 'superpowers-skills', 'claude-skills-pack',
  '@vercel/agent-skills', 'gemini-claude-code', 'claude-skills-library', '@thedotmack/claude-skills',
  'mcp-skills', 'claude-skill-pack', 'skills-ai', 'agent-skills-library', '@anthropic-ai/claude-skills'
]

for (const p of candidates) {
  const r = await scanTarball(p)
  console.log(JSON.stringify(r))
}
