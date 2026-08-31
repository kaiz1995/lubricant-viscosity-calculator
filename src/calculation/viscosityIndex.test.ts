import { describe, expect, it } from 'vitest'
import { viscosityIndex, kv100FromVI, kv40FromVI } from './viscosityIndex'

// 基准值由 chinalubricant.com 原始 JS 算法计算得到, 非教科书 D2270 示例。
describe('viscosityIndex (复刻 chinalubricant.com)', () => {
  it('分段 1-6 正算与参考站一致', () => {
    // 段1: KV100 in [2,4)
    expect(viscosityIndex(6, 3)).toBe(575)
    // 段2: [4,6.1)
    expect(viscosityIndex(30, 5)).toBe(87)
    // 段3: [6.1,7.2)
    expect(viscosityIndex(40, 7)).toBe(136)
    // 段4: [7.2,12.4)
    expect(viscosityIndex(50, 8)).toBe(130)
    // 段5: [12.4,70]
    expect(viscosityIndex(100, 20)).toBe(225)
    // 段6: >70
    expect(viscosityIndex(300, 80)).toBe(332)
    // 已知用例 (段4)
    expect(viscosityIndex(73.3, 8.86)).toBe(92)
  })

  it('反推 KV100: VI+KV40 -> KV100', () => {
    expect(kv100FromVI(128.7, 73.3)).toBeCloseTo(10.47, 2)
    expect(kv100FromVI(100, 100)).toBeCloseTo(11.42, 2)
  })

  it('反推 KV40: VI+KV100 -> KV40', () => {
    expect(kv40FromVI(128.7, 8.86)).toBeCloseTo(58.36, 2)
    expect(kv40FromVI(100, 10)).toBeCloseTo(83.4, 1)
  })

  it('校验: KV40 <= KV100 报错', () => {
    expect(() => viscosityIndex(10, 10)).toThrow('KV40 必须大于 KV100')
    expect(() => viscosityIndex(5, 10)).toThrow('KV40 必须大于 KV100')
  })

  it('校验: 输入 < 2 报错', () => {
    expect(() => viscosityIndex(1, 3)).toThrow('KV40 需 >= 2')
    expect(() => viscosityIndex(20, 1)).toThrow('KV100 需 >= 2')
  })
})
