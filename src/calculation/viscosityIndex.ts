/**
 * 粘度指数 (Viscosity Index) 计算。
 *
 * 忠实复刻 chinalubricant.com/tools/viscosity.html:
 * - calcVi 分段多项式 (分段键为 KV100), VI>=100 时按 D2270 第二段重算。
 * - calcKv100: n 从 2 起, +0.01 步进, 直到 calcVi(kv40,n) <= vi 或 n>500。
 * - calcKv40: n 从 kv100 起, +0.05 步进, 直到 calcVi(n,kv100) >= vi 或 n>2000。
 * - 输出取整规则与网站一致 (parseInt(x*100+offset)/100)。
 * - 校验规则与网站一致。
 */

function calcVi(kv40: number, kv100: number): number {
  let Q3: number
  let Q4: number
  let Q5 = 0
  let Q6: number

  if (kv100 >= 2 && kv100 < 4) {
    Q3 = 0.827 * kv100 ** 2 + 1.632 * kv100 - 0.181
    Q4 = 0.3094 * kv100 ** 2 + 0.182 * kv100
    Q6 = ((Q3 + Q4 - kv40) / Q4) * 100
  } else if (kv100 >= 4 && kv100 < 6.1) {
    Q3 = -2.6758 * kv100 ** 2 + 96.671 * kv100 - 269.664 * Math.sqrt(kv100) + 215.025
    Q4 = -7.1955 * kv100 ** 2 + 241.992 * kv100 - 725.478 * Math.sqrt(kv100) + 603.88
    Q6 = ((Q3 + Q4 - kv40) / Q4) * 100
  } else if (kv100 >= 6.1 && kv100 < 7.2) {
    Q3 = 2.32 * kv100 ** 1.5626
    Q4 = 2.838 * kv100 ** 2 - 27.35 * kv100 + 81.83
    Q6 = ((Q3 + Q4 - kv40) / Q4) * 100
  } else if (kv100 >= 7.2 && kv100 < 12.4) {
    Q3 = 0.1922 * kv100 ** 2 + 8.25 * kv100 - 18.728
    Q4 = 0.5463 * kv100 ** 2 + 2.442 * kv100 - 14.16
    Q6 = ((Q3 + Q4 - kv40) / Q4) * 100
  } else if (kv100 >= 12.4 && kv100 <= 70) {
    Q3 = 1795.2 * kv100 ** -2 + 0.1818 * kv100 ** 2 + 10.357 * kv100 - 54.547
    Q4 = 0.6995 * kv100 ** 2 - 1.19 * kv100 + 7.6
    Q6 = ((Q3 + Q4 - kv40) / Q4) * 100
  } else {
    Q3 = 0.1684 * kv100 ** 2 + 11.85 * kv100 - 97
    Q5 = 0.8353 * kv100 ** 2 + 14.67 * kv100 - 216
    Q4 = 0.6669 * kv100 ** 2 + 2.82 * kv100 - 119
    Q6 = ((Q5 - kv40) / Q4) * 100
  }

  if (Q6 >= 100) {
    const Q7 = (Math.log(Q3) / Math.LN10 - Math.log(kv40) / Math.LN10) / (Math.log(kv100) / Math.LN10)
    Q6 = (10 ** Q7 - 1) / 0.00715 + 100
  }

  return parseInt(String(Q6 + 0.5), 10)
}

export function viscosityIndex(kv40: number, kv100: number): number {
  if (kv40 < 2) throw new Error('KV40 需 >= 2。')
  if (kv100 < 2) throw new Error('KV100 需 >= 2。')
  if (kv40 <= kv100) throw new Error('KV40 必须大于 KV100。')
  return calcVi(kv40, kv100)
}

export function kv100FromVI(vi: number, kv40: number): number {
  if (kv40 < 2) throw new Error('KV40 需 >= 2。')
  let n = 2
  let V: number
  do {
    V = calcVi(kv40, n)
    n += 0.01
  } while (V <= vi && n <= 500)
  const result = parseInt(String(n * 100 + 0.01), 10) / 100
  if (500 < result || result < 2) throw new Error('超出公式有效范围。')
  return result
}

export function kv40FromVI(vi: number, kv100: number): number {
  if (kv100 < 2) throw new Error('KV100 需 >= 2。')
  let n = kv100
  let V: number
  do {
    V = calcVi(n, kv100)
    n += 0.05
  } while (V >= vi && n <= 2000)
  const result = parseInt(String(n * 100 + 0.1), 10) / 100
  if (result < kv100 || result < 2 || result > 2000) throw new Error('超出公式有效范围。')
  return result
}
