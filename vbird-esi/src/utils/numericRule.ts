import type { InspectionItem, NumericRule, NumericClause } from '@/types'

export function isEffectiveValue(val: unknown): boolean {
  return val !== null && val !== undefined && val !== '' && val !== '/'
}

export function parseNumeric(val: unknown): number | null {
  if (!isEffectiveValue(val)) return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

function evalClause(n: number, clause: NumericClause): boolean {
  switch (clause.op) {
    case '>': return n > clause.value
    case '>=': return n >= clause.value
    case '<': return n < clause.value
    case '<=': return n <= clause.value
    case '=': return n === clause.value
    default: return false
  }
}

export function normalizeNumericRule(item: InspectionItem): NumericRule | null {
  if (item.numericRule?.clauses?.length) return item.numericRule
  if (item.numericRange) {
    return {
      clauses: [
        { op: '>=', value: item.numericRange.min, join: 'AND' },
        { op: '<=', value: item.numericRange.max },
      ],
    }
  }
  return null
}

export function evalNumericRule(n: number, rule: NumericRule): boolean {
  const clauses = rule.clauses ?? []
  if (clauses.length === 0) return false

  let acc = evalClause(n, clauses[0])
  for (let i = 1; i < clauses.length; i++) {
    const join = clauses[i - 1].join ?? 'AND'
    const next = evalClause(n, clauses[i])
    acc = join === 'OR' ? (acc || next) : (acc && next)
  }
  return acc
}

export function isPassed(item: InspectionItem, raw: unknown): boolean {
  if (!isEffectiveValue(raw)) return false

  if (item.validationType === 'text') {
    return raw === '符合'
  }

  if (item.validationType === 'numeric') {
    const n = parseNumeric(raw)
    if (n === null) return false
    const rule = normalizeNumericRule(item)
    if (!rule) return false
    return evalNumericRule(n, rule)
  }

  if (item.validationType === 'manual') {
    return true
  }

  return false
}
