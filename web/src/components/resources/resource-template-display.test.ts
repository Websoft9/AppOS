import { describe, expect, it } from 'vitest'
import {
  buildResourceCategoryLabel,
  buildResourceKindLabel,
  buildResourceProductDescription,
  buildResourceProductMeta,
  buildResourceProductTitle,
  isGenericResourceTemplate,
  type ResourceTemplateDisplayShape,
} from './resource-template-display'

type Template = ResourceTemplateDisplayShape

const options = {
  namespace: 'serviceInstances',
  kindLabels: {
    'mysql-compatible': 'MySQL-Compatible',
  },
  categoryLabels: {
    database: 'Databases',
  },
  isGenericTitle: (template: Template, resolvedKindLabel: string) =>
    template.title.trim().toLowerCase() === `standard ${resolvedKindLabel.toLowerCase()}`,
} as const

const translations: Record<string, string> = {
  'serviceInstances.kinds.mysql-compatible': 'MySQL-Compatible',
  'serviceInstances.kinds.unknown': 'Unknown',
  'serviceInstances.categories.database': 'Databases',
  'serviceInstances.categories.other': 'Other',
  'serviceInstances.product.standardTemplate': 'Standard template',
  'serviceInstances.product.profileDescription': '{{vendorPrefix}}{{category}} profile',
}

function t(key: string, values?: Record<string, unknown>) {
  const template = translations[key] ?? key
  return template
    .replace('{{vendorPrefix}}', String(values?.vendorPrefix ?? ''))
    .replace('{{category}}', String(values?.category ?? ''))
}

describe('resource-template-display helpers', () => {
  it('builds localized kind and category labels', () => {
    expect(buildResourceKindLabel<Template>('mysql-compatible', t, options)).toBe(
      'MySQL-Compatible'
    )
    expect(buildResourceCategoryLabel<Template>('database', t, options)).toBe('Databases')
    expect(buildResourceKindLabel<Template>('', t, options)).toBe('Unknown')
  })

  it('detects generic templates and shortens the product title', () => {
    const template: Template = {
      id: 'generic-mysql',
      kind: 'mysql-compatible',
      title: 'Standard MySQL-Compatible',
      category: 'database',
      vendor: 'AWS',
    }

    expect(isGenericResourceTemplate(template, t, options)).toBe(true)
    expect(buildResourceProductTitle(template, t, options)).toBe('MySQL-Compatible')
    expect(buildResourceProductDescription(template, t, options)).toBe('Standard template')
  })

  it('builds metadata and fallback descriptions for vendor-specific templates', () => {
    const template: Template = {
      id: 'aws-rds-mysql',
      kind: 'mysql-compatible',
      title: 'Amazon RDS for MySQL',
      category: 'database',
      vendor: 'AWS',
    }

    expect(isGenericResourceTemplate(template, t, options)).toBe(false)
    expect(buildResourceProductTitle(template, t, options)).toBe('Amazon RDS for MySQL')
    expect(buildResourceProductMeta(template, t, options)).toBe('Databases · AWS')
    expect(buildResourceProductDescription(template, t, options)).toBe('AWS databases profile')
  })
})
