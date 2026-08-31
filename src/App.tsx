import { useEffect, useRef, useState } from 'react'
import logo from './assets/lubemater-logo.png'
import {
  SimplifiedWaltherModel,
  blendViscosity,
  calculateCost,
  classifyIsoVG,
  optimizeBlend,
  reachableViscosityRange,
  reverseBlend,
  viscosityIndex,
  kv100FromVI,
  kv40FromVI,
  type CostResult,
  type OptimizationResult,
  type ReverseBlendResult,
} from './calculation'
import {
  aggregateFractionsByCategory,
  buildCsvFileName,
  CATEGORY_LABELS,
  compareRecipes,
  createRecipe,
  defaultAppVersion,
  duplicateStoredRecipe,
  IMPORT_LIMITS,
  normalizeCategory,
  OIL_CATEGORIES,
  parseBackup,
  planImport,
  listRecipes,
  recipeToCsv,
  renameStoredRecipe,
  saveRecipe,
  serializeBackup,
  deleteRecipe,
  type CategoryConstraint,
  type ImportConflictStrategy,
  type ParsedBackup,
  type OilCategory,
  type ComparisonResult,
  type Recipe,
} from './recipe'
import './styles.css'

const model = new SimplifiedWaltherModel()

type Tab = 'forward' | 'reverse' | 'optimize' | 'vi'
type TargetMode = 'exact' | 'range' | 'tolerance'

interface ForwardRow {
  name: string
  viscosity: string
  fraction: string
  price: string
  category: OilCategory
}

interface ReverseRow {
  name: string
  viscosity: string
  category: OilCategory
}

interface OptimizationRow {
  name: string
  viscosity: string
  price: string
  minFraction: string
  maxFraction: string
  category: OilCategory
}

interface CategoryConstraintRow {
  category: OilCategory
  minFraction: string
  maxFraction: string
}

interface ForwardResult {
  viscosity: number
  iso: ReturnType<typeof classifyIsoVG>
  cost: CostResult
  rows: ForwardRow[]
}

const initialForwardRows: ForwardRow[] = [
  { name: '', viscosity: '', fraction: '', price: '', category: 'OTHER' },
  { name: '', viscosity: '', fraction: '', price: '', category: 'OTHER' },
  { name: '', viscosity: '', fraction: '', price: '', category: 'OTHER' },
]

const initialReverseRows: ReverseRow[] = [
  { name: '', viscosity: '', category: 'OTHER' },
  { name: '', viscosity: '', category: 'OTHER' },
  { name: '', viscosity: '', category: 'OTHER' },
]

const initialOptimizationRows: OptimizationRow[] = [
  { name: '', viscosity: '', price: '', minFraction: '', maxFraction: '', category: 'OTHER' },
  { name: '', viscosity: '', price: '', minFraction: '', maxFraction: '', category: 'OTHER' },
  { name: '', viscosity: '', price: '', minFraction: '', maxFraction: '', category: 'OTHER' },
]

type SaveRecipe = (recipe: Recipe) => void

function defaultRecipeName(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `未命名方案 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function inputNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function forwardRowsFromRecipe(recipe: Recipe): ForwardRow[] {
  return recipe.components.map((component) => ({
    name: component.name,
    viscosity: String(component.viscosity),
    fraction: component.fraction === undefined ? '' : String(component.fraction * 100),
    price: inputNumber(component.pricePerKg),
    category: normalizeCategory(component.category),
  }))
}

function reverseRowsFromRecipe(recipe: Recipe): ReverseRow[] {
  return recipe.components.slice(0, 3).map((component, index) => ({
    name: component.name || `组分 ${index + 1}`,
    viscosity: String(component.viscosity),
    category: normalizeCategory(component.category),
  }))
}

function optimizationRowsFromRecipe(recipe: Recipe): OptimizationRow[] {
  return recipe.components.slice(0, 3).map((component, index) => ({
    name: component.name || `组分 ${index + 1}`,
    viscosity: String(component.viscosity),
    price: inputNumber(component.pricePerKg),
    minFraction: component.minFraction === undefined ? '0' : String(component.minFraction * 100),
    maxFraction: component.maxFraction === undefined ? '100' : String(component.maxFraction * 100),
    category: normalizeCategory(component.category),
  }))
}

function toRecipeComponents(rows: ForwardRow[], fractions?: number[]): Recipe['components'] {
  return rows.map((row, index) => ({
    id: '',
    name: row.name,
    viscosity: Number(row.viscosity),
    fraction: fractions ? fractions[index] : Number(row.fraction) / 100,
    pricePerKg: row.price.trim() === '' ? null : Number(row.price),
    category: normalizeCategory(row.category),
  }))
}

function parseValue(value: string, label: string): number {
  if (value.trim() === '') throw new Error(`请填写${label}。`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有限数值。`)
  return parsed
}

function parseOptionalValue(value: string, label = '价格'): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有限数值。`)
  return parsed
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`
}

function CategorySelect({ value, onChange, ariaLabel, usedCategories = [] }: { value: OilCategory; onChange: (value: OilCategory) => void; ariaLabel: string; usedCategories?: OilCategory[] }) {
  return <select value={normalizeCategory(value)} onChange={(event) => onChange(normalizeCategory(event.target.value))} aria-label={ariaLabel}>{OIL_CATEGORIES.map((category) => <option value={category} key={category} disabled={usedCategories.includes(category) && category !== value}>{CATEGORY_LABELS[category]}</option>)}</select>
}

function CategorySummary({ components }: { components: Array<{ category?: string; fraction?: number }> }) {
  const summary = aggregateFractionsByCategory(components)
  const entries = OIL_CATEGORIES.filter((category) => summary[category] > 1e-10)
  if (entries.length === 0) return null
  return <div className="category-summary result-category-summary"><div className="subheading"><h4>类别组成</h4><span>按原料 category 汇总</span></div>{entries.map((category) => <div className="category-row" key={category}><span>{CATEGORY_LABELS[category]}</span><strong>{formatPercent(summary[category])}</strong></div>)}</div>
}

function categoryConstraintRowsFromRecipe(recipe?: Recipe | null): CategoryConstraintRow[] {
  return recipe?.categoryConstraints.map((constraint) => ({
    category: normalizeCategory(constraint.category),
    minFraction: constraint.minFraction === undefined ? '' : String(constraint.minFraction * 100),
    maxFraction: constraint.maxFraction === undefined ? '' : String(constraint.maxFraction * 100),
  })) ?? []
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '输入无效，请检查后重试。'
}

function constraintLabel(constraint: string): string {
  if (constraint === 'viscosity:min') return '粘度下限'
  if (constraint === 'viscosity:max') return '粘度上限'
  const match = constraint.match(/^component(\d+):(min|max)$/)
  return match ? `组分${match[1]}：${match[2] === 'min' ? '最小比例' : '最大比例'}` : constraint
}

function IsoBadge({ iso }: { iso: ReturnType<typeof classifyIsoVG> }) {
  return (
    <div className="iso-result" aria-label="ISO VG 判断">
      {iso.matchedGrade === null ? (
        <>
          <span className="status-dot warning" />
          <span>非标准 VG 范围</span>
          <small>最接近 VG {iso.nearestGrade}</small>
        </>
      ) : (
        <>
          <span className="status-dot success" />
          <span>ISO VG {iso.matchedGrade} 匹配</span>
          <small>KV40 处于该等级允许区间</small>
        </>
      )}
    </div>
  )
}

