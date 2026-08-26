import { expect, test, type Download, type Page } from '@playwright/test'

const pageErrors = new WeakMap<Page, string[]>()

function watchPage(page: Page) {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}

test.beforeEach(async ({ page }) => {
  watchPage(page)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByRole('heading', { name: '润滑油配方计算器' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([])
})

function input(page: Page, name: string) {
  return page.getByLabel(name, { exact: true })
}

async function calculateForward(page: Page) {
  await page.getByRole('button', { name: /计算调和粘度/ }).click()
  await expect(page.getByText('CALCULATED')).toBeVisible()
}

async function saveForward(page: Page, name: string) {
  await calculateForward(page)
  page.once('dialog', (dialog) => dialog.accept(name))
  await page.getByRole('button', { name: '保存方案' }).click()
  await expect(page.getByRole('heading', { name: '我的配方' })).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

async function saveSecondForward(page: Page, name: string) {
  await input(page, '第1行价格').fill('12')
  await saveForward(page, name)
}

async function saveOptimization(page: Page, name: string) {
  await page.getByRole('button', { name: /寻找最低成本方案/ }).click()
  await expect(page.getByText('OPTIMAL')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept(name))
  await page.getByRole('button', { name: '保存方案' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

function backupRecipe(name: string, id = name) {
  return {
    schemaVersion: 2,
    id,
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'forward',
    appVersion: '0.1.0',
    viscosityModel: { id: 'simplified-walther', version: 1 },
    components: [{ id: 'component-1', name: 'PAO 6', viscosity: 10, category: 'PAO', fraction: 1, pricePerKg: 2 }],
    categoryConstraints: [],
    targetViscosity: null,
    targetTolerance: null,
    lockedIndex: null,
    lockedFraction: null,
    optimizationConstraints: null,
    blendViscosity: 10,
    costPerKg: 2,
    costPerTon: 2000,
    isoVG: { matchedGrade: 10, nearestGrade: 10 },
  }
}

function backupJson(...recipes: object[]) {
  return JSON.stringify({ backupFormatVersion: 1, exportedAt: '2026-01-01T00:00:00.000Z', appVersion: '0.1.0', recipes })
}

async function readDownloadText(download: Download) {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('download stream unavailable')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

test('正算结果', async ({ page }) => {
  await input(page, '第1行原料名称').fill('高粘测试油')
  await input(page, '第1行运动粘度').fill('120')
  await input(page, '第1行质量分数').fill('30')
  await input(page, '第1行价格').fill('9.90')
  await input(page, '第2行原料名称').fill('中粘测试油')
  await input(page, '第2行运动粘度').fill('46')
  await input(page, '第2行质量分数').fill('45')
  await input(page, '第2行价格').fill('5.60')
  await input(page, '第3行原料名称').fill('低粘测试油')
  await input(page, '第3行运动粘度').fill('10')
  await input(page, '第3行质量分数').fill('25')
  await input(page, '第3行价格').fill('3.80')
  await calculateForward(page)
  await expect(page.getByText('理论调和 KV40')).toBeVisible()
  await expect(page.getByLabel('ISO VG 判断')).toBeVisible()
  await expect(page.getByText('配方成本贡献')).toBeVisible()
})

test('反求成功', async ({ page }) => {
  await page.getByRole('button', { name: /目标粘度.*配比/ }).click()
  await input(page, '目标运动粘度').fill('46')
  await page.getByRole('button', { name: /解析反求配比/ }).click()
  await expect(page.getByText('找到可行配方')).toBeVisible()
  await expect(page.getByText('SUCCESS')).toBeVisible()
})

test('反求不可达错误', async ({ page }) => {
  await page.getByRole('button', { name: /目标粘度.*配比/ }).click()
  await input(page, '目标运动粘度').fill('100')
  await page.getByRole('button', { name: /解析反求配比/ }).click()
  await expect(page.getByText('当前条件无解')).toBeVisible()
  await expect(page.getByText('NO_SOLUTION')).toBeVisible()
})

test('优化成功并显示成本', async ({ page }) => {
  await page.getByRole('button', { name: /最低成本优化/ }).click()
  await page.getByRole('button', { name: /寻找最低成本方案/ }).click()
  await expect(page.getByText('OPTIMAL')).toBeVisible()
  await expect(page.getByText('最低成本', { exact: true })).toBeVisible()
  await expect(page.locator('.result-panel').getByText('元/kg', { exact: true })).toBeVisible()
})

test('保存后刷新仍存在', async ({ page }) => {
  await saveForward(page, '刷新保留方案')
  const context = page.context()
  await page.close()
  const reopened = await context.newPage()
  const reopenedErrors = watchPage(reopened)
  await reopened.goto('/')
  await expect(reopened.getByRole('button', { name: /刷新保留方案/ })).toBeVisible()
  await expect(reopened.getByText('1 个方案')).toBeVisible()
  await expect.poll(() => reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(reopenedErrors).toEqual([])
  await reopened.close()
})

test('载入恢复完整输入', async ({ page }) => {
  await input(page, '第1行原料名称').fill('高粘测试油')
  await input(page, '第1行运动粘度').fill('120')
  await input(page, '第1行质量分数').fill('30')
  await input(page, '第1行价格').fill('9.90')
  await input(page, '第2行质量分数').fill('45')
  await input(page, '第3行质量分数').fill('25')
  await saveForward(page, '完整输入方案')
  await page.getByRole('button', { name: '载入' }).click()
  await expect(input(page, '第1行原料名称')).toHaveValue('高粘测试油')
  await expect(input(page, '第1行运动粘度')).toHaveValue('120')
  await expect(input(page, '第1行质量分数')).toHaveValue('30')
  await expect(input(page, '第1行价格')).toHaveValue('9.9')
  await expect(input(page, '第2行原料名称')).toHaveValue('中粘基础油')
  await expect(input(page, '第2行运动粘度')).toHaveValue('46')
  await expect(input(page, '第2行质量分数')).toHaveValue('45')
  await expect(input(page, '第2行价格')).toHaveValue('5.6')
  await expect(input(page, '第3行原料名称')).toHaveValue('低粘基础油')
  await expect(input(page, '第3行运动粘度')).toHaveValue('10')
  await expect(input(page, '第3行质量分数')).toHaveValue('25')
  await expect(input(page, '第3行价格')).toHaveValue('3.8')

  await page.getByRole('button', { name: /最低成本优化/ }).click()
  await input(page, '第1行组分名称').fill('优化低粘油')
  await input(page, '第1行运动粘度').fill('10')
  await input(page, '第1行价格').fill('3.80')
  await input(page, '第1行最小比例').fill('10')
  await input(page, '第1行最大比例').fill('70')
  await input(page, '第2行组分名称').fill('优化中粘油')
  await input(page, '第2行运动粘度').fill('50')
  await input(page, '第2行价格').fill('5.60')
  await input(page, '第2行最小比例').fill('20')
  await input(page, '第2行最大比例').fill('70')
  await input(page, '第3行组分名称').fill('优化高粘油')
  await input(page, '第3行运动粘度').fill('100')
  await input(page, '第3行价格').fill('8.20')
  await input(page, '第3行最小比例').fill('0')
  await input(page, '第3行最大比例').fill('70')
  await page.getByRole('radio', { name: '范围' }).check()
  await input(page, '目标粘度下限').fill('30')
  await input(page, '目标粘度上限').fill('60')
  await saveOptimization(page, '优化完整方案')
  const optimizeRecipe = page.locator('.recipe-item').filter({ hasText: '优化完整方案' })
  await optimizeRecipe.getByRole('button', { name: '载入' }).click()
  await expect(page.getByRole('heading', { name: '最低成本优化' })).toBeVisible()
  await expect(input(page, '第1行组分名称')).toHaveValue('优化低粘油')
  await expect(input(page, '第1行运动粘度')).toHaveValue('10')
  await expect(input(page, '第1行价格')).toHaveValue('3.8')
  await expect(input(page, '第1行最小比例')).toHaveValue('10')
  await expect(input(page, '第1行最大比例')).toHaveValue('70')
  await expect(input(page, '第2行组分名称')).toHaveValue('优化中粘油')
  await expect(input(page, '第2行运动粘度')).toHaveValue('50')
  await expect(input(page, '第2行价格')).toHaveValue('5.6')
  await expect(input(page, '第2行最小比例')).toHaveValue('20')
  await expect(input(page, '第2行最大比例')).toHaveValue('70')
  await expect(input(page, '第3行组分名称')).toHaveValue('优化高粘油')
  await expect(input(page, '第3行运动粘度')).toHaveValue('100')
  await expect(input(page, '第3行价格')).toHaveValue('8.2')
  await expect(input(page, '第3行最小比例')).toHaveValue('0')
  await expect(input(page, '第3行最大比例')).toHaveValue('70')
  await expect(page.getByRole('radio', { name: '范围' })).toBeChecked()
  await expect(input(page, '目标粘度下限')).toHaveValue('30')
  await expect(input(page, '目标粘度上限')).toHaveValue('60')
})

test('复制与删除需要确认', async ({ page }) => {
  await saveForward(page, '复制源方案')
  await page.getByRole('button', { name: '复制', exact: true }).click()
  await expect(page.getByText('2 个方案')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除' }).last().click()
  await expect(page.getByText('1 个方案')).toBeVisible()
})

test('两方案对比', async ({ page }) => {
  await saveForward(page, '对比方案 A')
  await saveSecondForward(page, '对比方案 B')
  await page.getByLabel('选择方案 对比方案 A', { exact: true }).check()
  await page.getByLabel('选择方案 对比方案 B', { exact: true }).check()
  await page.getByRole('button', { name: /打开方案对比/ }).click()
  await expect(page.getByRole('heading', { name: '方案对比' })).toBeVisible()
  await expect(page.locator('.comparison-panel')).toContainText('对比方案 A')
  await expect(page.locator('.comparison-panel')).toContainText('对比方案 B')
  await expect(page.getByText('类别汇总')).toBeVisible()
})

test('设置基准并显示节省指标', async ({ page }) => {
  await saveForward(page, '低成本基准')
  await saveSecondForward(page, '高成本候选')
  await page.getByLabel('选择方案 低成本基准', { exact: true }).check()
  await page.getByLabel('选择方案 高成本候选', { exact: true }).check()
  await page.getByRole('button', { name: '设为基准' }).last().click()
  await page.getByRole('button', { name: /打开方案对比/ }).click()
  await expect(page.getByText('基准：高成本候选')).toBeVisible()
  await expect(page.locator('.saving-grid')).toContainText('成本降低 0.95 元/kg')
  await expect(page.locator('.saving-grid')).toContainText('降低 14.07%')
  await expect(page.locator('.saving-grid')).toContainText('950.00 元/t')
  await expect(page.locator('.comparison-panel')).toContainText('元/kg')
  await expect(page.locator('.comparison-panel')).toContainText('%')
  await expect(page.locator('.comparison-panel')).toContainText('元/t')
})

test('CSV下载包含BOM和免责声明', async ({ page }) => {
  await saveForward(page, 'CSV方案')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV', exact: true }).click(),
  ])
  const stream = await download.createReadStream()
  if (!stream) throw new Error('CSV download stream unavailable')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const data = Buffer.concat(chunks)
  expect(data.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  expect(data.toString('utf8')).toContain('实际运动粘度应以实验检测结果为准')
  expect(download.suggestedFilename()).toMatch(/\.csv$/)
})

test('类别设置并显示类别组成', async ({ page }) => {
  await input(page, '第1行原料类别').selectOption('PAO')
  await calculateForward(page)
  await expect(page.getByText('类别组成')).toBeVisible()
  await expect(page.locator('.result-category-summary')).toContainText('PAO')
  await expect(input(page, '第1行原料类别')).toHaveValue('PAO')
})

test('PAO类别最低比例50%的优化成功', async ({ page }) => {
  await page.getByRole('button', { name: /最低成本优化/ }).click()
  await input(page, '第1行组分类别').selectOption('PAO')
  await input(page, '第2行组分类别').selectOption('PAO')
  await input(page, '第3行组分类别').selectOption('AN')
  await page.getByRole('button', { name: /添加类别约束/ }).click()
  await input(page, '第1条类别约束类别').selectOption('PAO')
  await input(page, '第1条类别约束最低比例').fill('50')
  await saveOptimization(page, 'PAO约束方案')
  const paoRow = page.locator('.result-category-summary .category-row').filter({ hasText: 'PAO' })
  const paoText = await paoRow.locator('strong').textContent()
  const paoFraction = Number.parseFloat((paoText ?? '').replace(/,/g, ''))
  expect(paoFraction).toBeGreaterThanOrEqual(50)
  await expect(page.getByText('最优解活动约束')).toBeVisible()
})

test('不可行类别约束显示明确诊断', async ({ page }) => {
  await page.getByRole('button', { name: /最低成本优化/ }).click()
  await input(page, '第1行组分类别').selectOption('PAO')
  await input(page, '第2行组分类别').selectOption('PAO')
  await input(page, '第1行最大比例').fill('20')
  await input(page, '第2行最大比例').fill('20')
  await page.getByRole('button', { name: /添加类别约束/ }).click()
  await input(page, '第1条类别约束类别').selectOption('PAO')
  await input(page, '第1条类别约束最低比例').fill('50')
  await page.getByRole('button', { name: /寻找最低成本方案/ }).click()
  await expect(page.locator('.result-panel')).toContainText('CATEGORY_MIN_CONFLICT')
})

test('类别粘度与原料上下限联合优化成功', async ({ page }) => {
  await page.getByRole('button', { name: /最低成本优化/ }).click()
  await input(page, '第1行组分类别').selectOption('PAO')
  await input(page, '第2行组分类别').selectOption('PAO')
  await input(page, '第3行组分类别').selectOption('AN')
  await input(page, '第1行最小比例').fill('10')
  await input(page, '第1行最大比例').fill('70')
  await input(page, '第2行最小比例').fill('20')
  await input(page, '第2行最大比例').fill('70')
  await input(page, '第3行最小比例').fill('0')
  await input(page, '第3行最大比例').fill('70')
  await page.getByRole('button', { name: /添加类别约束/ }).click()
  await input(page, '第1条类别约束类别').selectOption('PAO')
  await input(page, '第1条类别约束最低比例').fill('40')
  await page.getByRole('button', { name: /添加类别约束/ }).click()
  await input(page, '第2条类别约束类别').selectOption('AN')
  await input(page, '第2条类别约束最高比例').fill('30')
  await page.getByRole('radio', { name: '范围' }).check()
  await input(page, '目标粘度下限').fill('30')
  await input(page, '目标粘度上限').fill('45')
  await page.getByRole('button', { name: /寻找最低成本方案/ }).click()
  await expect(page.getByText('OPTIMAL')).toBeVisible()
})

test('保存后刷新恢复类别约束', async ({ page }) => {
  await page.getByRole('button', { name: /最低成本优化/ }).click()
  await input(page, '第1行组分类别').selectOption('PAO')
  await input(page, '第2行组分类别').selectOption('PAO')
  await page.getByRole('button', { name: /添加类别约束/ }).click()
  await input(page, '第1条类别约束类别').selectOption('PAO')
  await input(page, '第1条类别约束最低比例').fill('40')
  await saveOptimization(page, '类别恢复方案')
  await page.reload()
  const restoredRecipe = page.locator('.recipe-item').filter({ hasText: '类别恢复方案' })
  await expect(restoredRecipe).toBeVisible()
  await restoredRecipe.getByRole('button', { name: '载入' }).click()
  await expect(input(page, '第1行组分类别')).toHaveValue('PAO')
  await expect(input(page, '第2行组分类别')).toHaveValue('PAO')
  await expect(input(page, '第1条类别约束最低比例')).toHaveValue('40')
})

test('V1配方自动迁移到OTHER类别', async ({ page }) => {
  const legacy = { ...backupRecipe('V1迁移方案', 'legacy-v1'), schemaVersion: 1, components: [{ id: 'legacy-component', name: '旧原料', viscosity: 10, fraction: 1, pricePerKg: 2 }] }
  await page.evaluate((value) => localStorage.setItem('lubricant-recipe-v1:legacy-v1', JSON.stringify(value)), legacy)
  await page.reload()
  await expect(page.getByRole('button', { name: /V1迁移方案/ })).toBeVisible()
  await page.getByRole('button', { name: '载入' }).click()
  await expect(input(page, '第1行原料类别')).toHaveValue('OTHER')
})

test('单配方JSON下载', async ({ page }) => {
  await saveForward(page, '单配方JSON')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON', exact: true }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  expect(JSON.parse(await readDownloadText(download)).recipes).toHaveLength(1)
})

test('全部备份JSON下载', async ({ page }) => {
  await saveForward(page, '备份A')
  await saveSecondForward(page, '备份B')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '全部备份 JSON' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  expect(JSON.parse(await readDownloadText(download)).recipes).toHaveLength(2)
})

test('合法JSON先预览再确认导入', async ({ page }) => {
  const payload = backupJson(backupRecipe('合法导入'))
  await page.locator('input[type=file]').setInputFiles({ name: '合法.json', mimeType: 'application/json', buffer: Buffer.from(payload) })
  await expect(page.getByText('导入预览')).toBeVisible()
  await expect(page.getByText('合法导入')).toBeVisible()
  await expect(page.getByText('0 个方案')).toBeVisible()
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText(/导入完成/)).toBeVisible()
  await expect(page.getByRole('button', { name: /合法导入/ })).toBeVisible()
})

test('重复ID默认创建导入副本', async ({ page }) => {
  const payload = backupJson(backupRecipe('重复方案', 'same-id'))
  const file = { name: '重复.json', mimeType: 'application/json', buffer: Buffer.from(payload) }
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: '确认导入' }).click()
  await page.locator('input[type=file]').setInputFiles(file)
  await expect(page.getByRole('combobox', { name: '冲突策略' })).toHaveValue('duplicate')
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByText('2 个方案')).toBeVisible()
  await expect(page.getByText(/副本 1 条/)).toBeVisible()
})

test('损坏JSON导入不崩溃', async ({ page }) => {
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('input[type=file]').setInputFiles({ name: '损坏.json', mimeType: 'application/json', buffer: Buffer.from('{broken') })
  await expect(page.getByRole('heading', { name: '润滑油配方计算器' })).toBeVisible()
  await expect(page.getByText('0 个方案')).toBeVisible()
})

test('部分合法部分非法JSON仍导入合法项', async ({ page }) => {
  const valid = backupRecipe('部分合法')
  const payload = backupJson(valid, { broken: true })
  await page.locator('input[type=file]').setInputFiles({ name: '部分.json', mimeType: 'application/json', buffer: Buffer.from(payload) })
  await expect(page.getByText('无效 1 条')).toBeVisible()
  await page.getByRole('button', { name: '确认导入' }).click()
  await expect(page.getByRole('button', { name: /部分合法/ })).toBeVisible()
  await expect(page.getByText(/失败 1 条/)).toBeVisible()
})
