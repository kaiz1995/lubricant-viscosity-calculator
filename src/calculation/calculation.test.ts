import { describe, expect, it } from 'vitest'
import {
  SimplifiedWaltherModel,
  blendViscosity,
  calculateCost,
  classifyIsoVG,
  ISO_VG_GRADE_TABLE,
  optimizeBlend,
  reachableViscosityRange,
  reverseBlend,
  type OptimizationResult,
} from './index'

const model = new SimplifiedWaltherModel()
const close = (actual: number, expected: number, digits = 8) => expect(actual).toBeCloseTo(expected, digits)

function expectFiniteTree(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true)
  } else if (Array.isArray(value)) {
    value.forEach(expectFiniteTree)
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(expectFiniteTree)
  }
}

function blendOf(viscosities: [number, number, number], fractions: [number, number, number]): number {
  return blendViscosity(
    model,
    viscosities.map((viscosity, index) => ({ viscosity, fraction: fractions[index] })),
  )
}

describe('SimplifiedWaltherModel', () => {
  it('uses a finite log1p transform at the lower representable domain point', () => {
    const viscosity = 0.20000000000000004
    const transformed = model.transformViscosity(viscosity)
    expect(Number.isFinite(transformed)).toBe(true)
    close(model.inverseTransform(transformed), viscosity, 12)
    expect(() => model.transformViscosity(0.2)).toThrow('大于0.2')
  })

  it('round-trips ordinary viscosities and blends in transformed space', () => {
    close(model.inverseTransform(model.transformViscosity(46)), 46, 12)
    const result = blendOf([10, 50, 100], [0.2, 0.3, 0.5])
    expect(result).toBeGreaterThan(10)
    expect(result).toBeLessThan(100)
    expect(() => blendViscosity(model, [{ viscosity: 10, fraction: 0.5 }])).toThrow('之和')
    expect(() => blendViscosity(model, [{ viscosity: 0.1, fraction: 1 }])).toThrow('大于0.2')
  })

  it('keeps a single component and equal-viscosity blends unchanged', () => {
    close(blendOf([46, 80, 120], [1, 0, 0]), 46, 12)
    close(blendOf([46, 46, 46], [0.1, 0.2, 0.7]), 46, 12)
  })
})

describe('calculateCost', () => {
  it('calculates complete and per-ton costs without display rounding', () => {
    const result = calculateCost([
      { viscosity: 10, fraction: 0.2, pricePerKg: 2 },
      { viscosity: 50, fraction: 0.8, pricePerKg: 4 },
    ])
    expect(result.status).toBe('COMPLETE')
    if (result.status === 'COMPLETE') {
      close(result.costPerKg, 3.6, 12)
      close(result.costPerTon, 3600, 12)
    }
  })

  it('does not treat a missing price as zero', () => {
    expect(
      calculateCost([
        { viscosity: 10, fraction: 0.2, pricePerKg: null },
        { viscosity: 50, fraction: 0.8, pricePerKg: 4 },
      ]),
    ).toEqual({ status: 'INCOMPLETE_PRICE_DATA', costPerKg: null, costPerTon: null })
    expect(() =>
      calculateCost([
        { viscosity: 10, fraction: 0.2, pricePerKg: -1 },
        { viscosity: 50, fraction: 0.8, pricePerKg: 4 },
      ]),
    ).toThrow('不能小于0')
  })
})