function ResultCard({
  title,
  value,
  unit,
  detail,
  tone = 'blue',
}: {
  title: string
  value: string
  unit?: string
  detail?: string
  tone?: 'blue' | 'green' | 'amber'
}) {
  return (
    <div className={`result-card ${tone}`}>
      <div className="result-label">{title}</div>
      <div className="result-value">
        {value}
        {unit && <span>{unit}</span>}
      </div>
      {detail && <div className="result-detail">{detail}</div>}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  min,
  max,
  step = 'any',
  suffix,
  ariaLabel,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  min?: number
  max?: number
  step?: string
  suffix?: string
  ariaLabel?: string
  className?: string
}) {
  return (
    <div className={`input-with-suffix${suffix ? ' has-suffix' : ''}${className ? ` ${className}` : ''}`}>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
      />
      {suffix && <span>{suffix}</span>}
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}

function Notice({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'info' | 'success' }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

function ForwardTab({ initialRecipe, onSave }: { initialRecipe?: Recipe | null; onSave: SaveRecipe }) {
  const [rows, setRows] = useState<ForwardRow[]>(() => initialRecipe?.mode === 'forward' ? forwardRowsFromRecipe(initialRecipe) : initialForwardRows)
  const [autoFractionIndex, setAutoFractionIndex] = useState<number | null>(() => {
    const count = initialRecipe?.mode === 'forward' ? initialRecipe.components.length : initialForwardRows.length
    return count > 1 ? count - 1 : null
  })
  const [result, setResult] = useState<ForwardResult | null>(null)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const manualFractionTotal = rows.reduce((total, row, index) => {
    if (index === autoFractionIndex) return total
    const value = Number(row.fraction)
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)
  const automaticFraction = autoFractionIndex === null || manualFractionTotal > 100
    ? ''
    : String(Number((100 - manualFractionTotal).toFixed(6)))
  const fractionValues = rows.map((row, index) => index === autoFractionIndex ? automaticFraction : row.fraction)
  const totalFraction = autoFractionIndex === null ? manualFractionTotal : manualFractionTotal > 100 ? manualFractionTotal : 100

  function updateRow(index: number, key: keyof ForwardRow, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
    setResult(null)
    setError('')
  }

  function updateFraction(index: number, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, fraction: value } : row))
    if (index === autoFractionIndex && rows.length > 1) setAutoFractionIndex(index === rows.length - 1 ? rows.length - 2 : rows.length - 1)
    setResult(null)
    setError('')
  }

  function addRow() {
    setRows((current) => [...current, { name: '', viscosity: '', fraction: '', price: '', category: 'OTHER' }])
    setAutoFractionIndex((current) => current === null ? rows.length : current)
    setResult(null)
    setError('')
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return
    setRows((current) => current.map((row, rowIndex) => rowIndex === autoFractionIndex ? { ...row, fraction: automaticFraction } : row).filter((_, rowIndex) => rowIndex !== index))
    setAutoFractionIndex((current) => {
      const nextLength = rows.length - 1
      if (nextLength === 1) return null
      if (current === index) return nextLength - 1
      return current !== null && current > index ? current - 1 : current
    })
    setResult(null)
    setError('')
  }

  function calculate() {
    try {
      if (autoFractionIndex !== null && manualFractionTotal > 100) throw new Error('手动比例合计不能超过 100%。')
      const components = rows.map((row, index) => ({
        viscosity: parseValue(row.viscosity, `第${index + 1}行运动粘度`),
        fraction: parseValue(fractionValues[index], `第${index + 1}行比例`) / 100,
        pricePerKg: parseOptionalValue(row.price),
      }))
      const viscosity = blendViscosity(model, components)
      const cost = calculateCost(components)
      setResult({ viscosity, iso: classifyIsoVG(viscosity), cost, rows: rows.map((row, index) => ({ ...row, fraction: fractionValues[index] })) })
      setError('')
    } catch (calculationError) {
      setResult(null)
      setError(errorMessage(calculationError))
    }
  }

  function saveCurrentResult() {
    if (!result) return
    onSave(createRecipe({
      name: defaultRecipeName(),
      mode: 'forward',
      appVersion: defaultAppVersion(),
      viscosityModel: { id: model.id, version: 1 },
      components: toRecipeComponents(result.rows),
      categoryConstraints: [],
      targetViscosity: null,
      targetTolerance: null,
      lockedIndex: null,
      lockedFraction: null,
      optimizationConstraints: null,
      blendViscosity: result.viscosity,
      costPerKg: result.cost.costPerKg,
      costPerTon: result.cost.costPerTon,
      isoVG: result.iso,
    }))
  }

  return (
    <div className="tab-layout">
      <section className="panel input-panel">
        <SectionHeading eyebrow="01 · 配方输入" title="输入原料与比例" description="先完成计算必要字段；成本与类别按需展开。" />
        <div className={`table-shell forward-table${showAdvanced ? ' advanced-open' : ''}`}>
          <table className="component-table">
            <thead>
              <tr>
                <th scope="col">原料</th>
                <th scope="col" className="advanced-cell">类别</th>
                <th scope="col">KV40 <small>mm²/s</small></th>
                <th scope="col">质量分数</th>
                <th scope="col" className="advanced-cell">价格 <small>元/kg，可空</small></th>
                <th scope="col" className="advanced-cell">成本贡献</th>
                <th scope="col" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const fraction = Number(row.fraction)
                const price = Number(row.price)
                const contribution = Number.isFinite(fraction) && Number.isFinite(price) && row.price.trim() !== ''
                  ? (fraction / 100) * price
                  : null
                return (
                  <tr key={index}>
                    <td data-label="原料">
                      <input className="name-input" value={row.name} onChange={(event) => updateRow(index, 'name', event.target.value)} placeholder={`如 原料 ${index + 1}`} aria-label={`第${index + 1}行原料名称`} />
                    </td>
                    <td data-label="类别" className="advanced-cell"><CategorySelect value={row.category} onChange={(value) => updateRow(index, 'category', value)} ariaLabel={`第${index + 1}行原料类别`} /></td>
                    <td data-label="KV40">
                      <TextInput value={row.viscosity} onChange={(value) => updateRow(index, 'viscosity', value)} placeholder={`${[100, 46, 10][index] ?? 46}`} min={0.2000001} ariaLabel={`第${index + 1}行运动粘度`} />
                    </td>
                    <td data-label="质量分数">
                      <TextInput value={fractionValues[index]} onChange={(value) => updateFraction(index, value)} placeholder={`${[25, 50, 25][index] ?? 0}`} min={0} max={100} suffix="%" ariaLabel={`第${index + 1}行质量分数`} className={index === autoFractionIndex ? 'auto-fraction' : ''} />
                    </td>
                    <td data-label="价格" className="advanced-cell">
                      <TextInput value={row.price} onChange={(value) => updateRow(index, 'price', value)} placeholder={`${[8.2, 5.6, 3.8][index] ?? '可空'}`} min={0} suffix="元/kg" ariaLabel={`第${index + 1}行价格`} />
                    </td>
                    <td data-label="成本贡献" className="numeric-cell advanced-cell">{contribution === null ? '—' : `${formatNumber(contribution)} 元/kg`}</td>
                    <td data-label="操作" className="action-cell">
                      <button className="icon-button" type="button" onClick={() => removeRow(index)} disabled={rows.length <= 1} aria-label={`删除第${index + 1}行`}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className={`fraction-total ${Math.abs(totalFraction - 100) < 0.000001 ? 'valid' : ''}`}>
          <span>比例合计</span>
          <strong>{formatNumber(totalFraction)}%</strong>
          <span className="fraction-status">{autoFractionIndex !== null ? manualFractionTotal > 100 ? '手动比例不能超过 100%' : `第${autoFractionIndex + 1}行自动补余量，点击输入可改` : Math.abs(totalFraction - 100) < 0.000001 ? '已满足 100%' : '需要等于 100%'}</span>
        </div>
        <button className="text-button advanced-toggle" type="button" onClick={() => setShowAdvanced((current) => !current)} aria-expanded={showAdvanced}>{showAdvanced ? '收起成本与类别' : '显示成本与类别'}</button>
        <div className="form-actions">
          <button className="button secondary" type="button" onClick={addRow}>添加原料</button>
          <button className="button primary" type="button" onClick={calculate} aria-label="计算调和粘度">计算 KV40 <span>→</span></button>
        </div>
        {error && <Notice>{error}</Notice>}
      </section>

      <section className="panel result-panel">
        <div className="result-heading">
          <div>
            <span className="eyebrow">OUTPUT / KV40</span>
            <h3>调和结果</h3>
          </div>
          <span className="result-state">{result ? 'CALCULATED' : 'WAITING'}</span>
        </div>
        {result ? (
          <>
            <div className="result-grid">
              <ResultCard title="理论调和 KV40" value={formatNumber(result.viscosity)} unit="mm²/s" detail="ASTM D7152 双对数模型" />
              <ResultCard title="成本" value={result.cost.costPerKg === null ? '—' : formatNumber(result.cost.costPerKg)} unit={result.cost.costPerKg === null ? undefined : '元/kg'} tone="green" detail={result.cost.costPerTon === null ? '价格数据不完整' : `${formatNumber(result.cost.costPerTon)} 元/吨`} />
            </div>
            <IsoBadge iso={result.iso} />
            <CategorySummary components={result.rows.map((row) => ({ category: row.category, fraction: Number(row.fraction) / 100 }))} />
            {result.cost.status === 'INCOMPLETE_PRICE_DATA' && <Notice tone="info">已完成粘度计算；成本需要补齐所有原料价格后才能计算。</Notice>}
            <div className="result-actions"><button className="button secondary" type="button" onClick={saveCurrentResult}>保存方案</button></div>
            <div className="breakdown">
              <div className="subheading"><h4>配方成本贡献</h4><span>按原始输入值计算</span></div>
              <div className="breakdown-list">
                {result.rows.map((row, index) => {
                  const fraction = Number(row.fraction) / 100
                  const price = Number(row.price)
                  const contribution = row.price.trim() === '' || !Number.isFinite(price) ? null : fraction * price
                  return (
                    <div className="breakdown-row" key={`${row.name}-${index}`}>
                      <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="breakdown-name">{row.name || `组分 ${index + 1}`}</span>
                      <span>{formatNumber(fraction * 100)}%</span>
                      <strong>{contribution === null ? '—' : `${formatNumber(contribution)} 元/kg`}</strong>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-result"><div className="empty-icon">∑</div><h4>等待计算</h4><p>填写左侧配方并点击计算，结果将显示在这里。</p></div>
        )}
      </section>
    </div>
  )
}

function ReverseTab({ initialRecipe, onSave }: { initialRecipe?: Recipe | null; onSave: SaveRecipe }) {
  const [rows, setRows] = useState<ReverseRow[]>(() => initialRecipe?.mode === 'reverse' ? reverseRowsFromRecipe(initialRecipe) : initialReverseRows)
  const [target, setTarget] = useState(() => initialRecipe?.mode === 'reverse' ? inputNumber(initialRecipe.targetViscosity) : '')
  const [lockedIndex, setLockedIndex] = useState<0 | 1 | 2 | ''>(() => {
    const savedIndex = initialRecipe?.mode === 'reverse' ? initialRecipe.lockedIndex : null
    return savedIndex === 0 || savedIndex === 1 || savedIndex === 2 ? savedIndex : ''
  })
  const [lockedFraction, setLockedFraction] = useState(() => initialRecipe?.mode === 'reverse' ? `${(initialRecipe.lockedFraction ?? 0.2) * 100}` : '')
  const [result, setResult] = useState<ReverseBlendResult | null>(null)
  const [error, setError] = useState('')

  function updateRow(index: number, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, viscosity: value } : row))
    setResult(null)
    setError('')
  }

  function calculate() {
    try {
      if (lockedIndex === '') throw new Error('请选择锁定组分。')
      const viscosities = rows.map((row, index) => parseValue(row.viscosity, `第${index + 1}行运动粘度`)) as [number, number, number]
      const reverseResult = reverseBlend(model, {
        viscosities,
        targetViscosity: parseValue(target, '目标粘度'),
        lockedIndex,
        lockedFraction: parseValue(lockedFraction, '锁定比例') / 100,
      })
      setResult(reverseResult)
      setError('')
    } catch (calculationError) {
      setResult(null)
      setError(errorMessage(calculationError))
    }
  }

  function saveCurrentResult() {
    if (!result || result.status !== 'SUCCESS' || lockedIndex === '') return
    onSave(createRecipe({
      name: defaultRecipeName(),
      mode: 'reverse',
      appVersion: defaultAppVersion(),
      viscosityModel: { id: model.id, version: 1 },
      components: rows.map((row, index) => ({
        id: '',
        name: row.name,
        viscosity: Number(row.viscosity),
        fraction: result.fractions[index],
        pricePerKg: null,
        category: normalizeCategory(row.category),
      })),
      categoryConstraints: [],
      targetViscosity: Number(target),
      targetTolerance: null,
      lockedIndex,
      lockedFraction: Number(lockedFraction) / 100,
      optimizationConstraints: null,
      blendViscosity: result.blendViscosity,
      costPerKg: null,
      costPerTon: null,
      isoVG: classifyIsoVG(result.blendViscosity),
    }))
  }

  const lockedName = lockedIndex === '' ? '锁定组分' : rows[lockedIndex]?.name || `组分 ${lockedIndex + 1}`

  return (
    <div className="tab-layout">
      <section className="panel input-panel">
        <SectionHeading eyebrow="02 / REVERSE SOLVER" title="目标粘度 → 配比" description="固定一个组分及其比例，用解析解反求另外两个组分的比例。" />
        <div className="locked-config">
          <Field label="目标 KV40" hint="mm²/s">
            <TextInput value={target} onChange={(value) => { setTarget(value); setResult(null) }} placeholder="46" min={0.2000001} ariaLabel="目标运动粘度" />
          </Field>
          <Field label="锁定组分">
            <select value={lockedIndex} onChange={(event) => { setLockedIndex(event.target.value === '' ? '' : Number(event.target.value) as 0 | 1 | 2); setResult(null) }} aria-label="锁定组分">
              <option value="" disabled>请选择锁定组分</option>
              {rows.map((row, index) => <option value={index} key={index}>{row.name || `组分 ${index + 1}`}</option>)}
            </select>
          </Field>
          <Field label="锁定比例" hint="wt%">
            <TextInput value={lockedFraction} onChange={(value) => { setLockedFraction(value); setResult(null) }} placeholder="20" min={0} max={100} suffix="%" ariaLabel="锁定比例" />
          </Field>
        </div>
        <div className="table-shell compact-table">
          <table className="component-table">
            <thead><tr><th scope="col">组分</th><th scope="col">类别</th><th scope="col">KV40 <small>mm²/s</small></th><th scope="col">状态</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td data-label="组分"><input className="name-input" value={row.name} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder={`如 组分 ${String.fromCharCode(65 + index)}`} aria-label={`第${index + 1}行组分名称`} /></td>
                  <td data-label="类别"><CategorySelect value={row.category} onChange={(value) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: value } : item))} ariaLabel={`第${index + 1}行组分类别`} /></td>
                  <td data-label="KV40"><TextInput value={row.viscosity} onChange={(value) => updateRow(index, value)} placeholder={`${[10, 50, 100][index]}`} min={0.2000001} ariaLabel={`第${index + 1}行运动粘度`} /></td>
                  <td data-label="状态">{index === lockedIndex ? <span className="lock-chip">锁定 {lockedFraction || '—'}%</span> : <span className="muted">待反求</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions"><button className="button primary" type="button" onClick={calculate}>解析反求配比 <span>→</span></button></div>
        {error && <Notice>{error}</Notice>}
      </section>
      <section className="panel result-panel">
        <div className="result-heading"><div><span className="eyebrow">OUTPUT / SOLUTION</span><h3>反求状态</h3></div><span className="result-state">{result?.status ?? 'WAITING'}</span></div>
        {result ? <ReverseResult result={result} rows={rows} lockedName={lockedName} onSave={saveCurrentResult} /> : <div className="empty-result"><div className="empty-icon">↔</div><h4>等待解析</h4><p>反求仅支持三个组分。输入目标和锁定条件后开始计算。</p></div>}
      </section>
    </div>
  )
}

