import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../hooks/useTranslation'

interface Props {
  onClose: () => void
}

type TabId = 'basics' | 'modify' | 'joins' | 'aggregation' | 'advanced'

const TABS: { id: TabId; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'modify', label: 'Modify Data' },
  { id: 'joins', label: 'JOINs' },
  { id: 'aggregation', label: 'Aggregation' },
  { id: 'advanced', label: 'Advanced' },
]

function CodeBlock({ code }: { code: string }): React.JSX.Element {
  return (
    <pre
      style={{
        margin: '6px 0 0',
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--glass-border)',
        background: 'rgba(0,0,0,0.18)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-xs)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.7,
      }}
    >
      {code}
    </pre>
  )
}

function Tip({ title, description, code }: { title: string; description: string; code?: string }): React.JSX.Element {
  return (
    <div
      style={{
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--glass-border)',
        background: 'var(--surface-elevated)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{description}</div>
      {code && <CodeBlock code={code} />}
    </div>
  )
}

/** Visual diagram for JOIN types using styled boxes */
function JoinDiagram({ type }: { type: 'inner' | 'left' | 'right' | 'full' }): React.JSX.Element {
  const accentBlue = 'var(--accent)'
  const accentOrange = '#e07b39'

  const leftFill = type === 'inner' ? 'transparent' : type === 'left' || type === 'full' ? 'color-mix(in srgb, var(--accent) 25%, transparent)' : 'transparent'
  const rightFill = type === 'inner' ? 'transparent' : type === 'right' || type === 'full' ? 'color-mix(in srgb, #e07b39 25%, transparent)' : 'transparent'
  const centerFill = 'color-mix(in srgb, #8b5cf6 30%, transparent)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        height: 52,
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Left circle */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: `2px solid ${accentBlue}`,
          background: leftFill,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        A
      </div>
      {/* Center overlap */}
      <div
        style={{
          width: 24,
          height: 52,
          background: centerFill,
          marginLeft: -12,
          marginRight: -12,
          zIndex: 0,
          flexShrink: 0,
        }}
      />
      {/* Right circle */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: `2px solid ${accentOrange}`,
          background: rightFill,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingRight: 6,
          fontSize: 10,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        B
      </div>
    </div>
  )
}

function BasicsTab(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Tip
        title="SELECT – Read data"
        description="Retrieve columns from a table. Use * to select all columns."
        code={`SELECT id, name, email\nFROM users\nWHERE active = 1\nORDER BY name ASC\nLIMIT 50;`}
      />
      <Tip
        title="WHERE – Filter rows"
        description="Filter rows with conditions. Combine with AND / OR. Use LIKE for pattern matching."
        code={`SELECT * FROM orders\nWHERE status = 'pending'\n  AND amount > 100\n  AND customer_name LIKE 'A%';`}
      />
      <Tip
        title="ORDER BY – Sort results"
        description="Sort rows ascending (ASC) or descending (DESC). You can sort by multiple columns."
        code={`SELECT * FROM products\nORDER BY price DESC, name ASC;`}
      />
      <Tip
        title="LIMIT / TOP – Restrict row count"
        description="LIMIT (MySQL, PostgreSQL, SQLite) or TOP (SQL Server) caps how many rows are returned."
        code={`-- MySQL / PostgreSQL / SQLite\nSELECT * FROM logs ORDER BY created_at DESC LIMIT 10;\n\n-- SQL Server\nSELECT TOP 10 * FROM logs ORDER BY created_at DESC;`}
      />
      <Tip
        title="DISTINCT – Remove duplicates"
        description="Return only unique values in a column."
        code={`SELECT DISTINCT country FROM customers;`}
      />
      <Tip
        title="ALIAS – Rename columns or tables"
        description="Use AS to give a readable name to a column or table reference."
        code={`SELECT u.id, u.name AS full_name, o.total AS order_total\nFROM users AS u\nJOIN orders AS o ON o.user_id = u.id;`}
      />
    </div>
  )
}