describe('reverseBlend', () => {
  const viscosities: [number, number, number] = [10, 50, 100]
  const fractions: [number, number, number] = [0.2, 0.3, 0.5]
  const target = blendOf(viscosities, fractions)

  it('closes the forward/reverse loop for each locked index', () => {
    for (const lockedIndex of [0, 1, 2] as const) {
      const result = reverseBlend(model, {
        viscosities,
        targetViscosity: target,
        lockedIndex,
        lockedFraction: fractions[lockedIndex],
      })
      expect(result.status).toBe('SUCCESS')
      if (result.status === 'SUCCESS') {
        result.fractions.forEach((fraction, index) => close(fraction, fractions[index], 8))
        close(result.blendViscosity, target, 8)
      }
    }
  })

  it('handles 0%, 100%, no solution, and infinite solutions', () => {
    const zero = reverseBlend(model, {
      viscosities,
      targetViscosity: blendOf(viscosities, [0, 0.5, 0.5]),
      lockedIndex: 0,
      lockedFraction: 0,
    })
    expect(zero.status).toBe('SUCCESS')

    const locked100 = reverseBlend(model, {
      viscosities,
      targetViscosity: viscosities[0],
      lockedIndex: 0,
      lockedFraction: 1,
    })
    expect(locked100.status).toBe('SUCCESS')
    if (locked100.status === 'SUCCESS') expect(locked100.fractions).toEqual([1, 0, 0])

    const locked100No = reverseBlend(model, {
      viscosities,
      targetViscosity: viscosities[1],
      lockedIndex: 0,
      lockedFraction: 1,
    })
    expect(locked100No.status).toBe('NO_SOLUTION')

    const equalOthers = reverseBlend(model, {
      viscosities: [10, 50, 50],
      targetViscosity: blendOf([10, 50, 50], [0.2, 0.3, 0.5]),
      lockedIndex: 0,
      lockedFraction: 0.2,
    })
    expect(equalOthers.status).toBe('INFINITE_SOLUTIONS')

    const equalOthersNo = reverseBlend(model, {
      viscosities: [10, 50, 50],
      targetViscosity: 80,
      lockedIndex: 0,
      lockedFraction: 0.2,
    })
    expect(equalOthersNo.status).toBe('NO_SOLUTION')
  })

  it('returns the fixed-fraction feasible interval, including all four edge cases', () => {
    const onlyZero = reverseBlend(model, {
      viscosities: [100, 10, 10],
      targetViscosity: 10,
      lockedIndex: 0,
      lockedFraction: 0,
    })
    expect(onlyZero.feasibleLockedFractionRange?.min).toBe(0)
    expect(onlyZero.feasibleLockedFractionRange?.max).toBe(0)

    const onlyOne = reverseBlend(model, {
      viscosities: [10, 100, 100],
      targetViscosity: 10,
      lockedIndex: 0,
      lockedFraction: 1,
    })
    expect(onlyOne.feasibleLockedFractionRange?.min).toBe(1)
    expect(onlyOne.feasibleLockedFractionRange?.max).toBe(1)

    const all = reverseBlend(model, {
      viscosities: [10, 10, 10],
      targetViscosity: 10,
      lockedIndex: 0,
      lockedFraction: 0.4,
    })
    expect(all.feasibleLockedFractionRange).toEqual({ min: 0, max: 1 })

    const empty = reverseBlend(model, {
      viscosities: [10, 100, 100],
      targetViscosity: 200,
      lockedIndex: 0,
      lockedFraction: 0.4,
    })
    expect(empty.feasibleLockedFractionRange).toBeNull()
    expectFiniteTree({ onlyZero, onlyOne, all, empty })
  })
})