function ReverseResult({ result, rows, lockedName, onSave }: { result: ReverseBlendResult; rows: ReverseRow[]; lockedName: string; onSave: () => void }) {
  const resultMessage = 'message' in result ? result.message : `已锁定 ${lockedName}，其余比例由解析解得到。`
  return (
    <div className="solution-result">
      <div className={`solution-banner ${result.status === 'SUCCESS' ? 'success' : result.status === 'INFINITE_SOLUTIONS' ? 'info' : 'warning'}`}>
        <span className="status-dot" />
        <div><strong>{result.status === 'SUCCESS' ? '找到可行配方' : result.status === 'INFINITE_SOLUTIONS' ? '存在无穷多组解' : result.status === 'NO_SOLUTION' ? '当前条件无解' : '输入无效'}</strong><p>{resultMessage}</p></div>
      </div>
      {result.feasibleLockedFractionRange && (
        <Notice tone="info">固定比例可行区间：<strong>{formatPercent(result.feasibleLockedFractionRange.min)} ～ {formatPercent(result.feasibleLockedFractionRange.max)}</strong>。该区间由当前三种原料粘度决定。</Notice>
      )}
      {result.status === 'SUCCESS' && (
        <>
          <div className="result-grid single-result"><ResultCard title="反求后调和 KV40" value={formatNumber(result.blendViscosity)} unit="mm²/s" /><ResultCard title="结果" value="可行" tone="green" detail="三组分比例合计 100%" /></div>
          <div className="iso-wrap"><IsoBadge iso={classifyIsoVG(result.blendViscosity)} /></div>
          <CategorySummary components={rows.map((row, index) => ({ category: row.category, fraction: result.fractions[index] }))} />
          <div className="result-actions"><button className="button secondary" type="button" onClick={onSave}>保存方案</button></div>
          <div className="breakdown"><div className="subheading"><h4>反求比例</h4><span>内部按 0～1 计算</span></div><div className="breakdown-list">{result.fractions.map((fraction, index) => <div className="breakdown-row" key={index}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><span className="breakdown-name">{rows[index].name || `组分 ${index + 1}`}</span><span>{index === 0 ? 'A' : index === 1 ? 'B' : 'C'}</span><strong>{formatPercent(fraction)}</strong></div>)}</div></div>
        </>
      )}
    </div>
  )
}

