import {
  EPS,
  type FractionRange,
  type ReverseBlendInput,
  type ReverseBlendResult,
  type ViscosityModel,
} from './types'
import { assertFraction, assertViscosity, finiteResult, nearlyEqual } from './validation'

function affineTolerance(left: number, right: number): number {
  return EPS * Math.max(1, Math.abs(left), Math.abs(right))
}

function intersectAffineInequality(
  range: FractionRange,
  coefficient: number,
  right: number,
): FractionRange | null {
  if (![range.min, range.max, coefficient, right].every(Number.isFinite)) return null
  const tolerance = affineTolerance(coefficient, right)
  if (Math.abs(coefficient) <= EPS) {
    return right >= -tolerance ? range : null
  }

  const bound = right / coefficient
  if (!Number.isFinite(bound)) return null
  if (coefficient > 0) range.max = Math.min(range.max, bound)
  else range.min = Math.max(range.min, bound)
  return range.min <= range.max + tolerance ? range : null
}

function lockedFractionRange(
  wLocked: number,
  wA: number,
  wB: number,
  target: number,
): FractionRange | null {
  const low = Math.min(wA, wB)
  const high = Math.max(wA, wB)
  const range: FractionRange = { min: 0, max: 1 }

  // target >= low + (wLocked - low) * f
  if (!intersectAffineInequality(range, wLocked - low, target - low)) return null
  // target <= high + (wLocked - high) * f
  if (!intersectAffineInequality(range, high - wLocked, high - target)) return null

  range.min = Math.max(0, Math.min(1, range.min))
  range.max = Math.max(0, Math.min(1, range.max))
  const tolerance = affineTolerance(range.min, range.max)
  return range.min <= range.max + tolerance ? range : null
}

export function reverseBlend(
  model: ViscosityModel,
  input: ReverseBlendInput,
): ReverseBlendResult {
  try {
    if (input.viscosities.length !== 3) throw new RangeError('必须提供三个组分粘度。')
    if (![0, 1, 2].includes(input.lockedIndex)) throw new RangeError('固定组分索引无效。')
    input.viscosities.forEach((viscosity, index) =>
      assertViscosity(model, viscosity, `组分${index + 1}运动粘度`),
    )
    assertViscosity(model, input.targetViscosity, '目标运动粘度')
    assertFraction(input.lockedFraction, '固定组分比例')

    const transformed = input.viscosities.map((viscosity) =>
      finiteResult(model.transformViscosity(viscosity), '粘度变换结果'),
    )
    const target = finiteResult(model.transformViscosity(input.targetViscosity), '目标粘度变换结果')
    const otherIndices = ([0, 1, 2] as const).filter((index) => index !== input.lockedIndex)
    const [aIndex, bIndex] = otherIndices
    const wLocked = transformed[input.lockedIndex]
    const wA = transformed[aIndex]
    const wB = transformed[bIndex]
    const feasibleLockedFractionRange = lockedFractionRange(wLocked, wA, wB, target)
    const remaining = 1 - input.lockedFraction
    const required = target - wLocked * input.lockedFraction

    if (remaining <= EPS) {
      if (!nearlyEqual(target, wLocked)) {
        return {
          status: 'NO_SOLUTION',
          message: '固定组分占100%时无法达到目标粘度。',
          feasibleLockedFractionRange,
        }
      }
      const fractions: [number, number, number] = [0, 0, 0]
      fractions[input.lockedIndex] = 1
      const blendViscosity = finiteResult(
        model.blendViscosity(
          input.viscosities.map((viscosity, index) => ({ viscosity, fraction: fractions[index] })),
        ),
        '调和粘度结果',
      )
      return {
        status: 'SUCCESS',
        fractions,
        blendViscosity,
        feasibleLockedFractionRange,
      }
    }

    if (nearlyEqual(wA, wB)) {
      return nearlyEqual(required, wA * remaining)
        ? {
            status: 'INFINITE_SOLUTIONS',
            message: '两个待求组分粘度等效，存在无穷多组比例解。',
            feasibleLockedFractionRange,
          }
        : {
            status: 'NO_SOLUTION',
            message: '两个待求组分粘度等效，当前目标无解。',
            feasibleLockedFractionRange,
          }
    }

    let fractionA = (required - wB * remaining) / (wA - wB)
    const rawFractionB = remaining - fractionA
    if (
      !Number.isFinite(fractionA) ||
      !Number.isFinite(rawFractionB) ||
      fractionA < -EPS ||
      rawFractionB < -EPS ||
      fractionA > remaining + EPS ||
      rawFractionB > remaining + EPS
    ) {
      return {
        status: 'NO_SOLUTION',
        message: '当前固定比例无法达到目标粘度。',
        feasibleLockedFractionRange,
      }
    }
    fractionA = Math.max(0, Math.min(remaining, fractionA))
    const fractionB = remaining - fractionA
    const fractions: [number, number, number] = [0, 0, 0]
    fractions[input.lockedIndex] = input.lockedFraction
    fractions[aIndex] = fractionA
    fractions[bIndex] = fractionB
    const blend = finiteResult(
      model.blendViscosity(
        input.viscosities.map((viscosity, index) => ({ viscosity, fraction: fractions[index] })),
      ),
      '调和粘度结果',
    )
    return {
      status: 'SUCCESS',
      fractions,
      blendViscosity: blend,
      feasibleLockedFractionRange,
    }
  } catch (error) {
    return {
      status: 'INVALID_INPUT',
      message: error instanceof Error ? error.message : '输入无效。',
      feasibleLockedFractionRange: null,
    }
  }
}