describe('optimizeBlend', () => {
  const broadComponents = [
    { viscosity: 10, pricePerKg: 1 },
    { viscosity: 50, pricePerKg: 2 },
    { viscosity: 100, pricePerKg: 10 },
  ] as const

  it('finds the known cheapest vertex with ratio bounds', () => {
    const result = optimizeBlend(model, {
      components: [
        { ...broadComponents[0], minFraction: 0.2, maxFraction: 0.2 },
        { ...broadComponents[1], minFraction: 0, maxFraction: 0.8 },
        { ...broadComponents[2], minFraction: 0, maxFraction: 0.8 },
      ],
      minViscosity: 10,
      maxViscosity: 100,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.fractions).toEqual([0.2, 0.8, 0])
      close(result.costPerKg, 1.8, 12)
      expect(result.activeConstraints).toEqual(expect.arrayContaining(['component1:min', 'component1:max']))
      expect(result.candidateCount).toBeGreaterThan(0)
    }
  })

  it('handles a singleton ratio domain and an exact W interval', () => {
    const fractions: [number, number, number] = [0.2, 0.3, 0.5]
    const target = blendOf([10, 50, 100], fractions)
    const result = optimizeBlend(model, {
      components: [
        { ...broadComponents[0], minFraction: 0.2, maxFraction: 0.2 },
        { ...broadComponents[1], minFraction: 0.3, maxFraction: 0.3 },
        { ...broadComponents[2], minFraction: 0.5, maxFraction: 0.5 },
      ],
      minViscosity: target,
      maxViscosity: target,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.fractions).toEqual(fractions)
  })

  it('handles all equal viscosities and Wlow=Whigh', () => {
    const result = optimizeBlend(model, {
      components: [
        { viscosity: 40, pricePerKg: 3 },
        { viscosity: 40, pricePerKg: 1 },
        { viscosity: 40, pricePerKg: 2 },
      ],
      minViscosity: 40,
      maxViscosity: 40,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.fractions).toEqual([0, 1, 0])
      close(result.blendViscosity, 40, 12)
    }
  })

  it('enumerates the endpoints of a non-trivial exact-viscosity line', () => {
    const target = blendOf([10, 50, 100], [0.2, 0.3, 0.5])
    const result = optimizeBlend(model, {
      components: [
        { viscosity: 10, pricePerKg: 1 },
        { viscosity: 50, pricePerKg: 5 },
        { viscosity: 100, pricePerKg: 2 },
      ],
      minViscosity: target,
      maxViscosity: target,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      close(result.blendViscosity, target, 8)
      expect(result.fractions.reduce((sum, fraction) => sum + fraction, 0)).toBeCloseTo(1, 12)
    }
  })

  it('finds line-segment endpoints under min/max and viscosity constraints', () => {
    const result = optimizeBlend(model, {
      components: [
        { viscosity: 10, pricePerKg: 1, minFraction: 0.2, maxFraction: 0.2 },
        { viscosity: 50, pricePerKg: 1, minFraction: 0, maxFraction: 0.8 },
        { viscosity: 100, pricePerKg: 3, minFraction: 0, maxFraction: 0.8 },
      ],
      minViscosity: 10,
      maxViscosity: 100,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.fractions).toEqual([0.2, 0.8, 0])
  })

  it('diagnoses fraction-bound and target-range failures before enumeration', () => {
    const minSum = optimizeBlend(model, {
      components: [
        { viscosity: 10, pricePerKg: 1, minFraction: 0.6 },
        { viscosity: 50, pricePerKg: 2, minFraction: 0.3 },
        { viscosity: 100, pricePerKg: 10, minFraction: 0.2 },
      ],
      minViscosity: 10,
      maxViscosity: 100,
    })
    expect(minSum.success).toBe(false)
    if (!minSum.success) expect(minSum.errorCode).toBe('INFEASIBLE_FRACTION_BOUNDS')

    const maxSum = optimizeBlend(model, {
      components: [
        { viscosity: 10, pricePerKg: 1, maxFraction: 0.2 },
        { viscosity: 50, pricePerKg: 2, maxFraction: 0.3 },
        { viscosity: 100, pricePerKg: 10, maxFraction: 0.4 },
      ],
      minViscosity: 10,
      maxViscosity: 100,
    })
    expect(maxSum.success).toBe(false)
    if (!maxSum.success) expect(maxSum.errorCode).toBe('INFEASIBLE_FRACTION_BOUNDS')

    const out = optimizeBlend(model, {
      components: broadComponents,
      minViscosity: 200,
      maxViscosity: 300,
    })
    expect(out.success).toBe(false)
    if (!out.success) {
      expect(out.errorCode).toBe('TARGET_OUT_OF_REACH')
      expect(out.diagnostics.reachableViscosityRange).toBeDefined()
    }
  })

  it('computes reachable range without using prices and rejects incomplete optimization prices', () => {
    const range = reachableViscosityRange(model, [
      { viscosity: 10, pricePerKg: Number.NaN, minFraction: 0.2, maxFraction: 0.2 },
      { viscosity: 50, pricePerKg: Number.NaN, minFraction: 0.3, maxFraction: 0.3 },
      { viscosity: 100, pricePerKg: Number.NaN, minFraction: 0.5, maxFraction: 0.5 },
    ])
    expect(range).not.toBeNull()
    const invalid = optimizeBlend(model, {
      components: [
        { viscosity: 10, pricePerKg: Number.NaN },
        { viscosity: 50, pricePerKg: 2 },
        { viscosity: 100, pricePerKg: 10 },
      ],
      minViscosity: 10,
      maxViscosity: 100,
    })
    expect(invalid.success).toBe(false)
    if (!invalid.success) expect(invalid.errorCode).toBe('INVALID_INPUT')
  })

  it('returns only finite values in both success and failure objects', () => {
    const results: OptimizationResult[] = [
      optimizeBlend(model, {
        components: broadComponents,
        minViscosity: 10,
        maxViscosity: 100,
      }),
      optimizeBlend(model, {
        components: broadComponents,
        minViscosity: 200,
        maxViscosity: 300,
      }),
    ]
    results.forEach(expectFiniteTree)
  })
})

describe('ISO VG classification', () => {
  it('separates matched and nearest grades', () => {
    expect(classifyIsoVG(46)).toEqual({ matchedGrade: 46, nearestGrade: 46 })
    expect(classifyIsoVG(46 * 0.9)).toEqual({ matchedGrade: 46, nearestGrade: 46 })
    expect(classifyIsoVG(46 * 1.1)).toEqual({ matchedGrade: 46, nearestGrade: 46 })
    expect(classifyIsoVG(52)).toEqual({ matchedGrade: null, nearestGrade: 46 })
    expect(() => classifyIsoVG(0)).toThrow('大于0')
  })

  it('uses the verified 20-grade table and explicit endpoints', () => {
    expect(ISO_VG_GRADE_TABLE).toHaveLength(20)
    expect(ISO_VG_GRADE_TABLE.slice(-2).map(({ grade }) => grade)).toEqual([2200, 3200])
    expect(ISO_VG_GRADE_TABLE.slice(0, 4).map(({ midpoint }) => midpoint)).toEqual([2.2, 3.2, 4.6, 6.8])
    for (const entry of ISO_VG_GRADE_TABLE) {
      expect(classifyIsoVG(entry.min).matchedGrade).toBe(entry.grade)
      expect(classifyIsoVG(entry.max).matchedGrade).toBe(entry.grade)
      expect(classifyIsoVG(entry.min - 1e-8).matchedGrade).not.toBe(entry.grade)
      expect(classifyIsoVG(entry.max + 1e-8).matchedGrade).not.toBe(entry.grade)
    }
  })
})
