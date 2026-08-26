import { describe, expect, it } from 'vitest'
import { SimplifiedWaltherModel, optimizeBlend } from './index'

const model = new SimplifiedWaltherModel()

function baseComponents() {
  return [
    { viscosity: 10, pricePerKg: 3, category: 'PAO', minFraction: 0.1, maxFraction: 0.7 },
    { viscosity: 50, pricePerKg: 4, category: 'PAO', minFraction: 0.1, maxFraction: 0.7 },
    { viscosity: 100, pricePerKg: 2, category: 'AN', minFraction: 0, maxFraction: 0.6 },
  ] as const
}

describe('category-constrained optimization', () => {
  it('honors a PAO minimum and reports it as active', () => {
    const result = optimizeBlend(model, {
      components: baseComponents(),
      minViscosity: 20,
      maxViscosity: 60,
      categoryConstraints: [{ category: 'PAO', minFraction: 0.5 }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      const paoTotal = result.fractions[0] + result.fractions[1]
      expect(paoTotal).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(result.activeConstraints).toContain('category:PAO:min')
      expect(result.diagnostics.activeConstraintDetails?.some((item) => item.type === 'CATEGORY_MIN' && item.label.includes('PAO'))).toBe(true)
    }
  })

  it('formats active viscosity constraints as viscosity values', () => {
    const result = optimizeBlend(model, {
      components: baseComponents(),
      minViscosity: 46,
      maxViscosity: 46,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      const labels = result.diagnostics.activeConstraintDetails?.map((item) => item.label) ?? []
      expect(labels.some((label) => label.includes('KV40') && label.includes('mm²/s') && !label.includes('%'))).toBe(true)
    }
  })

  it('handles simultaneous category constraints with viscosity bounds', () => {
    const result = optimizeBlend(model, {
      components: baseComponents(),
      minViscosity: 30,
      maxViscosity: 45,
      categoryConstraints: [
        { category: 'PAO', minFraction: 0.4 },
        { category: 'AN', maxFraction: 0.3 },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.fractions[0] + result.fractions[1]).toBeGreaterThanOrEqual(0.4 - 1e-9)
      expect(result.fractions[2]).toBeLessThanOrEqual(0.3 + 1e-9)
      expect(result.blendViscosity).toBeGreaterThanOrEqual(30 - 1e-9)
      expect(result.blendViscosity).toBeLessThanOrEqual(45 + 1e-9)
    }
  })

  it('diagnoses an impossible category minimum without full enumeration', () => {
    const result = optimizeBlend(model, {
      components: [
        { ...baseComponents()[0], maxFraction: 0.3 },
        { ...baseComponents()[1], maxFraction: 0.3 },
        baseComponents()[2],
      ],
      minViscosity: 20,
      maxViscosity: 60,
      categoryConstraints: [{ category: 'PAO', minFraction: 0.7 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errorCode).toBe('CATEGORY_MIN_CONFLICT')
      expect(result.message).toContain('PAO')
    }
  })

  it('reports a category-max conflict when component minimums force the share up', () => {
    const result = optimizeBlend(model, {
      components: [
        { viscosity: 10, pricePerKg: 3, category: 'AN', minFraction: 0.3, maxFraction: 0.6 },
        { viscosity: 50, pricePerKg: 4, category: 'PAO', maxFraction: 0.6 },
        { viscosity: 100, pricePerKg: 2, category: 'PAO', maxFraction: 0.6 },
      ],
      minViscosity: 20,
      maxViscosity: 80,
      categoryConstraints: [{ category: 'AN', maxFraction: 0.2 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errorCode).toBe('CATEGORY_MAX_CONFLICT')
  })

  it('flags viscosity/category conflicts as NO_FEASIBLE_SOLUTION', () => {
    const result = optimizeBlend(model, {
      components: baseComponents(),
      // AN（KV100，最便宜且高粘）被限制到 ≤10%，同时要求 KV40 ≥ 90：仅靠 PAO 无法达到。
      minViscosity: 60,
      maxViscosity: 70,
      categoryConstraints: [{ category: 'AN', maxFraction: 0.1 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errorCode).toBe('VISCOSITY_CONSTRAINT_CONFLICT')
  })
})
