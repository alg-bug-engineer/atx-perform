/**
 * 奥体西路 解放东路 → 经十路（北向南）走廊微观仿真。
 *
 * 车辆跟驰用 Newell 三角基本图：x_i(t) ≤ x_{i-1}(t-τ) - s，配合停止线约束，
 * 排队集结与起动波都由模型自己长出来，不写死排队曲线。
 * 路段上游 3 车道、距经十路 100 m 处在东侧展宽出两条左转道变 5 车道，
 * 上游单条直行车道正是「展宽 100 m 不够用」的真实瓶颈。
 */

const LEFT = 'left'
const THROUGH = 'through'
const RIGHT = 'right'

/** 判定队列连续的最大空档：超过这个间隔就认为队尾到此为止 */
const QUEUE_GAP_M = 26

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 阶段序列 → 每阶段的绿灯窗口（含起讫绝对秒，未取模） */
function stageWindows(stages, start, cycleLen, greenKey) {
  const out = []
  let cursor = start
  for (const s of stages) {
    const total = greenKey === 'green_after_s' ? s.total_after_s : s.total_before_s
    const green = s[greenKey]
    out.push({
      seq: s.stage_seq_no,
      stageNo: s.stage_no,
      role: s.role,
      movements: s.movements || [],
      start: cursor,
      green,
      greenEnd: cursor + green,
      end: cursor + total,
    })
    cursor += total
  }
  return { windows: out, cycleLen }
}

function hasMovement(win, dir8, turn) {
  return win.movements.some((m) => m.dir8 === dir8 && m.turn === turn)
}

