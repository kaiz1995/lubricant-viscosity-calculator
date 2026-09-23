import {
  EPS,
  type FractionRange,
  type PendingFractionRange,
  type ReverseBlendInput,
  type ReverseBlendResult,
  type ViscosityModel,
} from './types'
import { assertFraction, assertViscosity, finiteResult, nearlyEqual } from './validation'

/**
 * 反求求解器。
 *
 * 变换域内问题只有两个约束：Σfᵢ = 1 与 Σfᵢ·wᵢ = W。因此
 * - 待求组分 = 2 时存在唯一解；
 * - 待求组分 > 2 时是欠定系统（无穷多组解），这里返回一组规则化参考解，
 *   并给出每个待求组分的可行比例区间。
 */

const WEIGHT_TOLERANCE = 1e-9
/** 两个组分的变换值差异小于该阈值时视为粘度等效（对应粘度差约 1e-4 mm²/s）。 */
const EQUIVALENT_WEIGHT_TOLERANCE = 1e-6

function weightTolerance(...values: number[]): number {
  return WEIGHT_TOLERANCE * Math.max(1, ...values.map((value) => Math.abs(value)))
}

function clampFraction(value: number, limit: number): number {
  if (value < 0) return 0
  if (value > limit) return limit
  return value
}

function withinRange(value: number, limit: number, tolerance: number): boolean {
  return value >= -tolerance && value <= limit + tolerance
}

/** 把越界值夹回 [0, limit]，并把由此产生的差额平摊给仍可调整的分量，保证合计守恒。 */
function normalizeFractions(values: readonly number[], limit: number, tolerance: number): number[] {
  const normalized = values.map((value) => clampFraction(value, limit))
  for (let pass = 0; pass < 4; pass += 1) {
    const deficit = limit - normalized.reduce((total, value) => total + value, 0)
    if (Math.abs(deficit) <= tolerance) break
    const adjustable = normalized.map((value, index) => ({ index, value })).filter(({ value }) => value > 0 && value < limit)
    if (adjustable.length === 0) break
    const share = deficit / adjustable.length
    adjustable.forEach(({ index }) => { normalized[index] = clampFraction(normalized[index] + share, limit) })
  }
  return normalized
}

/** 解 fₐ + f_b = total、wₐ·fₐ + w_b·f_b = weight；粘度等效时返回 null。 */
function solvePair(
  weightA: number,
  weightB: number,
  total: number,
  weight: number,
): [number, number] | null {
  if (Math.abs(weightA - weightB) <= EQUIVALENT_WEIGHT_TOLERANCE) return null
  const fractionA = (weight - weightB * total) / (weightA - weightB)
  return [fractionA, total - fractionA]
}

/**
 * 枚举可行域顶点（选两个组分作基变量，其余取 0），用于多解时的区间统计。
 * 返回的每个顶点只覆盖待求组分，顺序与 pending 一致。
 */
function feasibleVertices(
  pendingWeights: readonly number[],
  total: number,
  weight: number,
  tolerance: number,
): number[][] {
  const count = pendingWeights.length
  const vertices: number[][] = []
  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      const pair = solvePair(pendingWeights[first], pendingWeights[second], total, weight)
      if (!pair) continue
      const [fractionFirst, fractionSecond] = pair
      if (!withinRange(fractionFirst, total, tolerance) || !withinRange(fractionSecond, total, tolerance)) continue
      const vector = new Array<number>(count).fill(0)
      vector[first] = clampFraction(fractionFirst, total)
      vector[second] = clampFraction(fractionSecond, total)
      vertices.push(vector)
    }
  }
  return vertices
}

function summarizeRanges(vertices: readonly number[][], pending: readonly number[]): PendingFractionRange[] {
  return pending.map((index, position) => ({
    index,
    min: Math.min(...vertices.map((vertex) => vertex[position])),
    max: Math.max(...vertices.map((vertex) => vertex[position])),
  }))
}

function vertexClosestToEvenSplit(vertices: readonly number[][], evenShare: number): number[] {
  let best = vertices[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const vertex of vertices) {
    const distance = vertex.reduce((total, fraction) => total + (fraction - evenShare) ** 2, 0)
    if (distance < bestDistance) {
      bestDistance = distance
      best = vertex
    }
  }
  return best
}

function reachableViscosityRange(
  model: ViscosityModel,
  pendingWeights: readonly number[],
  lockedWeight: number,
  remaining: number,
): FractionRange | null {
  if (pendingWeights.length === 0 || remaining <= EPS) return null
  const lowest = lockedWeight + remaining * Math.min(...pendingWeights)
  const highest = lockedWeight + remaining * Math.max(...pendingWeights)
  try {
    return {
      min: model.inverseTransform(lowest),
      max: model.inverseTransform(highest),
    }
  } catch {
    return null
  }
}