function OptimizationTab({ initialRecipe, onSave }: { initialRecipe?: Recipe | null; onSave: SaveRecipe }) {
  const initialConstraints = initialRecipe?.mode === 'optimize' ? initialRecipe.optimizationConstraints : null
  const [rows, setRows] = useState<OptimizationRow[]>(() => initialRecipe?.mode === 'optimize' ? optimizationRowsFromRecipe(initialRecipe) : initialOptimizationRows)
  const [targetMode, setTargetMode] = useState<TargetMode>(() => initialConstraints?.targetMode ?? 'exact')
  const [exactTarget, setExactTarget] = useState(() => initialRecipe?.mode === 'optimize' ? inputNumber(initialRecipe.targetViscosity) : '')
  const [rangeMin, setRangeMin] = useState(() => inputNumber(initialConstraints?.minViscosity))
  const [rangeMax, setRangeMax] = useState(() => inputNumber(initialConstraints?.maxViscosity))
  const [toleranceCenter, setToleranceCenter] = useState(() => initialRecipe?.mode === 'optimize' ? inputNumber(initialRecipe.targetViscosity) : '')
  const [tolerance, setTolerance] = useState(() => initialRecipe?.mode === 'optimize' ? inputNumber(initialRecipe.targetTolerance) : '')
  const [categoryConstraints, setCategoryConstraints] = useState<CategoryConstraintRow[]>(() => categoryConstraintRowsFromRecipe(initialRecipe))
  const [result, setResult] = useState<OptimizationResult | null>(null)
  const [range, setRange] = useState<{ minimumReachableViscosity: number; maximumReachableViscosity: number } | null>(null)
  const [error, setError] = useState('')

  function updateRow(index: number, key: keyof OptimizationRow, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
    setResult(null)
    setRange(null)
    setError('')
  }

  function updateCategoryConstraint(index: number, key: keyof CategoryConstraintRow, value: string | OilCategory) {
    setCategoryConstraints((current) => current.map((constraint, constraintIndex) => constraintIndex === index ? { ...constraint, [key]: value } : constraint))
    clearOptimizationResult()
  }

  function addCategoryConstraint() {
    const used = new Set(categoryConstraints.map((constraint) => constraint.category))
    const category = OIL_CATEGORIES.find((item) => !used.has(item))
    if (!category) return
    setCategoryConstraints((current) => [...current, { category, minFraction: '', maxFraction: '' }])
    clearOptimizationResult()
  }

  function removeCategoryConstraint(index: number) {
    setCategoryConstraints((current) => current.filter((_, constraintIndex) => constraintIndex !== index))
    clearOptimizationResult()
  }

  function parseCategoryConstraints(): CategoryConstraint[] {
    return categoryConstraints.map((constraint, index) => {
      const minFraction = parseOptionalValue(constraint.minFraction, `第${index + 1}条类别约束最低比例`)
      const maxFraction = parseOptionalValue(constraint.maxFraction, `第${index + 1}条类别约束最高比例`)
      if (minFraction === null && maxFraction === null) throw new Error(`第${index + 1}条类别约束最低或最高至少填写一项。`)
      if (minFraction !== null && (minFraction < 0 || minFraction > 100)) throw new Error(`第${index + 1}条类别约束最低比例必须在0～100%之间。`)
      if (maxFraction !== null && (maxFraction < 0 || maxFraction > 100)) throw new Error(`第${index + 1}条类别约束最高比例必须在0～100%之间。`)
      if (minFraction !== null && maxFraction !== null && minFraction > maxFraction) throw new Error(`第${index + 1}条类别约束最低比例不能大于最高比例。`)
      return {
        category: normalizeCategory(constraint.category),
        minFraction: minFraction === null ? undefined : minFraction / 100,
        maxFraction: maxFraction === null ? undefined : maxFraction / 100,
      }
    })
  }

  function buildTargetRange(): [number, number] {
    if (targetMode === 'exact') {
      const value = parseValue(exactTarget, '目标粘度')
      return [value, value]
    }
    if (targetMode === 'range') {
      const lower = parseValue(rangeMin, '目标下限')
      const upper = parseValue(rangeMax, '目标上限')
      if (lower > upper) throw new Error('目标粘度下限不能大于上限。')
      return [lower, upper]
    }
    const center = parseValue(toleranceCenter, '目标中心粘度')
    const toleranceValue = parseValue(tolerance, '允许偏差')
    if (toleranceValue < 0) throw new Error('允许偏差不能小于0。')
    return [center - toleranceValue, center + toleranceValue]
  }

  function calculate() {
    try {
      const targetRange = buildTargetRange()
      const components = rows.map((row, index) => ({
        viscosity: parseValue(row.viscosity, `第${index + 1}行运动粘度`),
        pricePerKg: parseValue(row.price, `第${index + 1}行价格`),
        category: normalizeCategory(row.category),
        minFraction: parseValue(row.minFraction, `第${index + 1}行最小比例`) / 100,
        maxFraction: parseValue(row.maxFraction, `第${index + 1}行最大比例`) / 100,
      })) as [{ viscosity: number; pricePerKg: number; category: OilCategory; minFraction: number; maxFraction: number }, { viscosity: number; pricePerKg: number; category: OilCategory; minFraction: number; maxFraction: number }, { viscosity: number; pricePerKg: number; category: OilCategory; minFraction: number; maxFraction: number }]
      const reachable = reachableViscosityRange(model, components)
      setRange(reachable)
      const optimizationResult = optimizeBlend(model, { components, minViscosity: targetRange[0], maxViscosity: targetRange[1], categoryConstraints: parseCategoryConstraints() })
      setResult(optimizationResult)
      setError('')
    } catch (calculationError) {
      setResult(null)
      setRange(null)
      setError(errorMessage(calculationError))
    }
  }

  function saveCurrentResult() {
    if (!result || !result.success) return
    const targetRange = buildTargetRange()
    const components = rows.map((row, index) => ({
      id: '',
      name: row.name,
      viscosity: Number(row.viscosity),
      fraction: result.fractions[index],
      pricePerKg: Number(row.price),
      category: normalizeCategory(row.category),
      minFraction: Number(row.minFraction) / 100,
      maxFraction: Number(row.maxFraction) / 100,
    })) as Recipe['components']
    onSave(createRecipe({
      name: defaultRecipeName(),
      mode: 'optimize',
      appVersion: defaultAppVersion(),
      viscosityModel: { id: model.id, version: 1 },
      components,
      categoryConstraints: parseCategoryConstraints(),
      targetViscosity: targetMode === 'tolerance' ? Number(toleranceCenter) : (targetRange[0] + targetRange[1]) / 2,
      targetTolerance: targetMode === 'tolerance' ? Number(tolerance) : null,
      lockedIndex: null,
      lockedFraction: null,
      optimizationConstraints: {
        targetMode,
        minViscosity: targetRange[0],
        maxViscosity: targetRange[1],
        minFractions: components.map((component) => component.minFraction ?? 0) as [number, number, number],
        maxFractions: components.map((component) => component.maxFraction ?? 1) as [number, number, number],
      },
      blendViscosity: result.blendViscosity,
      costPerKg: result.costPerKg,
      costPerTon: result.costPerTon,
      isoVG: classifyIsoVG(result.blendViscosity),
    }))
  }

  function clearOptimizationResult() {
    setResult(null)
    setRange(null)
    setError('')
  }

  const targetInputs = targetMode === 'exact' ? (
    <Field label="目标 KV40" hint="精确值">
      <TextInput value={exactTarget} onChange={(value) => { setExactTarget(value); clearOptimizationResult() }} placeholder="46" min={0.2000001} ariaLabel="精确目标粘度" />
    </Field>
  ) : targetMode === 'range' ? (
    <><Field label="目标下限" hint="mm²/s"><TextInput value={rangeMin} onChange={(value) => { setRangeMin(value); clearOptimizationResult() }} placeholder="40" min={0.2000001} ariaLabel="目标粘度下限" /></Field><Field label="目标上限" hint="mm²/s"><TextInput value={rangeMax} onChange={(value) => { setRangeMax(value); clearOptimizationResult() }} placeholder="52" min={0.2000001} ariaLabel="目标粘度上限" /></Field></>
  ) : (
    <><Field label="目标中心" hint="mm²/s"><TextInput value={toleranceCenter} onChange={(value) => { setToleranceCenter(value); clearOptimizationResult() }} placeholder="46" min={0.2000001} ariaLabel="目标中心粘度" /></Field><Field label="允许偏差" hint="± mm²/s"><TextInput value={tolerance} onChange={(value) => { setTolerance(value); clearOptimizationResult() }} placeholder="6" min={0} ariaLabel="目标允许偏差" /></Field></>
  )

  return (
    <div className="tab-layout optimize-layout">
      <section className="panel input-panel">
        <SectionHeading eyebrow="03 / COST OPTIMIZER" title="最低成本优化" description="在比例上下限与目标粘度约束下，枚举二维可行域顶点寻找最低成本配方。" />
        <div className="table-shell optimization-table">
          <table className="component-table">
            <thead><tr><th scope="col">组分</th><th scope="col">类别</th><th scope="col">KV40 <small>mm²/s</small></th><th scope="col">价格 <small>元/kg</small></th><th scope="col">最小比例</th><th scope="col">最大比例</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index}><td data-label="组分"><input className="name-input" value={row.name} onChange={(event) => updateRow(index, 'name', event.target.value)} placeholder={`如 组分 ${String.fromCharCode(65 + index)}`} aria-label={`第${index + 1}行组分名称`} /></td><td data-label="类别"><CategorySelect value={row.category} onChange={(value) => updateRow(index, 'category', value)} ariaLabel={`第${index + 1}行组分类别`} /></td><td data-label="KV40"><TextInput value={row.viscosity} onChange={(value) => updateRow(index, 'viscosity', value)} placeholder={`${[10, 50, 100][index]}`} min={0.2000001} ariaLabel={`第${index + 1}行运动粘度`} /></td><td data-label="价格"><TextInput value={row.price} onChange={(value) => updateRow(index, 'price', value)} placeholder={`${[3.8, 5.6, 8.2][index]}`} min={0} suffix="元/kg" ariaLabel={`第${index + 1}行价格`} /></td><td data-label="最小比例"><TextInput value={row.minFraction} onChange={(value) => updateRow(index, 'minFraction', value)} placeholder="0" min={0} max={100} suffix="%" ariaLabel={`第${index + 1}行最小比例`} /></td><td data-label="最大比例"><TextInput value={row.maxFraction} onChange={(value) => updateRow(index, 'maxFraction', value)} placeholder="100" min={0} max={100} suffix="%" ariaLabel={`第${index + 1}行最大比例`} /></td></tr>)}</tbody>
          </table>
        </div>
        <div className="category-constraints">
          <div className="subheading"><h4>类别约束</h4><span>同一类别只能设置一条</span></div>
          {categoryConstraints.length === 0 ? <div className="constraint-empty">未设置类别约束，优化将仅使用原料比例上下限。</div> : <div className="constraint-list">{categoryConstraints.map((constraint, index) => <div className="constraint-row" key={`${constraint.category}-${index}`}><CategorySelect value={constraint.category} onChange={(value) => updateCategoryConstraint(index, 'category', value)} usedCategories={categoryConstraints.map((item) => item.category)} ariaLabel={`第${index + 1}条类别约束类别`} /><TextInput value={constraint.minFraction} onChange={(value) => updateCategoryConstraint(index, 'minFraction', value)} min={0} max={100} suffix="%" placeholder="最低" ariaLabel={`第${index + 1}条类别约束最低比例`} /><TextInput value={constraint.maxFraction} onChange={(value) => updateCategoryConstraint(index, 'maxFraction', value)} min={0} max={100} suffix="%" placeholder="最高" ariaLabel={`第${index + 1}条类别约束最高比例`} /><button className="icon-button" type="button" onClick={() => removeCategoryConstraint(index)} aria-label={`删除第${index + 1}条类别约束`}>×</button></div>)}</div>}
          <button className="button secondary add-constraint" type="button" onClick={addCategoryConstraint} disabled={categoryConstraints.length >= OIL_CATEGORIES.length}>＋ 添加类别约束</button>
        </div>
        <div className="target-section">
          <div className="subheading"><h4>目标粘度输入</h4><span>内部转换为粘度上下限</span></div>
          <div className="target-mode" role="radiogroup" aria-label="目标粘度类型">
            <label className={targetMode === 'exact' ? 'selected' : ''}><input type="radio" name="target-mode" checked={targetMode === 'exact'} onChange={() => { setTargetMode('exact'); setResult(null) }} />精确值</label>
            <label className={targetMode === 'range' ? 'selected' : ''}><input type="radio" name="target-mode" checked={targetMode === 'range'} onChange={() => { setTargetMode('range'); setResult(null) }} />范围</label>
            <label className={targetMode === 'tolerance' ? 'selected' : ''}><input type="radio" name="target-mode" checked={targetMode === 'tolerance'} onChange={() => { setTargetMode('tolerance'); setResult(null) }} />± 容差</label>
          </div>
          <div className="target-fields">{targetInputs}</div>
        </div>
        <div className="form-actions"><button className="button primary" type="button" onClick={calculate}>寻找最低成本方案 <span>→</span></button></div>
        {error && <Notice>{error}</Notice>}
      </section>
      <section className="panel result-panel">
        <div className="result-heading"><div><span className="eyebrow">OUTPUT / OPTIMIZATION</span><h3>优化诊断</h3></div><span className="result-state">{result?.success ? 'OPTIMAL' : result ? 'NO SOLUTION' : 'WAITING'}</span></div>
        {result ? <OptimizationResultView result={result} rows={rows} range={range} onSave={saveCurrentResult} /> : <div className="empty-result"><div className="empty-icon">⌁</div><h4>等待优化</h4><p>输入三种原料的价格和比例上下限，系统将返回最低成本顶点。</p></div>}
      </section>
    </div>
  )
}

