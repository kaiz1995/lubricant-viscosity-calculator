import {
  EPS,
  type CategoryConstraintSpec,
  type CategoryConstraintType,
  type OptimizationComponent,
  type OptimizationDiagnostics,
  type OptimizationInput,
  type OptimizationResult,
  type ReachableViscosityRange,
  type ViscosityModel,
} from './types'
import { CATEGORY_LABELS, normalizeCategory, validateCategoryConstraints } from '../recipe/categories'
import {
  assertFiniteNumber,
  assertFraction,
  assertViscosity,
  finiteResult,
  nearlyEqual,
} from './validation'

const GEOMETRY_EPS = EPS

interface Constraint {
  a: number
  b: number
  c: number
  id: string
  type: CategoryConstraintType
  label: string
}

interface Point {
  x: number
  y: number
}

interface PreparedComponents {
  min: [number, number, number]
  max: [number, number, number]
  transformed: [number, number, number]
  minSum: number
  maxSum: number
}

function scaledTolerance(...values: number[]): number {
  return GEOMETRY_EPS * Math.max(1, ...values.map(Math.abs))
}

function constraintTolerance(constraint: Constraint, point: Point): number {
  return scaledTolerance(
    constraint.a * point.x,
    constraint.b * point.y,
    constraint.c,
  )
}

function satisfies(point: Point, constraints: readonly Constraint[]): boolean {
  return constraints.every(
    (constraint) =>
      constraint.a * point.x + constraint.b * point.y - constraint.c <=
      constraintTolerance(constraint, point),
  )
}

function canonicalizePoint(point: Point, constraints: readonly Constraint[]): Point | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const fractions = [point.x, point.y, 1 - point.x - point.y]
  const tolerance = scaledTolerance(...fractions)
  for (let index = 0; index < fractions.length; index += 1) {
    if (Math.abs(fractions[index]) <= tolerance) fractions[index] = 0
    else if (Math.abs(fractions[index] - 1) <= tolerance) fractions[index] = 1
  }
  if (fractions.some((fraction) => fraction < -tolerance || fraction > 1 + tolerance)) return null
  for (let index = 0; index < fractions.length; index += 1) {
    fractions[index] = Math.max(0, Math.min(1, fractions[index]))
  }

  const correction = 1 - fractions.reduce((sum, fraction) => sum + fraction, 0)
  if (Math.abs(correction) > tolerance) return null
  if (correction > 0) {
    const index = fractions.reduce(
      (best, fraction, current) => (1 - fraction > 1 - fractions[best] ? current : best),
      0,
    )
    fractions[index] += correction
  } else if (correction < 0) {
    const index = fractions.reduce(
      (best, fraction, current) => (fraction > fractions[best] ? current : best),
      0,
    )
    fractions[index] += correction
  }
  if (fractions.some((fraction) => fraction < -tolerance || fraction > 1 + tolerance)) return null

  const normalized = { x: fractions[0], y: fractions[1] }
  return satisfies(normalized, constraints) ? normalized : null
}

function samePoint(left: Point, right: Point): boolean {
  return nearlyEqual(left.x, right.x, GEOMETRY_EPS) && nearlyEqual(left.y, right.y, GEOMETRY_EPS)
}

function enumerateVertices(constraints: readonly Constraint[]): Point[] {
  const points: Point[] = []
  for (let first = 0; first < constraints.length; first += 1) {
    for (let second = first + 1; second < constraints.length; second += 1) {
      const left = constraints[first]
      const right = constraints[second]
      const determinant = left.a * right.b - right.a * left.b
      const coefficientScale = Math.max(
        1,
        Math.abs(left.a),
        Math.abs(left.b),
        Math.abs(right.a),
        Math.abs(right.b),
      )
      // 重合/平行边界不产生唯一交点；其他边界仍会给出退化线段端点。
      if (Math.abs(determinant) <= Number.EPSILON * 100 * coefficientScale ** 2) continue
      const point = canonicalizePoint(
        {
          x: (left.c * right.b - right.c * left.b) / determinant,
          y: (left.a * right.c - right.a * left.c) / determinant,
        },
        constraints,
      )
      if (point && !points.some((existing) => samePoint(existing, point))) points.push(point)
    }
  }
  return points.sort((left, right) => left.x - right.x || left.y - right.y)
}