function ModifyTab(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Tip
        title="INSERT – Add rows"
        description="Insert one or multiple rows into a table."
        code={`-- Single row\nINSERT INTO users (name, email)\nVALUES ('Alice', 'alice@example.com');\n\n-- Multiple rows\nINSERT INTO users (name, email)\nVALUES ('Bob', 'bob@example.com'),\n       ('Carol', 'carol@example.com');`}
      />
      <Tip
        title="UPDATE – Modify rows"
        description="Change column values for rows matching a condition. Always use WHERE or you'll update every row!"
        code={`UPDATE users\nSET email = 'new@example.com',\n    updated_at = NOW()\nWHERE id = 42;`}
      />
      <Tip
        title="DELETE – Remove rows"
        description="Delete rows that match a condition. Without WHERE, this deletes the entire table content."
        code={`DELETE FROM sessions\nWHERE expires_at < NOW();`}
      />
      <div
        style={{
          borderRadius: 'var(--radius-sm)',
          border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
          background: 'color-mix(in srgb, #f59e0b 8%, transparent)',
          padding: '10px 14px',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontWeight: 700, color: '#f59e0b' }}>⚠ Safety tip: </span>
        Before running UPDATE or DELETE, run the same query as a SELECT first to preview affected rows.
        <CodeBlock code={`-- Preview before deleting:\nSELECT * FROM sessions WHERE expires_at < NOW();\n\n-- Then delete:\nDELETE FROM sessions WHERE expires_at < NOW();`} />
      </div>
      <Tip
        title="TRUNCATE – Wipe a table"
        description="Removes all rows instantly (faster than DELETE). Cannot be rolled back in most databases."
        code={`TRUNCATE TABLE temp_logs;`}
      />
    </div>
  )
}

function JoinsTab(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Infographic overview */}
      <div
        style={{
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--glass-border)',
          background: 'var(--surface-elevated)',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', marginBottom: 12 }}>
          JOIN Types at a Glance
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {(
            [
              { type: 'inner', label: 'INNER JOIN', desc: 'Only matching rows from both tables' },
              { type: 'left', label: 'LEFT JOIN', desc: 'All rows from A + matching rows from B' },
              { type: 'right', label: 'RIGHT JOIN', desc: 'All rows from B + matching rows from A' },
              { type: 'full', label: 'FULL JOIN', desc: 'All rows from both tables' },
            ] as const
          ).map(({ type, label, desc }) => (
            <div key={type} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <JoinDiagram type={type} />
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.4 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <Tip
        title="INNER JOIN – Matching rows only"
        description="Returns rows where the join condition is true in both tables."
        code={`SELECT u.name, o.total\nFROM users u\nINNER JOIN orders o ON o.user_id = u.id;`}
      />
      <Tip
        title="LEFT JOIN – All rows from left table"
        description="Returns every row from the left table; NULL for columns from the right table when no match exists."
        code={`SELECT u.name, o.total\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id;\n-- Users with no orders will have NULL in o.total`}
      />
      <Tip
        title="RIGHT JOIN – All rows from right table"
        description="Mirror of LEFT JOIN. All rows from the right table, NULL for unmatched left rows."
        code={`SELECT u.name, o.total\nFROM users u\nRIGHT JOIN orders o ON o.user_id = u.id;`}
      />
      <Tip
        title="FULL OUTER JOIN – All rows from both"
        description="Combines LEFT and RIGHT JOIN. Returns all rows; NULL fills unmatched sides."
        code={`SELECT u.name, o.total\nFROM users u\nFULL OUTER JOIN orders o ON o.user_id = u.id;`}
      />
      <Tip
        title="Joining multiple tables"
        description="Chain as many JOINs as needed. Each ON clause links two tables."
        code={`SELECT o.id, u.name, p.title\nFROM orders o\nJOIN users u ON u.id = o.user_id\nJOIN products p ON p.id = o.product_id\nWHERE o.status = 'shipped';`}
      />
    </div>
  )
}

function AggregationTab(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Function reference */}
      <div
        style={{
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--glass-border)',
          background: 'var(--surface-elevated)',
          padding: '12px 14px',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', marginBottom: 10 }}>
          Aggregate Functions
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { fn: 'COUNT(*)', desc: 'Number of rows' },
            { fn: 'COUNT(col)', desc: 'Non-NULL values' },
            { fn: 'SUM(col)', desc: 'Total of numeric values' },
            { fn: 'AVG(col)', desc: 'Mean of numeric values' },
            { fn: 'MIN(col)', desc: 'Lowest value' },
            { fn: 'MAX(col)', desc: 'Highest value' },
          ].map(({ fn, desc }) => (
            <div key={fn} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <code
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--accent)',
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  borderRadius: 4,
                  padding: '1px 5px',
                  whiteSpace: 'nowrap',
                }}
              >
                {fn}
              </code>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <Tip
        title="GROUP BY – Aggregate per group"
        description="Group rows by a column and apply aggregate functions to each group."
        code={`SELECT country, COUNT(*) AS user_count\nFROM users\nGROUP BY country\nORDER BY user_count DESC;`}
      />
      <Tip
        title="HAVING – Filter groups"
        description="Like WHERE but applied after grouping. Use HAVING to filter on aggregate results."
        code={`SELECT customer_id, SUM(amount) AS total\nFROM orders\nGROUP BY customer_id\nHAVING SUM(amount) > 500\nORDER BY total DESC;`}
      />
      <Tip
        title="WHERE vs HAVING"
        description="WHERE filters rows before grouping; HAVING filters after. They can be combined."
        code={`SELECT status, COUNT(*) AS cnt\nFROM orders\nWHERE created_at >= '2024-01-01'  -- filter rows first\nGROUP BY status\nHAVING COUNT(*) > 10;              -- then filter groups`}
      />
      <Tip
        title="Date aggregation example"
        description="Aggregate data by day, week, or month using date functions."
        code={`-- Daily sales (PostgreSQL)\nSELECT DATE_TRUNC('day', created_at) AS day,\n       SUM(amount) AS daily_total\nFROM orders\nGROUP BY 1\nORDER BY 1 DESC;`}
      />
    </div>
  )
}