/** 把某个流向的绿灯窗口在 [0, span) 上按周期铺开 */
function expandGreen(plan, match, span) {
  const base = plan.windows.filter(match)
  const out = []
  const cycles = Math.ceil(span / plan.cycleLen) + 2
  for (let c = -1; c < cycles; c += 1) {
    for (const w of base) {
      const s = w.start + c * plan.cycleLen
      const e = w.greenEnd + c * plan.cycleLen
      if (e < 0 || s > span) continue
      out.push({ start: s, end: e, seq: w.seq, role: w.role })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

function inWindows(windows, t) {
  for (const w of windows) {
    if (t >= w.start && t < w.end) return w
  }
  return null
}

function nextWindow(windows, t) {
  for (const w of windows) if (w.start >= t) return w
  return null
}

/** 当前灯色 + 倒计时：绿灯读到绿灯结束，红灯读到下一次绿灯亮起 */
export function signalState(windows, t) {
  const now = inWindows(windows, t)
  if (now) return { green: true, countdown: Math.max(0, Math.ceil(now.end - t)), role: now.role }
  const next = nextWindow(windows, t)
  return {
    green: false,
    countdown: next ? Math.max(0, Math.ceil(next.start - t)) : 0,
    role: next ? next.role : '',
  }
}

/**
 * 按绿灯窗口铺开一批到达时刻，带随机抖动。
 * 单个绿灯能放出的车受「绿时 × 进口车道数 ÷ 饱和车头时距」限制；
 * 放不完的需求不丢弃，压在解放东进口等下一个绿灯，所以给上游截绿会真的减少汇入。
 */
function spawnTimes(windows, perCycle, span, cycleLen, rnd, lanes, headway, capFactor) {
  const out = []
  let backlog = 0
  for (const w of windows) {
    if (w.end <= 0 || w.start > span) continue
    const dur = w.end - w.start
    if (dur <= 0) continue
    const cap = Math.round(Math.floor(dur / headway) * (lanes || 1) * capFactor)
    const want = perCycle + backlog
    const n = Math.min(want, cap)
    backlog = want - n
    if (n <= 0) continue
    const gap = dur / n
    for (let k = 0; k < n; k += 1) {
      // 车头时距在均值上下 ±55% 抖动，形成疏密不均的真实车队
      const jitter = (rnd() - 0.5) * 1.1 * gap
      const t = w.start + gap * (k + 0.5) + jitter
      if (t >= 0 && t < span) out.push(t)
    }
  }
  return out
}

/** 红灯期间的零散到达（如右转红灯可放行） */
function trickleTimes(perCycle, span, cycleLen, rnd) {
  const out = []
  const total = Math.round((perCycle * span) / cycleLen)
  for (let k = 0; k < total; k += 1) out.push(rnd() * span)
  return out
}

function pickTurn(split, r) {
  if (r < split.left) return LEFT
  if (r < split.left + split.through) return THROUGH
  return RIGHT
}

const DOWN_LANES_OF = { [LEFT]: [0, 1], [THROUGH]: [2, 3], [RIGHT]: [4] }
const TURN_IDX = { [LEFT]: 0, [THROUGH]: 1, [RIGHT]: 2 }

/**
 * 上游 3 条车道（东→西：左转集结道、直行主车道、公交道兼右转）没有分向标线，
 * 三股车流都可以占任意一条，只是按目的地各有偏好；真正分车道是在展宽段完成的。
 * 这正是「展宽只有 100 m」的病灶：车要在 100 m 内换到对的车道，换不过去就卡在原地堵住后车。
 */
const UP_LANE_PREF = {
  [LEFT]: [0.7, 0.95, 1],
  [THROUGH]: [0.25, 0.78, 1],
  [RIGHT]: [0.06, 0.3, 1],
}
function pickUpLane(turn, r) {
  const pref = UP_LANE_PREF[turn]
  if (r < pref[0]) return 0
  if (r < pref[1]) return 1
  return 2
}

/**
 * 跑一个方案（现状 / 优化后）的完整仿真。
 * @returns 逐步的车辆位置、排队长度与溢出标记
 */
export function runCorridorSim(cfg, variantKey) {
  const {
    cycleLen,
    stepSec: DT,
    warmupCycles,
    seed,
    lengthM: L,
    widenLenM,
    taperLenM,
    vehicle,
    turnSplit,
    sources,
    jingshiPlan,
    jiefangPlan,
    displayStartS,
    inflowFactor,
  } = cfg

  const LANE_MIX = vehicle.left_lane_through_mix ?? 0.15
  const ENTER_V = vehicle.enter_speed_mps ?? 7.5
  // 停止线饱和车头时距：一条车道每绿灯秒能放多少车，独立于跟驰参数，便于按实测饱和流率标定
  const H_SAT = vehicle.saturation_headway_sec ?? 2.2
  // 上游解放东路口的放行车头时距：那边进口道正常，不受本路段展宽不足的影响
  const H_SRC = vehicle.source_headway_sec ?? H_SAT
  // 现场标定系数：库内检测流量只反映已放行量，晚高峰真实汇入高于此值，按观测排队剖面反标定
  const INFLOW_FACTOR = inflowFactor ?? 1
  const SPACE = vehicle.space_m
  const V_FREE = vehicle.free_speed_mps
  const ACCEL = vehicle.accel_mps2
  const STOPPED_V = vehicle.stopped_speed_mps
  const LAG = Math.max(1, Math.round(vehicle.reaction_sec / DT))

  const totalCycles = warmupCycles + 2
  const span = cycleLen * totalCycles
  const steps = Math.round(span / DT) + 1

  // 展宽段起点（沿行驶方向的里程）：taper 前是 3 车道，taper 后是 5 车道
  const taperStart = L - widenLenM - taperLenM
  const taperEnd = L - widenLenM

  const QUEUE_SPEED = V_FREE * 0.45
  const SLOW_STEPS = Math.round(3 / DT)

  /**
   * 某股流向排 n 辆车有多长：展宽段 100 m 内该流向有 2 条（右转 1 条）专用道，
   * 排出展宽段后只剩上游 1 条车道，于是每多一辆车队尾就多退 7 m —— 这就是
   * 「展宽只有 100 m」为什么一旦排过 100 m 就迅速失控。
   */
  const GROUP_DOWN_LANES = [2, 2, 1]
  function groupQueueM(g, n) {
    if (n <= 0) return 0
    const lanes = GROUP_DOWN_LANES[g]
    const cap = (widenLenM / SPACE) * lanes
    if (n <= cap) return (n * SPACE) / lanes
    return Math.min(L, widenLenM + (n - cap) * SPACE)
  }

  const downThroughGreen = expandGreen(jingshiPlan, (w) => hasMovement(w, 0, 2), span)
  const downLeftGreen = expandGreen(jingshiPlan, (w) => hasMovement(w, 0, 1), span)
  // 右转借道 + 公交道：红灯可右转，视为常放
  const downRightGreen = [{ start: -cycleLen, end: span + cycleLen, seq: 0, role: '右转常放' }]

  // 通行用的窗口要扣起动损失与清空损失，显示用的窗口保持信号机原始绿时
  const loss = vehicle.startup_loss_sec ?? 2.5
  const effective = (ws) => ws.map((w) => ({ ...w, start: w.start + loss, end: Math.max(w.start + loss, w.end - 1) }))
  const laneGreen = [
    effective(downLeftGreen),
    effective(downLeftGreen),
    effective(downThroughGreen),
    effective(downThroughGreen),
    downRightGreen,
  ]

  const rnd = mulberry32(seed + (variantKey === 'after' ? 977 : 0))

  // ---- 生成到达序列 ----
  const arrivals = []
  for (const src of sources) {
    let windows
    if (src.dir8 !== undefined) {
      windows = expandGreen(jiefangPlan, (w) => hasMovement(w, src.dir8, src.turn), span)
    } else {
      windows = expandGreen(
        jiefangPlan,
        (w) => hasMovement(w, src.concurrent_dir8, src.concurrent_turn),
        span,
      )
    }
    const times = spawnTimes(windows, src.veh_per_cycle, span, cycleLen, rnd, src.lanes, H_SRC, INFLOW_FACTOR)
    for (const t of times) {
      arrivals.push({ t, source: src.key })
    }
    if (src.red_per_cycle) {
      for (const t of trickleTimes(src.red_per_cycle, span, cycleLen, rnd)) {
        arrivals.push({ t, source: src.key, trickle: true })
      }
    }
  }
  arrivals.sort((a, b) => a.t - b.t)

  // ---- 车辆与车道链 ----
  const vehicles = []
  const upTail = [null, null, null] // 各上游车道最后一辆
  const downTail = [null, null, null, null, null]
  const lastCross = [-99, -99, -99, -99, -99] // 各展宽车道最近一次有车越过停止线的时刻
  const pending = [[], [], []] // 进不来、堵在解放东路口里的车

  function xAt(v, step) {
    if (!v) return Infinity
    if (v.done && step >= v.tEnd) return Infinity // 已驶离路口，不再约束后车
    if (step < v.t0) return 0 // 前车还没放进路段，后车只能等在路口出口
    const i = step - v.t0
    if (i >= v.xs.length) return Infinity
    const x = v.xs[i]
    return Number.isNaN(x) ? v.x : x // 本步尚未写入时取最新位置
  }

  const BIN_M = 14
  const binCount = Math.ceil(L / BIN_M)
  const bins = new Int16Array(binCount)

  const queueM = new Float32Array(steps)
  const tailM = new Float32Array(steps)
  const worstGroup = new Uint8Array(steps)
  const spillQueue = new Float32Array(steps)
  const spill = new Uint8Array(steps)
  const throughput = new Float32Array(steps)

  let arrivalIdx = 0
  let idSeq = 0

  for (let step = 0; step < steps; step += 1) {
    const t = step * DT

    // 到达：先进等待区，再看路口出口有没有空间放进路段
    while (arrivalIdx < arrivals.length && arrivals[arrivalIdx].t <= t) {
      const a = arrivals[arrivalIdx]
      const turn = pickTurn(turnSplit, rnd())
      pending[pickUpLane(turn, rnd(), LANE_MIX)].push({ turn, source: a.source })
      arrivalIdx += 1
    }
    let blocked = 0
    for (let lane = 0; lane < 3; lane += 1) {
      const q = pending[lane]
      while (q.length) {
        const tail = upTail[lane]
        const gap = tail ? xAt(tail, step) : Infinity
        if (gap < SPACE) break
        const head = q.shift()
        const v = {
          id: idSeq += 1,
          turn: head.turn,
          source: head.source,
          upLane: lane,
          downLane: -1,
          t0: step,
          xs: new Float32Array(steps - step).fill(NaN),
          // 车是带速穿过解放东路口进来的，不是原地起步
          vel: ENTER_V,
          x: 0,
          leaderUp: tail,
          leaderDown: null,
          passed: false,
          slow: 0,
          done: false,
          tEnd: -1,
        }
        v.xs[0] = 0
        vehicles.push(v)
        upTail[lane] = v
      }
      blocked += q.length
    }
    spillQueue[step] = blocked * SPACE

    // 车辆推进
    let queued = 0
    let crossed = 0
    const groupCount = [0, 0, 0]
    const stoppedX = []
    for (const v of vehicles) {
      if (v.done || v.t0 === step) continue
      const i = step - v.t0
      if (i >= v.xs.length) continue

      let cap = Infinity
      if (v.leaderUp && v.x < taperEnd) {
        cap = Math.min(cap, xAt(v.leaderUp, step - LAG) - SPACE)
      }
      if (v.leaderDown) {
        cap = Math.min(cap, xAt(v.leaderDown, step - LAG) - SPACE)
      }
      // 停在停止线上时 x 恰好等于 L，要用 passed 标记而不是比大小，否则会闯红灯
      const lane = v.downLane >= 0 ? v.downLane : DOWN_LANES_OF[v.turn][0]
      if (!v.passed) {
        const green = inWindows(laneGreen[lane], t)
        // 右转常放，但南北直行相位之外要让行冲突流，放行车头时距按让行系数放大
        const h =
          lane === 4 && !inWindows(laneGreen[2], t) ? H_SAT * (vehicle.right_yield_factor ?? 2.2) : H_SAT
        // 红灯拦停；绿灯下每条车道按饱和车头时距逐车放行，保证放行能力可按实测流率标定
        if (!green || t - lastCross[lane] < h) cap = Math.min(cap, L)
      }

      const vMax = Math.min(V_FREE, v.vel + ACCEL * DT)
      let nx = v.x + vMax * DT
      if (nx > cap) nx = Math.max(v.x, cap)
      v.vel = (nx - v.x) / DT
      if (!v.passed && nx > L) {
        v.passed = true
        lastCross[lane] = t
        crossed += 1
      }
      v.x = nx
      v.xs[i] = nx

      // 进入展宽段时占位：挑同向可用车道里队尾最靠前的那条
      if (v.downLane < 0 && nx >= taperStart) {
        const opts = DOWN_LANES_OF[v.turn]
        let best = opts[0]
        let bestX = -Infinity
        for (const o of opts) {
          const tail = downTail[o]
          const tx = tail ? xAt(tail, step) : Infinity
          if (tx > bestX) {
            bestX = tx
            best = o
          }
        }
        v.downLane = best
        v.leaderDown = downTail[best]
        downTail[best] = v
      }

      if (nx > L + 70) {
        v.done = true
        v.tEnd = step
        if (upTail[v.upLane] === v) upTail[v.upLane] = null
        if (v.downLane >= 0 && downTail[v.downLane] === v) downTail[v.downLane] = null
        continue
      }
      // 受阻车：未过停止线且持续低速 3 s 以上。到达成串带来的瞬时减速不算排队，
      // 否则路段入口总会有零星刚进来的车把队尾拉到最上游。
      v.slow = v.vel < QUEUE_SPEED ? v.slow + 1 : 0
      if (!v.passed && v.slow >= SLOW_STEPS) {
        queued += 1
        groupCount[TURN_IDX[v.turn]] += 1
        stoppedX.push(v.x)
      }
    }

    // 排队长度取排得最长的那股流向：每股流向在展宽段有自己的专用道，退出展宽段后
    // 只剩一条上游车道，所以同样多的车，排过 100 m 之后队尾退得快得多。
    let worst = 0
    for (let g = 1; g < 3; g += 1) {
      if (groupCount[g] > groupCount[worst]) worst = g
    }
    const q = groupQueueM(worst, groupCount[worst])
    queueM[step] = q
    worstGroup[step] = worst
    // 整段被占用的长度：最靠后一辆受阻车的位置，用来判断还有没有蓄车空间
    if (stoppedX.length) {
      stoppedX.sort((a, b) => a - b)
      tailM[step] = L - stoppedX[Math.min(1, stoppedX.length - 1)]
    }
    throughput[step] = crossed
    // 溢出：队尾压回到解放东路口出口，且真的有车进不来（只是到达成串不算溢出）
    spill[step] = blocked >= 3 && q >= L - 45 ? 1 : 0
  }

  // 队尾会随个别车起步跳变，做 4 s 滑动平均后再给曲线用
  const half = Math.round(2 / DT)
  const smoothed = (arr) => {
    const out = new Float32Array(steps)
    for (let s = 0; s < steps; s += 1) {
      let sum = 0
      let n = 0
      for (let k = -half; k <= half; k += 1) {
        const j = s + k
        if (j < 0 || j >= steps) continue
        sum += arr[j]
        n += 1
      }
      out[s] = sum / n
    }
    return out
  }
  queueM.set(smoothed(queueM))
  tailM.set(smoothed(tailM))

  // ---- 只保留展示周期，位置压成定长轨迹 ----
  const showStart = Math.round((warmupCycles * cycleLen + displayStartS) / DT)
  const showSteps = Math.round(cycleLen / DT) + 1
  const tracks = []
  for (const v of vehicles) {
    const from = Math.max(v.t0, showStart)
    const to = Math.min(v.tEnd < 0 ? v.t0 + v.xs.length - 1 : v.tEnd, showStart + showSteps - 1)
    if (to < from) continue
    const n = to - from + 1
    const xs = new Float32Array(n)
    for (let k = 0; k < n; k += 1) xs[k] = v.xs[from - v.t0 + k]
    if (Number.isNaN(xs[0])) continue
    tracks.push({
      id: v.id,
      turn: v.turn,
      source: v.source,
      upLane: v.upLane,
      downLane: v.downLane,
      from: from - showStart,
      to: to - showStart,
      xs,
    })
  }

  const slice = (arr) => arr.slice(showStart, showStart + showSteps)
  const q = slice(queueM)
  return {
    dt: DT,
    steps: showSteps,
    cycleLen,
    lengthM: L,
    taperStart,
    taperEnd,
    tracks,
    queueM: q,
    occupiedM: slice(tailM),
    worstGroup: slice(worstGroup),
    spillQueueM: slice(spillQueue),
    spill: slice(spill),
    peakM: q.reduce((m, x) => Math.max(m, x), 0),
    endM: q[q.length - 1],
    absStartS: warmupCycles * cycleLen + displayStartS,
    greens: {
      through: downThroughGreen,
      left: downLeftGreen,
      jiefang: sources.map((src) => ({
        key: src.key,
        label: src.label,
        windows:
          src.dir8 !== undefined
            ? expandGreen(jiefangPlan, (w) => hasMovement(w, src.dir8, src.turn), span)
            : expandGreen(
                jiefangPlan,
                (w) => hasMovement(w, src.concurrent_dir8, src.concurrent_turn),
                span,
              ),
      })),
    },
  }
}

export { stageWindows, expandGreen, hasMovement, inWindows }
