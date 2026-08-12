/**
 * Vite 开发中间件：POST /api/skill/solidify → 写入仓库 data/skills/<skill_id>/
 * 对齐 agent-loop SkillSolidificationService 的落盘结果形态。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

function safeSkillId(raw) {
  const id = String(raw || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(id)) {
    throw new Error('非法 skill_id')
  }
  return id
}

function safeRelPath(raw) {
  const p = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!p || p.includes('..') || path.isAbsolute(p)) {
    throw new Error(`非法文件路径: ${raw}`)
  }
  return p
}

function contentSignature(files) {
  const h = crypto.createHash('sha256')
  for (const f of files) {
    h.update(f.path)
    h.update('\0')
    h.update(f.content || '')
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

async function readJson(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function writeSkillPackage(skillsRoot, body) {
  const skillId = safeSkillId(body.skillId || body.resultMeta?.skillId)
  const filesIn = Array.isArray(body.files) ? body.files : []
  if (!filesIn.length) throw new Error('缺少技能文件内容')

  const files = filesIn.map((f) => ({
    path: safeRelPath(f.path),
    language: f.language || 'text',
    content: typeof f.content === 'string' ? f.content : String(f.content ?? ''),
  }))

  const targetDir = path.join(skillsRoot, skillId)
  const metaPath = path.join(targetDir, 'skill.meta.json')
  const existing = await readJson(metaPath)
  const signature = contentSignature(files)
  const now = new Date().toISOString()

  let action = 'created'
  let createdAt = now
  let updatedAt = now
  let shouldWrite = true

  if (existing) {
    if (existing.content_signature === signature) {
      action = 'unchanged'
      createdAt = existing.created_at || now
      updatedAt = existing.updated_at || createdAt
      shouldWrite = false
    } else {
      action = 'updated'
      createdAt = existing.created_at || now
      updatedAt = now
    }
  }

  const resultMeta = body.resultMeta || {}
  const meta = {
    skill_id: skillId,
    skill_dir: `data/skills/${skillId}`,
    created_at: createdAt,
    updated_at: updatedAt,
    intersection: resultMeta.intersection || '',
    inter_id: '011wwe28ctu00001',
    upstream_intersection_id: '011wwe28fmc00001',
    link_id: '12wwe28fmwwe28ct01',
    time_period_label: resultMeta.timePeriodLabel || '',
    strategy: 'phase_coordination',
    queue_length_m_expert: 270,
    content_signature: signature,
    experience_source: 'plan_accept',
  }

  if (shouldWrite) {
    await fs.mkdir(path.join(targetDir, 'scripts'), { recursive: true })
    for (const file of files) {
      const abs = path.join(targetDir, file.path)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      const content = file.path.endsWith('.json') && file.path === 'skill.meta.json'
        ? `${JSON.stringify(meta, null, 2)}\n`
        : file.content.endsWith('\n')
          ? file.content
          : `${file.content}\n`
      // skill.meta.json 以服务端合成 meta 为准
      if (file.path === 'skill.meta.json') {
        await fs.writeFile(abs, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
      } else {
        await fs.writeFile(abs, content, 'utf8')
      }
    }
    // 确保 meta 存在（即使 files 列表未含 skill.meta.json）
    if (!files.some((f) => f.path === 'skill.meta.json')) {
      await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    }
  }

  return {
    ok: true,
    action,
    skillId,
    skillDir: meta.skill_dir,
    written: shouldWrite,
    files: files.map((f) => f.path),
  }
}

export function skillSolidifyPlugin(repoRoot) {
  const skillsRoot = path.join(repoRoot, 'data', 'skills')

  return {
    name: 'atx-skill-solidify',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || req.url?.split('?')[0] !== '/api/skill/solidify') {
          next()
          return
        }

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            await fs.mkdir(skillsRoot, { recursive: true })
            const result = await writeSkillPackage(skillsRoot, body)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(result))
          } catch (e) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, reason: e?.message || String(e) }))
          }
        })
      })
    },
  }
}