function ratioConstraints(min: readonly number[], max: readonly number[]): Constraint[] {
  return [
    { a: -1, b: 0, c: -min[0], id: 'component1:min', type: 'COMPONENT_MIN', label: '组分1最低比例 ≥ ' + formatFraction(min[0]) },
    { a: 1, b: 0, c: max[0], id: 'component1:max', type: 'COMPONENT_MAX', label: '组分1最高比例 ≤ ' + formatFraction(max[0]) },
    { a: 0, b: -1, c: -min[1], id: 'component2:min', type: 'COMPONENT_MIN', label: '组分2最低比例 ≥ ' + formatFraction(min[1]) },
    { a: 0, b: 1, c: max[1], id: 'component2:max', type: 'COMPONENT_MAX', label: '组分2最高比例 ≤ ' + formatFraction(max[1]) },
    { a: 1, b: 1, c: 1 - min[2], id: 'component3:min', type: 'COMPONENT_MIN', label: '组分3最低比例 ≥ ' + formatFraction(min[2]) },
    { a: -1, b: -1, c: max[2] - 1, id: 'component3:max', type: 'COMPONENT_MAX', label: '组分3最高比例 ≤ ' + formatFraction(max[2]) },
  ]
}

function formatFraction(value: number): string {
  return Number((value * 100).toFixed(2)) + '%'
}

function formatViscosity(value: number): string {
  return Number(value.toFixed(2)) + ' mm²/s'
}

function categoryHalfPlaneConstraints(
  components: OptimizationInput['components'],
  specs: readonly CategoryConstraintSpec[],
): Constraint[] {
  const constraints: Constraint[] = []
  for (const spec of specs) {
    const category = normalizeCategory(spec.category)
    const members = [0, 1, 2].filter((index) => normalizeCategory(components[index].category) === category)
    const coefficients = [0, 0]
    let constant = 0
    members.forEach((index) => {
      if (index === 0) coefficients[0] += 1
      else if (index === 1) coefficients[1] += 1
      else {
        coefficients[0] -= 1
        coefficients[1] -= 1
        constant += 1
      }
    })
    if (spec.minFraction !== undefined) {
      constraints.push({ a: -coefficients[0], b: -coefficients[1], c: constant - spec.minFraction, id: 'category:' + category + ':min', type: 'CATEGORY_MIN', label: CATEGORY_LABELS[category] + '最低比例 ≥ ' + formatFraction(spec.minFraction) })
    }
    if (spec.maxFraction !== undefined) {
      constraints.push({ a: coefficients[0], b: coefficients[1], c: spec.maxFraction - constant, id: 'category:' + category + ':max', type: 'CATEGORY_MAX', label: CATEGORY_LABELS[category] + '最高比例 ≤ ' + formatFraction(spec.maxFraction) })
    }
  }
  return constraints
}

function pointFractions(point: Point): [number, number, number] {
  const fractions: [number, number, number] = [point.x, point.y, 1 - point.x - point.y]
  for (let index = 0; index < fractions.length; index += 1) {
    if (Math.abs(fractions[index]) <= GEOMETRY_EPS) fractions[index] = 0
    else if (Math.abs(fractions[index] - 1) <= GEOMETRY_EPS) fractions[index] = 1
  }
  return fractions
}

function prepare(
  model: ViscosityModel,
  components: OptimizationInput['components'],
  requirePrices: boolean,
): PreparedComponents {
  if (components.length !== 3) throw new RangeError('优化必须提供三个组分。')
  const min = components.map((component) => component.minFraction ?? 0) as [number, number, number]
  const max = components.map((component) => component.maxFraction ?? 1) as [number, number, number]
  const transformed = components.map((component, index) => {
    assertViscosity(model, component.viscosity, `组分${index + 1}运动粘度`)
    if (requirePrices) {
      assertFiniteNumber(component.pricePerKg, `组分${index + 1}价格`)
      if (component.pricePerKg < 0) throw new RangeError(`组分${index + 1}价格不能小于0。`)
    }
    assertFraction(min[index], `组分${index + 1}最小比例`)
    assertFraction(max[index], `组分${index + 1}最大比例`)
    if (min[index] > max[index]) throw new RangeError(`组分${index + 1}最小比例不能大于最大比例。`)
    return finiteResult(model.transformViscosity(component.viscosity), '粘度变换结果')
  }) as [number, number, number]
  const minSum = min.reduce((sum, value) => sum + value, 0)
  const maxSum = max.reduce((sum, value) => sum + value, 0)
  return { min, max, transformed, minSum, maxSum }
}

function reachableFromPrepared(
  model: ViscosityModel,
  prepared: PreparedComponents,
): ReachableViscosityRange | null {
  if (prepared.minSum > 1 + EPS || prepared.maxSum < 1 - EPS) return null
  const vertices = enumerateVertices(ratioConstraints(prepared.min, prepared.max))
  if (vertices.length === 0) return null
  const transformedValues = vertices.map((point) => {
    const fractions = pointFractions(point)
    return finiteResult(
      fractions.reduce((sum, fraction, index) => sum + fraction * prepared.transformed[index], 0),
      '可达粘度变换结果',
    )
  })
  const minimumReachableViscosity = finiteResult(
    model.inverseTransform(Math.min(...transformedValues)),
    '最小可达粘度',
  )
  const maximumReachableViscosity = finiteResult(
    model.inverseTransform(Math.max(...transformedValues)),
    '最大可达粘度',
  )
  return { minimumReachableViscosity, maximumReachableViscosity }
}