function OptimizationResultView({ result, rows, range, onSave }: { result: OptimizationResult; rows: OptimizationRow[]; range: { minimumReachableViscosity: number; maximumReachableViscosity: number } | null; onSave: () => void }) {
  const diagnosticRange = result.diagnostics.reachableViscosityRange ?? range
  if (!result.success) {
    return (
      <div className="solution-result">
        {diagnosticRange && <ReachableRange range={diagnosticRange} />}
        <div className="solution-banner warning"><span className="status-dot" /><div><strong>{result.errorCode}</strong><p>{result.message}</p></div></div>
        <div className="diagnostic-list"><div><span>最小比例合计</span><strong>{result.diagnostics.minFractionSum === undefined ? '—' : formatPercent(result.diagnostics.minFractionSum)}</strong></div><div><span>最大比例合计</span><strong>{result.diagnostics.maxFractionSum === undefined ? '—' : formatPercent(result.diagnostics.maxFractionSum)}</strong></div></div>
      </div>
    )
  }
  return (
    <div className="solution-result">
      {diagnosticRange && <ReachableRange range={diagnosticRange} />}
      <div className="result-grid"><ResultCard title="最低成本" value={formatNumber(result.costPerKg)} unit="元/kg" tone="green" detail={`${formatNumber(result.costPerTon)} 元/吨`} /><ResultCard title="配方 KV40" value={formatNumber(result.blendViscosity)} unit="mm²/s" detail={`枚举 ${result.candidateCount} 个候选点`} /></div>
      <IsoBadge iso={classifyIsoVG(result.blendViscosity)} />
      <CategorySummary components={rows.map((row, index) => ({ category: row.category, fraction: result.fractions[index] }))} />
      <div className="result-actions"><button className="button secondary" type="button" onClick={onSave}>保存方案</button></div>
      <div className="solution-banner success"><span className="status-dot" /><div><strong>已找到可行最低成本配方</strong><p>线性成本目标在可行域顶点取得最优值。</p></div></div>
      <div className="breakdown"><div className="subheading"><h4>结果配方</h4><span>活动约束：{result.activeConstraints.length || '无'}</span></div><div className="breakdown-list">{result.fractions.map((fraction, index) => <div className="breakdown-row" key={index}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><span className="breakdown-name">{rows[index].name || `组分 ${index + 1}`}</span><span>{formatNumber(Number(rows[index].viscosity))} mm²/s</span><strong>{formatPercent(fraction)}</strong></div>)}</div></div>
      {result.activeConstraints.length > 0 && <div className="constraint-tags">{result.activeConstraints.map((constraint) => <span key={constraint}>{constraintLabel(constraint)}</span>)}</div>}
      <div className="active-constraint-panel"><div className="subheading"><h4>最优解活动约束</h4><span>命中当前最优顶点</span></div>{(result.diagnostics.activeConstraintDetails?.map((constraint) => constraint.label) ?? result.activeConstraints.map(constraintLabel)).map((label, index) => <div className="active-constraint-row" key={`${label}-${index}`}>{label}</div>)}</div>
    </div>
  )
}

