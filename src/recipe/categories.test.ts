import { describe, expect, it } from 'vitest'
import {
  aggregateFractionsByCategory,
  normalizeCategory,
  validateCategoryConstraints,
} from './categories'

describe('category model', () => {
  it('normalizes unknown or missing categories to OTHER', () => {
    expect(normalizeCategory('PAO')).toBe('PAO')
    expect(normalizeCategory('pao')).toBe('OTHER')
    expect(normalizeCategory(undefined)).toBe('OTHER')
    expect(normalizeCategory(42)).toBe('OTHER')
  })

  it('aggregates fractions by stable category without guessing names', () => {
    const summary = aggregateFractionsByCategory([
      { fraction: 0.25, category: 'PAO' },
      { fraction: 0.35, category: 'PAO' },
      { fraction: 0.2, category: 'AN' },
      { fraction: 0.2 },
      { fraction: 0.1, category: 'NOT_REAL' },
    ])
    expect(summary.PAO).toBeCloseTo(0.6, 10)
    expect(summary.AN).toBeCloseTo(0.2, 10)
    expect(summary.OTHER).toBeCloseTo(0.3, 10)
    expect(summary.ESTER).toBe(0)
  })

  it('rejects invalid ranges and duplicate categories', () => {
    const result = validateCategoryConstraints(
      [
        { category: 'PAO', minFraction: -0.1 },
        { category: 'AN', minFraction: 0.8, maxFraction: 0.5 },
        { category: 'AN', maxFraction: 0.2 },
        { category: 'ESTER', maxFraction: 1.5 },
      ],
      [],
    )
    const codes = result.errors.map((error) => error.code)
    expect(codes).toContain('INVALID_RANGE')
    expect(codes).toContain('DUPLICATE_CATEGORY')
    expect(result.valid).toBe(false)
  })

  it('detects impossible minimum against component maximums', () => {
    const result = validateCategoryConstraints(
      [{ category: 'PAO', minFraction: 0.7 }],
      [
        { minFraction: 0.1, maxFraction: 0.3, category: 'PAO' },
        { maxFraction: 0.3, category: 'PAO' },
        { category: 'AN' },
      ],
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.code).toBe('CATEGORY_MIN_INFEASIBLE')
    expect(result.errors[0]?.message).toContain('60%')
  })

  it('detects impossible maximum against component minimums', () => {
    const result = validateCategoryConstraints(
      [{ category: 'AN', maxFraction: 0.2 }],
      [{ minFraction: 0.3, category: 'AN' }],
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.code).toBe('CATEGORY_MAX_INFEASIBLE')
  })

  it('detects total minimum conflict across categories', () => {
    const result = validateCategoryConstraints(
      [
        { category: 'PAO', minFraction: 0.7 },
        { category: 'AN', minFraction: 0.5 },
      ],
      [],
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.code === 'TOTAL_MIN_CONFLICT')).toBe(true)
  })

  it('accepts a consistent constraint set', () => {
    const result = validateCategoryConstraints(
      [
        { category: 'PAO', minFraction: 0.5, maxFraction: 0.8 },
        { category: 'AN', maxFraction: 0.25 },
      ],
      [
        { category: 'PAO' },
        { category: 'PAO', maxFraction: 0.4 },
        { category: 'AN', maxFraction: 0.25 },
      ],
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})