export function reachableViscosityRange(
  model: ViscosityModel,
  components: readonly [OptimizationComponent, OptimizationComponent, OptimizationComponent],
): ReachableViscosityRange | null {
  try {
    // 可达范围只依赖粘度与比例上下限，不依赖价格是否完整。
    return reachableFromPrepared(model, prepare(model, components, false))
  } catch {
    return null
  }
}

export function optimizeBlend(model: ViscosityModel, input: OptimizationInput): OptimizationResult {
  const categoryValidation = validateCategoryConstraints(input.categoryConstraints ?? [], input.components)
  if (!categoryValidation.valid) {
    const minError = categoryValidation.errors.find((error) => error.code === 'CATEGORY_MIN_INFEASIBLE')
    const maxError = categoryValidation.errors.find((error) => error.code === 'CATEGORY_MAX_INFEASIBLE')
    const conflictError = minError ?? maxError
    if (conflictError) {
      return {
        success: false,
        errorCode: minError ? 'CATEGORY_MIN_CONFLICT' : 'CATEGORY_MAX_CONFLICT',
        message: conflictError.message,
        diagnostics: {},
      }
    }
    const totalMinConflict = categoryValidation.errors.find((error) => error.code === 'TOTAL_MIN_CONFLICT')
    if (totalMinConflict) {
      return {
        success: false,
        errorCode: 'CATEGORY_MIN_CONFLICT',
        message: totalMinConflict.message,
        diagnostics: {},
      }
    }
    return {
      success: false,
      errorCode: 'INVALID_INPUT',
      message: categoryValidation.errors[0]?.message ?? '类别约束无效。',
      diagnostics: {},
    }
  }
  let prepared: PreparedComponents
  try {
    assertViscosity(model, input.minViscosity, '目标粘度下限')
    assertViscosity(model, input.maxViscosity, '目标粘度上限')
    if (input.minViscosity > input.maxViscosity) throw new RangeError('目标粘度下限不能大于上限。')
    prepared = prepare(model, input.components, true)
  } catch (error) {
    return {
      success: false,
      errorCode: 'INVALID_INPUT',
      message: error instanceof Error ? error.message : '输入无效。',
      diagnostics: {},
    }
  }

  const diagnostics: OptimizationDiagnostics = {
    minFractionSum: prepared.minSum,
    maxFractionSum: prepared.maxSum,
  }
  if (prepared.minSum > 1 + EPS) {
    return {
      success: false,
      errorCode: 'INFEASIBLE_FRACTION_BOUNDS',
      message: '各组分最小比例之和大于100%。',
      diagnostics,
    }
  }
  if (prepared.maxSum < 1 - EPS) {
    return {
      success: false,
      errorCode: 'INFEASIBLE_FRACTION_BOUNDS',
      message: '各组分最大比例之和小于100%。',
      diagnostics,
    }
  }

  let reachable: ReachableViscosityRange | null
  try {
    reachable = reachableFromPrepared(model, prepared)
  } catch (error) {
    return {
      success: false,
      errorCode: 'INVALID_INPUT',
      message: error instanceof Error ? error.message : '理论可达范围超出可计算范围。',
      diagnostics,
    }
  }
  if (!reachable) {
    return {
      success: false,
      errorCode: 'INFEASIBLE_FRACTION_BOUNDS',
      message: '比例上下限不存在可行组合。',
      diagnostics,
    }
  }
  diagnostics.reachableViscosityRange = reachable
  if (
    input.maxViscosity < reachable.minimumReachableViscosity - scaledTolerance(input.maxViscosity, reachable.minimumReachableViscosity) ||
    input.minViscosity > reachable.maximumReachableViscosity + scaledTolerance(input.minViscosity, reachable.maximumReachableViscosity)
  ) {
    return {
      success: false,
      errorCode: 'TARGET_OUT_OF_REACH',
      message: `当前约束下理论可达KV40为${reachable.minimumReachableViscosity}～${reachable.maximumReachableViscosity} mm²/s。`,
      diagnostics,
    }
  }

  try {
    const [w1, w2, w3] = prepared.transformed
    const lower = finiteResult(model.transformViscosity(input.minViscosity), '目标粘度下限变换结果')
    const upper = finiteResult(model.transformViscosity(input.maxViscosity), '目标粘度上限变换结果')
    const viscosityA = w1 - w3
    const viscosityB = w2 - w3
    const baseConstraints: Constraint[] = [
      ...ratioConstraints(prepared.min, prepared.max),
    ]
    const categorySpecs = input.categoryConstraints ?? []
    const categoryConstraints = categoryHalfPlaneConstraints(input.components, categorySpecs)
    baseConstraints.push(...categoryConstraints)
    if (categorySpecs.length > 0) {
      const categoryCandidates = enumerateVertices(baseConstraints)
      if (categoryCandidates.length === 0) {
        const minOnly = categoryHalfPlaneConstraints(input.components, categorySpecs.filter((spec) => spec.minFraction !== undefined).map((spec) => ({ category: spec.category, minFraction: spec.minFraction })))
        const maxOnly = categoryHalfPlaneConstraints(input.components, categorySpecs.filter((spec) => spec.maxFraction !== undefined).map((spec) => ({ category: spec.category, maxFraction: spec.maxFraction })))
        if (minOnly.length > 0 && enumerateVertices([...ratioConstraints(prepared.min, prepared.max), ...minOnly]).length === 0) {
          return { success: false, errorCode: 'CATEGORY_MIN_CONFLICT', message: '类别最低比例与原料比例约束冲突。', diagnostics }
        }
        if (maxOnly.length > 0 && enumerateVertices([...ratioConstraints(prepared.min, prepared.max), ...maxOnly]).length === 0) {
          return { success: false, errorCode: 'CATEGORY_MAX_CONFLICT', message: '类别最高比例与原料比例约束冲突。', diagnostics }
        }
        return { success: false, errorCode: 'NO_FEASIBLE_SOLUTION', message: '类别约束与原料比例约束冲突。', diagnostics }
      }
    }
    const constraints: Constraint[] = [
      ...baseConstraints,
      { a: viscosityA, b: viscosityB, c: upper - w3, id: 'viscosity:max', type: 'VISCOSITY_MAX', label: 'KV40上限 ≤ ' + formatViscosity(input.maxViscosity) },
      { a: -viscosityA, b: -viscosityB, c: w3 - lower, id: 'viscosity:min', type: 'VISCOSITY_MIN', label: 'KV40下限 ≥ ' + formatViscosity(input.minViscosity) },
    ]
    const candidates = enumerateVertices(constraints)
    if (candidates.length === 0) {
      if (categorySpecs.length > 0) {
        return { success: false, errorCode: 'VISCOSITY_CONSTRAINT_CONFLICT', message: '类别/原料比例与目标粘度冲突。', diagnostics }
      }
      return {
        success: false,
        errorCode: 'NO_FEASIBLE_SOLUTION',
        message: '粘度约束与比例约束冲突。',
        diagnostics,
      }
    }

    let best: Point | null = null
    let bestCost = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const fractions = pointFractions(candidate)
      const cost = fractions.reduce(
        (sum, fraction, index) => sum + fraction * input.components[index].pricePerKg,
        0,
      )
      if (!Number.isFinite(cost)) throw new RangeError('成本结果超出可计算范围。')
      if (cost < bestCost - EPS || best === null) {
        best = candidate
        bestCost = cost
      }
    }
    if (!best || !Number.isFinite(bestCost)) throw new RangeError('优化结果超出可计算范围。')

    const fractions = pointFractions(best)
    const blendViscosity = finiteResult(
      model.blendViscosity(
        input.components.map((component, index) => ({ viscosity: component.viscosity, fraction: fractions[index] })),
      ),
      '调和粘度结果',
    )
    const costPerTon = bestCost * 1000
    if (!Number.isFinite(costPerTon) || !fractions.every(Number.isFinite)) {
      throw new RangeError('优化结果超出可计算范围。')
    }
    const activeConstraints = constraints
      .filter(
        (constraint) =>
          Math.abs(constraint.a * best!.x + constraint.b * best!.y - constraint.c) <=
          constraintTolerance(constraint, best!),
      )
      .map(({ id }) => id)
    diagnostics.activeConstraintDetails = constraints
      .filter(
        (constraint) =>
          Math.abs(constraint.a * best!.x + constraint.b * best!.y - constraint.c) <=
          constraintTolerance(constraint, best!),
      )
      .map(({ id, type, label }) => ({ id, type, label }))

    return {
      success: true,
      fractions,
      blendViscosity,
      costPerKg: bestCost,
      costPerTon,
      activeConstraints,
      candidateCount: candidates.length,
      diagnostics,
    }
  } catch (error) {
    return {
      success: false,
      errorCode: 'NO_FEASIBLE_SOLUTION',
      message: error instanceof Error ? error.message : '优化结果超出可计算范围。',
      diagnostics,
    }
  }
}