function ReachableRange({ range }: { range: { minimumReachableViscosity: number; maximumReachableViscosity: number } }) {
  return <div className="reachable-range"><span className="range-icon">↔</span><div><span>当前约束下理论可达 KV40</span><strong>{formatNumber(range.minimumReachableViscosity)} ～ {formatNumber(range.maximumReachableViscosity)} <small>mm²/s</small></strong></div></div>
}

function ViSection({ eyebrow, title, fieldA, fieldB, fieldAHint, fieldBHint, resultLabel, resultUnit, resultDigits = 2, compute, placeholderA, placeholderB }: {
  eyebrow: string
  title: string
  fieldA: string
  fieldB: string
  fieldAHint?: string
  fieldBHint?: string
  resultLabel: string
  resultUnit?: string
  resultDigits?: number
  compute: (a: number, b: number) => number
  placeholderA?: string
  placeholderB?: string
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [result, setResult] = useState<number | null>(null)
  const [error, setError] = useState('')

  function clear() {
    setA('')
    setB('')
    setResult(null)
    setError('')
  }

  function calculate() {
    try {
      setResult(compute(parseValue(a, fieldA), parseValue(b, fieldB)))
      setError('')
    } catch (calculationError) {
      setResult(null)
      setError(errorMessage(calculationError))
    }
  }

  return (
    <section className="panel vi-section">
      <div className="vi-section-heading"><span className="eyebrow">{eyebrow}</span><h4>{title}</h4></div>
      <div className="vi-fields">
        <Field label={fieldA} hint={fieldAHint}>
          <TextInput value={a} onChange={(value) => { setA(value); setResult(null); setError('') }} placeholder={placeholderA} ariaLabel={fieldA} />
        </Field>
        <Field label={fieldB} hint={fieldBHint}>
          <TextInput value={b} onChange={(value) => { setB(value); setResult(null); setError('') }} placeholder={placeholderB} ariaLabel={fieldB} />
        </Field>
      </div>
      <div className="form-actions">
        <button className="button primary" type="button" onClick={calculate}>计算 <span>→</span></button>
        <button className="button secondary" type="button" onClick={clear}>清除</button>
      </div>
      <div className="vi-result">
        {error && <Notice>{error}</Notice>}
        {result !== null ? (
          <div className="result-grid single-result">
            <ResultCard title={resultLabel} value={formatNumber(result, resultDigits)} unit={resultUnit} />
          </div>
        ) : (
          !error && <div className="vi-result-empty">输入数值后点击"计算"查看结果</div>
        )}
      </div>
    </section>
  )
}

function ViTab() {
  return (
    <div className="vi-grid">
      <ViSection
        eyebrow="A / VISCOSITY INDEX"
        title="KV40 + KV100 → 粘度指数"
        fieldA="KV40"
        fieldB="KV100"
        fieldAHint="mm²/s"
        fieldBHint="mm²/s"
        resultLabel="粘度指数 VI"
        resultDigits={0}
        compute={(a, b) => viscosityIndex(a, b)}
        placeholderA="73.3"
        placeholderB="8.86"
      />
      <ViSection
        eyebrow="B / KV100 SOLVER"
        title="VI + KV40 → KV100"
        fieldA="粘度指数"
        fieldB="KV40"
        fieldBHint="mm²/s"
        resultLabel="KV100"
        resultUnit="mm²/s"
        compute={(a, b) => kv100FromVI(a, b)}
        placeholderA="128"
        placeholderB="73.3"
      />
      <ViSection
        eyebrow="C / KV40 SOLVER"
        title="VI + KV100 → KV40"
        fieldA="粘度指数"
        fieldB="KV100"
        fieldBHint="mm²/s"
        resultLabel="KV40"
        resultUnit="mm²/s"
        compute={(a, b) => kv40FromVI(a, b)}
        placeholderA="128"
        placeholderB="8.86"
      />
    </div>
  )
}

function modeLabel(mode: Recipe['mode']): string {
  return mode === 'forward' ? '配比→粘度' : mode === 'reverse' ? '目标粘度→配比' : '最低成本优化'
}

function recipeDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function downloadRecipe(recipe: Recipe) {
  const blob = new Blob([recipeToCsv(recipe)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = buildCsvFileName(recipe)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function downloadJsonFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function downloadRecipeJson(recipe: Recipe) {
  downloadJsonFile(`${recipe.name || '配方'}-backup.json`, serializeBackup([recipe]))
}

function downloadAllRecipesJson(recipes: readonly Recipe[]) {
  downloadJsonFile('润滑油配方备份.json', serializeBackup(recipes))
}

function RecipeHistory({
  recipes,
  unreadableCount,
  selectedIds,
  baselineId,
  comparison,
  onSelect,
  onBaseline,
  onCompare,
  onLoad,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
  onExportJson,
  onExportAllJson,
  onImport,
}: {
  recipes: Recipe[]
  unreadableCount: number
  selectedIds: string[]
  baselineId: string
  comparison: ComparisonResult | null
  onSelect: (id: string) => void
  onBaseline: (id: string) => void
  onCompare: () => void
  onLoad: (recipe: Recipe) => void
  onRename: (recipe: Recipe) => void
  onDuplicate: (recipe: Recipe) => void
  onDelete: (recipe: Recipe) => void
  onExport: (recipe: Recipe) => void
  onExportJson: (recipe: Recipe) => void
  onExportAllJson: () => void
  onImport: () => void
}) {
  const tooMany = selectedIds.length > 4
  return (
    <section className="workspace-panel">
      <div className="workspace-heading">
        <div><span className="eyebrow">WORKSPACE / LOCAL</span><h2>我的配方</h2><p>保存在当前浏览器。每条记录独立隔离，加载后可继续编辑和重算。</p></div>
        <div className="backup-actions"><button className="button secondary" type="button" onClick={onImport}>导入 JSON</button><button className="button secondary" type="button" onClick={onExportAllJson} disabled={recipes.length === 0}>全部备份 JSON</button><span className="history-count">{recipes.length} 个方案</span></div>
      </div>
      {unreadableCount > 0 && <Notice tone="info">{unreadableCount}个历史方案无法读取。</Notice>}
      {recipes.length === 0 ? <div className="history-empty">完成一次计算后点击“保存方案”，配方会出现在这里。</div> : (
        <>
          <div className="recipe-list">
            {recipes.map((recipe) => (
              <article className={`recipe-item ${baselineId === recipe.id ? 'baseline' : ''}`} key={recipe.id}>
                <label className="recipe-select"><input type="checkbox" checked={selectedIds.includes(recipe.id)} onChange={() => onSelect(recipe.id)} aria-label={`选择方案 ${recipe.name}`} /><span /></label>
                <button className="recipe-main" type="button" onClick={() => onLoad(recipe)} title="加载到计算页">
                  <strong>{recipe.name}</strong><span>{recipeDate(recipe.updatedAt)} · {modeLabel(recipe.mode)}</span>
                </button>
                <div className="recipe-metrics"><span><small>KV40</small>{formatNumber(recipe.blendViscosity)}</span><span><small>成本/kg</small>{recipe.costPerKg === null ? '—' : formatNumber(recipe.costPerKg)}</span><span><small>ISO VG</small>{recipe.isoVG.matchedGrade === null ? `近 ${recipe.isoVG.nearestGrade}` : recipe.isoVG.matchedGrade}</span></div>
                <div className="recipe-actions"><button type="button" onClick={() => onLoad(recipe)}>载入</button><button type="button" onClick={() => onRename(recipe)}>重命名</button><button type="button" onClick={() => onDuplicate(recipe)}>复制</button><button type="button" onClick={() => onExport(recipe)}>CSV</button><button type="button" onClick={() => onExportJson(recipe)}>JSON</button><button type="button" className="danger-text" onClick={() => onDelete(recipe)}>删除</button></div>
                <button className={`baseline-button ${baselineId === recipe.id ? 'active' : ''}`} type="button" onClick={() => onBaseline(recipe.id)}>{baselineId === recipe.id ? '基准方案' : '设为基准'}</button>
              </article>
            ))}
          </div>
          <div className="compare-toolbar"><span>已选择 {selectedIds.length} / 4 个方案</span>{tooMany && <strong>最多选择 4 个方案，请取消多余选择。</strong>}<button className="button primary" type="button" disabled={selectedIds.length < 2 || tooMany} onClick={onCompare}>打开方案对比 <span>→</span></button></div>
          {comparison && <RecipeComparison result={comparison} />}
        </>
      )}
    </section>
  )
}

function RecipeComparison({ result }: { result: ComparisonResult }) {
  const baselineIndex = result.recipes.findIndex((recipe) => recipe.id === result.baselineId)
  return (
    <div className="comparison-panel">
      <div className="workspace-heading comparison-heading"><div><span className="eyebrow">COMPARISON / DELTA</span><h3>方案对比</h3><p>基准：{result.recipes[baselineIndex]?.name}</p></div></div>
      <div className="comparison-scroll"><table className="comparison-table"><thead><tr><th>指标</th>{result.recipes.map((recipe) => <th key={recipe.id}>{recipe.name}{recipe.id === result.baselineId && <small>基准</small>}</th>)}</tr></thead><tbody>{result.metrics.map((metric) => <tr key={metric.key}><th scope="row">{metric.label}</th>{metric.values.map((value, index) => <td key={result.recipes[index].id}>{value === null ? '不可计算' : metric.key === 'blendViscosity' ? `${formatNumber(value as number)} mm²/s` : metric.key === 'costPerKg' ? `${formatNumber(value as number)} 元/kg` : metric.key === 'costPerTon' ? `${formatNumber(value as number)} 元/t` : value}</td>)}</tr>)}{result.componentRows.map((row) => <tr key={row.key}><th scope="row">{row.label}<small>{CATEGORY_LABELS[normalizeCategory(row.category)]}</small></th>{row.fractions.map((fraction, index) => <td key={result.recipes[index].id}>{formatPercent(fraction)}<small className={row.percentagePointChanges[index] !== null && row.percentagePointChanges[index]! > 0 ? 'positive' : ''}>{index === baselineIndex ? '基准' : `${row.percentagePointChanges[index]! > 0 ? '+' : ''}${formatNumber(row.percentagePointChanges[index] ?? 0)} 个百分点`}</small></td>)}</tr>)}</tbody></table></div>
      <div className="category-summary"><div className="subheading"><h4>类别汇总</h4><span>按各方案原料 category</span></div>{Object.entries(result.categorySummary).map(([category, values]) => <div className="category-row" key={category}><span>{CATEGORY_LABELS[normalizeCategory(category)]}</span>{values.map((value, index) => <strong key={result.recipes[index].id}>{formatPercent(value)}</strong>)}</div>)}</div>
      <div className="saving-grid">{result.recipes.map((recipe) => { const saving = result.savings[recipe.id]; return <div className="saving-card" key={recipe.id}><span>{recipe.name}</span>{saving.calculable && recipe.id !== result.baselineId ? <><strong>{saving.absoluteCostSaving! >= 0 ? '成本降低' : '成本增加'} {formatNumber(Math.abs(saving.absoluteCostSaving!))} 元/kg</strong><small>{saving.costSavingPercent! >= 0 ? '降低' : '增加'} {formatNumber(Math.abs(saving.costSavingPercent!))}% · {formatNumber(Math.abs(saving.costSavingPerTon!))} 元/t</small></> : <small>{recipe.id === result.baselineId ? '基准方案' : '成本不可计算（缺失或基准为0）'}</small>}</div> })}</div>
    </div>
  )
}

function ImportPreview({ parsed, fileName, existingIds, strategy, onStrategyChange, onCancel, onConfirm }: { parsed: ParsedBackup; fileName: string; existingIds: string[]; strategy: ImportConflictStrategy; onStrategyChange: (strategy: ImportConflictStrategy) => void; onCancel: () => void; onConfirm: () => void }) {
  const plan = planImport(parsed, existingIds, strategy)
  return <section className="import-preview" aria-label="导入预览"><div className="subheading"><h4>导入预览</h4><button className="icon-button" type="button" onClick={onCancel} aria-label="关闭导入预览">×</button></div><p className="import-file-name">{fileName}</p><div className="import-stats"><span>可导入 {parsed.recipes.length} 条</span><span>无效 {parsed.failedCount} 条</span>{parsed.migratedCount > 0 && <span>迁移 V1 {parsed.migratedCount} 条</span>}</div><div className="import-names">{parsed.recipes.slice(0, 8).map((recipe) => <span key={`${recipe.id}-${recipe.name}`}>{recipe.name}</span>)}{parsed.recipes.length > 8 && <span>…还有 {parsed.recipes.length - 8} 条</span>}</div><label className="import-strategy"><span>冲突策略</span><select value={strategy} onChange={(event) => onStrategyChange(event.target.value as ImportConflictStrategy)}><option value="duplicate">创建副本（默认）</option><option value="skip">跳过已存在</option><option value="overwrite">覆盖已存在</option></select></label><p className="import-plan">将写入 {plan.toWrite.length} 条；跳过 {plan.skipped} 条；副本 {plan.duplicated} 条；覆盖 {plan.overwritten} 条。</p><div className="form-actions"><button className="button secondary" type="button" onClick={onCancel}>取消</button><button className="button primary" type="button" onClick={onConfirm} disabled={plan.toWrite.length === 0}>确认导入</button></div></section>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('forward')
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [unreadableCount, setUnreadableCount] = useState(0)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [baselineId, setBaselineId] = useState('')
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [loadedRecipe, setLoadedRecipe] = useState<Recipe | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [importPreview, setImportPreview] = useState<{ fileName: string; parsed: ParsedBackup; strategy: ImportConflictStrategy } | null>(null)
  const [importReport, setImportReport] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)

  function refreshRecipes() {
    const loaded = listRecipes()
    setRecipes(loaded.recipes)
    setUnreadableCount(loaded.unreadableCount)
    setSelectedIds((current) => current.filter((id) => loaded.recipes.some((recipe) => recipe.id === id)))
    setBaselineId((current) => current && loaded.recipes.some((recipe) => recipe.id === current) ? current : loaded.recipes[0]?.id ?? '')
  }

  useEffect(() => { refreshRecipes() }, [])

  function saveFromTab(recipe: Recipe) {
    const name = window.prompt('方案名称', recipe.name)
    if (name === null) return
    try {
      saveRecipe({ ...recipe, name: name.trim() || recipe.name }, undefined)
      refreshRecipes()
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function loadRecipe(recipe: Recipe) {
    setLoadedRecipe(recipe)
    setTab(recipe.mode)
    setLoadNonce((value) => value + 1)
  }

  function selectRecipe(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    setComparison(null)
  }

  function setBaseline(id: string) {
    setBaselineId(id)
    setComparison(null)
  }

  function openComparison() {
    if (selectedIds.length < 2 || selectedIds.length > 4) return
    const selected = recipes.filter((recipe) => selectedIds.includes(recipe.id))
    try {
      setComparison(compareRecipes(selected, selectedIds.includes(baselineId) ? baselineId : selected[0]?.id))
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function renameStored(recipe: Recipe) {
    const name = window.prompt('新的方案名称', recipe.name)
    if (name === null || !name.trim()) return
    try { renameStoredRecipe(recipe.id, name, undefined); refreshRecipes() } catch (error) { window.alert(errorMessage(error)) }
  }

  function duplicateStored(recipe: Recipe) {
    try { duplicateStoredRecipe(recipe.id, undefined, undefined); refreshRecipes() } catch (error) { window.alert(errorMessage(error)) }
  }

  function deleteStored(recipe: Recipe) {
    if (!window.confirm(`确定删除“${recipe.name}”吗？此操作不可撤销。`)) return
    try {
      deleteRecipe(recipe.id)
      refreshRecipes()
      setComparison(null)
    } catch (error) {
      window.alert(errorMessage(error))
    }
  }

  function openImportPicker() {
    importInputRef.current?.click()
  }

  async function readImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      window.alert('文件超过大小限制（5 MB）。')
      return
    }
    const parsed = parseBackup(await file.text(), IMPORT_LIMITS)
    if (parsed.error) {
      window.alert(parsed.error)
      return
    }
    setImportReport('')
    setImportPreview({ fileName: file.name, parsed, strategy: 'duplicate' })
  }

  function confirmImport() {
    if (!importPreview) return
    const plan = planImport(importPreview.parsed, recipes.map((recipe) => recipe.id), importPreview.strategy)
    let saved = 0
    let saveFailed = 0
    for (const recipe of plan.toWrite) {
      try { saveRecipe(recipe, undefined); saved += 1 } catch { saveFailed += 1 }
    }
    setImportPreview(null)
    setImportReport(`导入完成：成功 ${saved} 条，跳过 ${plan.skipped} 条，副本 ${plan.duplicated} 条，覆盖 ${plan.overwritten} 条，失败 ${plan.failed + saveFailed} 条；自动迁移：${importPreview.parsed.migratedCount}。`)
    refreshRecipes()
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <img className="brand-logo" src={logo} alt="中科润美 LUBEMATER" />
        <div className="brand-copy"><p className="kicker">LUBEMATER · FORMULATION LAB</p><h1>多组分粘度调和计算</h1></div>
        <div className="header-meta"><span className="model-chip"><strong>KV40</strong> 理论调和</span><span className="version-chip">模型 v1.1</span></div>
      </header>
      <details className="assumption-panel"><summary>计算假设与限制</summary><p>当前采用 ASTM D7152（Refutas）双对数调和粘度模型进行理论预测，即对组分粘度作 log10(log10(ν+0.8)) 变换后按比例加权平均。计算结果供配方设计参考，实际粘度以实验检测为准。</p></details>
      <main>
        <nav className="tabs" aria-label="计算模式">
          <button className={tab === 'forward' ? 'active' : ''} type="button" onClick={() => setTab('forward')}><strong>配比 → 粘度</strong><small>01</small></button>
          <button className={tab === 'reverse' ? 'active' : ''} type="button" onClick={() => setTab('reverse')}><strong>目标粘度 → 配比</strong><small>02</small></button>
          <button className={tab === 'optimize' ? 'active' : ''} type="button" onClick={() => setTab('optimize')}><strong>最低成本优化</strong><small>03</small></button>
          <button className={tab === 'vi' ? 'active' : ''} type="button" onClick={() => setTab('vi')}><strong>粘度指数计算</strong><small>04</small></button>
        </nav>
        <div style={{ display: tab === 'forward' ? undefined : 'none' }}><ForwardTab key={`forward-${loadNonce}`} initialRecipe={loadedRecipe?.mode === 'forward' ? loadedRecipe : null} onSave={saveFromTab} /></div>
        <div style={{ display: tab === 'reverse' ? undefined : 'none' }}><ReverseTab key={`reverse-${loadNonce}`} initialRecipe={loadedRecipe?.mode === 'reverse' ? loadedRecipe : null} onSave={saveFromTab} /></div>
        <div style={{ display: tab === 'optimize' ? undefined : 'none' }}><OptimizationTab key={`optimize-${loadNonce}`} initialRecipe={loadedRecipe?.mode === 'optimize' ? loadedRecipe : null} onSave={saveFromTab} /></div>
        <div style={{ display: tab === 'vi' ? undefined : 'none' }}><ViTab /></div>
        {tab !== 'vi' && <RecipeHistory recipes={recipes} unreadableCount={unreadableCount} selectedIds={selectedIds} baselineId={baselineId} comparison={comparison} onSelect={selectRecipe} onBaseline={setBaseline} onCompare={openComparison} onLoad={loadRecipe} onRename={renameStored} onDuplicate={duplicateStored} onDelete={deleteStored} onExport={downloadRecipe} onExportJson={downloadRecipeJson} onExportAllJson={() => downloadAllRecipesJson(recipes)} onImport={openImportPicker} />}
        <input ref={importInputRef} type="file" accept=".json,application/json" onChange={readImportFile} hidden />
        {importPreview && <ImportPreview parsed={importPreview.parsed} fileName={importPreview.fileName} existingIds={recipes.map((recipe) => recipe.id)} strategy={importPreview.strategy} onStrategyChange={(strategy) => setImportPreview((current) => current ? { ...current, strategy } : current)} onCancel={() => setImportPreview(null)} onConfirm={confirmImport} />}
        {importReport && <Notice tone="success">{importReport}</Notice>}
      </main>
      <footer className="app-footer"><span>理论预测工具 · KV40</span><span>计算值保持完整精度，界面显示保留 2 位小数</span></footer>
    </div>
  )
}
