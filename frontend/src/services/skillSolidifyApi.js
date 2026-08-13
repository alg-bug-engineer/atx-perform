/**
 * 调用本地开发接口，将技能包真实写入仓库 data/skills/
 * 对齐 agent-loop POST /agent/skill/solidify 的落盘语义（本项目为 Vite 中间件实现）
 */

export async function solidifySkillToProject(payload) {
  const res = await fetch('/api/skill/solidify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.reason || `落盘失败（HTTP ${res.status}）`)
  }
  return data
}