function AdvancedTab(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Tip
        title="Subquery – Query inside a query"
        description="A subquery runs first and its result is used by the outer query."
        code={`SELECT name, salary\nFROM employees\nWHERE salary > (\n  SELECT AVG(salary) FROM employees\n);`}
      />
      <Tip
        title="CTE (Common Table Expression)"
        description="WITH lets you name a temporary result set and reference it like a table. Improves readability."
        code={`WITH recent_orders AS (\n  SELECT user_id, COUNT(*) AS cnt\n  FROM orders\n  WHERE created_at > NOW() - INTERVAL '30 days'\n  GROUP BY user_id\n)\nSELECT u.name, r.cnt\nFROM users u\nJOIN recent_orders r ON r.user_id = u.id\nORDER BY r.cnt DESC;`}
      />
      <Tip
        title="Transactions – All or nothing"
        description="Wrap related changes in a transaction so either all succeed or none apply."
        code={`BEGIN;\n\nUPDATE accounts SET balance = balance - 100 WHERE id = 1;\nUPDATE accounts SET balance = balance + 100 WHERE id = 2;\n\nCOMMIT;   -- or ROLLBACK; to undo`}
      />
      <Tip
        title="CASE – Conditional values"
        description="Return different values based on conditions, similar to if/else."
        code={`SELECT name,\n  CASE\n    WHEN score >= 90 THEN 'A'\n    WHEN score >= 75 THEN 'B'\n    WHEN score >= 60 THEN 'C'\n    ELSE 'F'\n  END AS grade\nFROM students;`}
      />
      <Tip
        title="NULL handling"
        description="NULL is not a value – it is the absence of one. Use IS NULL / IS NOT NULL. Use COALESCE to substitute a default."
        code={`-- Find rows with no phone number\nSELECT * FROM users WHERE phone IS NULL;\n\n-- Replace NULL with a default\nSELECT name, COALESCE(phone, 'N/A') AS phone\nFROM users;`}
      />
      <Tip
        title="Index tips"
        description="Indexes speed up lookups but slow down inserts/updates. Add them on columns used in WHERE, JOIN, and ORDER BY."
        code={`-- Create an index\nCREATE INDEX idx_orders_user_id ON orders(user_id);\n\n-- Drop an index\nDROP INDEX idx_orders_user_id;`}
      />
    </div>
  )
}

export function TipsAndTricksModal({ onClose }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabId>('basics')

  if (typeof document === 'undefined' || !document.body) {
    return <></>
  }

  const tabContent: Record<TabId, React.ReactNode> = {
    basics: <BasicsTab />,
    modify: <ModifyTab />,
    joins: <JoinsTab />,
    aggregation: <AggregationTab />,
    advanced: <AdvancedTab />,
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 620, width: '92vw', display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}
      >
        <div className="modal-header">
          <span className="modal-title">{t('tips.title')}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 16px 0',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--font-size-xs)',
                fontWeight: activeTab === tab.id ? 700 : 400,
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
                background: activeTab === tab.id
                  ? 'color-mix(in srgb, var(--accent) 12%, var(--surface-elevated))'
                  : 'transparent',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div
          className="modal-body"
          style={{ overflowY: 'auto', flex: 1, padding: '14px 16px' }}
        >
          {tabContent[activeTab]}
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', flex: 1 }}>
            {t('tips.footer')}
          </span>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
