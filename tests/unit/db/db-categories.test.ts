import { describe, it, expect } from 'vitest'
import { DB_CATEGORY, DB_CATEGORY_LABELS, DatabaseCategory, DatabaseType } from '../../../src/renderer/src/types'

describe('DB_CATEGORY mapping', () => {
  it('assigns every DatabaseType to a category', () => {
    const allTypes: DatabaseType[] = [
      'mysql', 'mariadb', 'postgres', 'sqlite', 'mssql', 'cockroachdb', 'oracle',
      'mongodb', 'elasticsearch',
      'redis',
      'cassandra',
      'influxdb',
      'neo4j',
      'clickhouse', 'snowflake'
    ]
    for (const type of allTypes) {
      expect(DB_CATEGORY[type], `${type} must have a category`).toBeDefined()
    }
  })

  it('categorizes relational SQL databases correctly', () => {
    const relational: DatabaseType[] = ['mysql', 'mariadb', 'postgres', 'sqlite', 'mssql', 'cockroachdb', 'oracle']
    for (const type of relational) {
      expect(DB_CATEGORY[type]).toBe('relational')
    }
  })

  it('categorizes document NoSQL databases correctly', () => {
    expect(DB_CATEGORY['mongodb']).toBe('document')
    expect(DB_CATEGORY['elasticsearch']).toBe('document')
  })

  it('categorizes key-value databases correctly', () => {
    expect(DB_CATEGORY['redis']).toBe('key-value')
  })

  it('categorizes wide-column databases correctly', () => {
    expect(DB_CATEGORY['cassandra']).toBe('wide-column')
  })

  it('categorizes time-series databases correctly', () => {
    expect(DB_CATEGORY['influxdb']).toBe('time-series')
  })

  it('categorizes graph databases correctly', () => {
    expect(DB_CATEGORY['neo4j']).toBe('graph')
  })

  it('categorizes cloud data warehouse databases correctly', () => {
    expect(DB_CATEGORY['clickhouse']).toBe('cloud-warehouse')
    expect(DB_CATEGORY['snowflake']).toBe('cloud-warehouse')
  })
})

describe('DB_CATEGORY_LABELS', () => {
  const categories: DatabaseCategory[] = [
    'relational',
    'document',
    'key-value',
    'wide-column',
    'time-series',
    'graph',
    'cloud-warehouse'
  ]

  it('has a human-readable label for every category', () => {
    for (const cat of categories) {
      expect(DB_CATEGORY_LABELS[cat], `${cat} must have a label`).toBeTruthy()
    }
  })

  it('returns correct label for relational', () => {
    expect(DB_CATEGORY_LABELS['relational']).toBe('Relational SQL')
  })

  it('returns correct label for time-series', () => {
    expect(DB_CATEGORY_LABELS['time-series']).toBe('Time-Series')
  })

  it('returns correct label for graph', () => {
    expect(DB_CATEGORY_LABELS['graph']).toBe('Graph')
  })

  it('returns correct label for cloud-warehouse', () => {
    expect(DB_CATEGORY_LABELS['cloud-warehouse']).toBe('Cloud Data Warehouse')
  })
})