export function reverseBlend(model: ViscosityModel, input: ReverseBlendInput): ReverseBlendResult {
  let reachable: FractionRange | null = null
  try {
    const count = input.viscosities.length
    if (count < 2) throw new RangeError('至少需要两个组分才能反求配比。')
    if (input.lockedFractions.length !== count) throw new RangeError('锁定比例数量必须与组分数量一致。')
    input.viscosities.forEach((viscosity, index) => assertViscosity(model, viscosity, `组分${index + 1}运动粘度`))
    assertViscosity(model, input.targetViscosity, '目标运动粘度')
    input.lockedFractions.forEach((value, index) => {
      if (value !== null) assertFraction(value, `组分${index + 1}锁定比例`)
    })

    const transformed = input.viscosities.map((viscosity, index) =>
      finiteResult(model.transformViscosity(viscosity), `组分${index + 1}粘度变换结果`),
    )
    const target = finiteResult(model.transformViscosity(input.targetViscosity), '目标粘度变换结果')

    const lockedSum = input.lockedFractions.reduce<number>((total, value) => total + (value ?? 0), 0)
    const lockedWeight = transformed.reduce((total, weight, index) => total + (input.lockedFractions[index] ?? 0) * weight, 0)
    const pending = transformed.map((_, index) => index).filter((index) => input.lockedFractions[index] === null)
    const pendingWeights = pending.map((index) => transformed[index])
    const remaining = 1 - lockedSum
    const requiredWeight = target - lockedWeight
    const tolerance = weightTolerance(lockedWeight, target, remaining, 1)
    if (lockedSum > 1 + tolerance) throw new RangeError('已锁定比例合计不能超过 100%。')

    const blended = (fractions: readonly number[]): number =>
      finiteResult(
        model.blendViscosity(input.viscosities.map((viscosity, index) => ({ viscosity, fraction: fractions[index] }))),
        '调和粘度结果',
      )

    if (pending.length > 0) {
      reachable = reachableViscosityRange(model, pendingWeights, lockedWeight, remaining)
    }

    const fractions = new Array<number>(count).fill(0)
    input.lockedFractions.forEach((value, index) => {
      fractions[index] = value ?? 0
    })

    // 全部比例已给定：只做一致性校验。
    if (pending.length === 0) {
      if (nearlyEqual(lockedWeight, target, WEIGHT_TOLERANCE)) {
        const blendViscosity = blended(fractions)
        return { status: 'SUCCESS', fractions, blendViscosity, unique: true, note: '全部比例已给定，调和粘度与目标一致。', pendingRanges: null, reachableViscosityRange: null }
      }
      return { status: 'NO_SOLUTION', message: '全部比例已给定，但其调和粘度与目标不符。', pendingRanges: null, reachableViscosityRange: null }
    }

    if (remaining <= tolerance) {
      if (Math.abs(requiredWeight) <= tolerance) {
        const blendViscosity = blended(fractions)
        return { status: 'SUCCESS', fractions, blendViscosity, unique: true, note: '锁定比例已占满 100%，待求组分比例均为 0。', pendingRanges: null, reachableViscosityRange: null }
      }
      return { status: 'NO_SOLUTION', message: '锁定比例已占满 100%，没有余量分配给待求组分。', pendingRanges: null, reachableViscosityRange: reachable }
    }

    const lowestWeight = Math.min(...pendingWeights)
    const highestWeight = Math.max(...pendingWeights)
    const effectiveMeanWeight = requiredWeight / remaining

    if (effectiveMeanWeight < lowestWeight - tolerance || effectiveMeanWeight > highestWeight + tolerance) {
      return {
        status: 'NO_SOLUTION',
        message: '目标粘度超出当前原料的可达范围，请调整原料粘度或降低锁定比例。',
        pendingRanges: null,
        reachableViscosityRange: reachable,
      }
    }

    // 待求组分只有一个：该组分必须独自承担全部余量。
    if (pending.length === 1) {
      const index = pending[0]
      if (!nearlyEqual(pendingWeights[0] * remaining, requiredWeight, WEIGHT_TOLERANCE)) {
        return { status: 'NO_SOLUTION', message: '仅剩一个待求组分，其粘度无法单独匹配目标。', pendingRanges: null, reachableViscosityRange: reachable }
      }
      fractions[index] = remaining
      const blendViscosity = blended(fractions)
      return { status: 'SUCCESS', fractions, blendViscosity, unique: true, note: '只有一个待求组分，其比例由余量直接确定。', pendingRanges: null, reachableViscosityRange: reachable }
    }

    // 待求组分恰好两个：唯一解。
    if (pending.length === 2) {
      const pair = solvePair(pendingWeights[0], pendingWeights[1], remaining, requiredWeight)
      if (!pair) {
        if (!nearlyEqual(pendingWeights[0] * remaining, requiredWeight, WEIGHT_TOLERANCE)) {
          return { status: 'NO_SOLUTION', message: '两个待求组分粘度等效，当前目标无解。', pendingRanges: null, reachableViscosityRange: reachable }
        }
        const evenFractions = [...fractions]
        pending.forEach((position) => { evenFractions[position] = remaining / 2 })
        return {
          status: 'SUCCESS',
          fractions: evenFractions,
          blendViscosity: blended(evenFractions),
          unique: false,
          note: '两个待求组分粘度等效，余量可在两者之间任意分配，此处按均分给出。',
          pendingRanges: pending.map((index) => ({ index, min: 0, max: remaining })),
          reachableViscosityRange: reachable,
        }
      }
      const [fractionFirst, fractionSecond] = normalizeFractions(pair, remaining, tolerance)
      fractions[pending[0]] = fractionFirst
      fractions[pending[1]] = fractionSecond
      const blendViscosity = blended(fractions)
      return { status: 'SUCCESS', fractions, blendViscosity, unique: true, note: '两个待求组分，配比由解析解唯一确定。', pendingRanges: null, reachableViscosityRange: reachable }
    }

    // 待求组分三个及以上：欠定，返回参考解与可行区间。
    const meanWeight = pendingWeights.reduce((total, weight) => total + weight, 0) / pending.length
    const deviations = pendingWeights.map((weight) => weight - meanWeight)
    const deviationSquareSum = deviations.reduce((total, deviation) => total + deviation ** 2, 0)
    const evenShare = remaining / pending.length
    const equivalentShare = Math.max(tolerance, EQUIVALENT_WEIGHT_TOLERANCE * remaining)

    // 全部待求组分粘度等效时，可行域退化为一个点（或整个单纯形）。
    if (deviationSquareSum <= equivalentShare ** 2) {
      if (Math.abs(requiredWeight - meanWeight * remaining) > equivalentShare) {
        return { status: 'NO_SOLUTION', message: '待求组分粘度等效，当前目标无解。', pendingRanges: null, reachableViscosityRange: reachable }
      }
      const evenFractions = [...fractions]
      pending.forEach((index) => { evenFractions[index] = evenShare })
      return {
        status: 'SUCCESS',
        fractions: evenFractions,
        blendViscosity: blended(evenFractions),
        unique: false,
        note: '待求组分粘度等效，余量可在它们之间任意分配，此处按均分给出。',
        pendingRanges: pending.map((index) => ({ index, min: 0, max: remaining })),
        reachableViscosityRange: reachable,
      }
    }

    const vertices = feasibleVertices(pendingWeights, remaining, requiredWeight, tolerance)
    if (vertices.length === 0) {
      return { status: 'NO_SOLUTION', message: '当前原料与锁定比例下不存在可行配比。', pendingRanges: null, reachableViscosityRange: reachable }
    }
    const pendingRanges = summarizeRanges(vertices, pending)

    let candidate: number[] | null = null
    let note = '存在无穷多组解，以下为各待求组分比例尽量均匀的参考解；再锁定其中部分比例即可得到唯一解。'
    const excess = requiredWeight - meanWeight * remaining
    const projected = deviations.map((deviation) => evenShare + deviation * excess / deviationSquareSum)
    if (projected.every((fraction) => withinRange(fraction, remaining, tolerance))) {
      candidate = normalizeFractions(projected, remaining, tolerance)
    }
    if (!candidate) {
      candidate = vertexClosestToEvenSplit(vertices, evenShare)
      note = '存在无穷多组解；均匀分配方向不可行，以下为与均分最接近的可行顶点解（部分原料比例为 0）。'
    }

    pending.forEach((index, position) => {
      fractions[index] = candidate[position]
    })
    const blendViscosity = blended(fractions)
    return { status: 'SUCCESS', fractions, blendViscosity, unique: false, note, pendingRanges, reachableViscosityRange: reachable }
  } catch (error) {
    return {
      status: 'INVALID_INPUT',
      message: error instanceof Error ? error.message : '输入无效。',
      pendingRanges: null,
      reachableViscosityRange: reachable,
    }
  }
}
