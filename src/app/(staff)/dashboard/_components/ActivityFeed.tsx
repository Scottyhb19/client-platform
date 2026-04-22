'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  initialsFor,
  toneFor,
  type AvatarTone,
} from '../../clients/_lib/client-helpers'

export type ActivityBucket = 'note' | 'appointment' | 'flag'

export type ActivityItem = {
  id: string
  bucket: ActivityBucket
  timestamp: string // ISO
  client_id: string
  client_first_name: string
  client_last_name: string
  title: string
  meta: string
  excerpt: string | null
}

type Filter = 'All' | 'Sessions' | 'Notes' | 'Flags'

const FILTERS: Filter[] = ['All', 'Sessions', 'Notes', 'Flags']

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const [filter, setFilter] = useState<Filter>('All')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(() => {
    if (filter === 'All') return items
    const bucketFor: Record<Filter, ActivityBucket | null> = {
      All: null,
      Sessions: 'appointment',
      Notes: 'note',
      Flags: 'flag',
    }
    return items.filter((it) => it.bucket === bucketFor[filter])
  }, [items, filter])

  const shown = showAll ? filtered : filtered.slice(0, 5)

  return (
    <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 22px',
          borderBottom: '1px solid var(--color-border-subtle)',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1rem',
              color: 'var(--color-primary)',
            }}
          >
            Recent activity
          </div>
          <div
            style={{
              fontSize: '.74rem',
              color: 'var(--color-muted)',
              marginTop: 1,
            }}
          >
            {filter === 'All'
              ? 'Sessions, notes and flags across all clients'
              : `${filter} — filtered from all clients`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip ${filter === f ? 'on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div
          style={{
            padding: '28px 22px',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.88rem',
          }}
        >
          {filter === 'All'
            ? 'No activity yet. Booked appointments and clinical notes show up here.'
            : `No ${filter.toLowerCase()} yet.`}
        </div>
      ) : (
        <div>
          {shown.map((a, i) => {
            const isOpen = expandedId === a.id
            const last = i === shown.length - 1
            const toneColor = dotColor(a.bucket)
            return (
              <div
                key={a.id}
                style={{
                  borderBottom: last ? 'none' : '1px solid #F0EBE5',
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isOpen ? null : a.id)
                  }
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '13px 22px',
                    display: 'grid',
                    gridTemplateColumns: 'auto auto 1fr auto auto',
                    gap: 14,
                    alignItems: 'center',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 120ms',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = '#FAF7F2')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: toneColor,
                    }}
                  />
                  <span
                    className={`avatar ${toneFromBucket(a.bucket)}`}
                    style={{ width: 30, height: 30, fontSize: 30 * 0.38 }}
                  >
                    {initialsFor(a.client_first_name, a.client_last_name)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: 'var(--color-charcoal)',
                          fontSize: '.88rem',
                        }}
                      >
                        {a.client_first_name} {a.client_last_name}
                      </span>
                      <span
                        style={{
                          fontSize: '.84rem',
                          color: 'var(--color-text)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {a.title}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '.72rem',
                        color: 'var(--color-muted)',
                        marginTop: 1,
                      }}
                    >
                      {a.meta}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '.72rem',
                      color: 'var(--color-muted)',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600,
                      letterSpacing: '.02em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {relativeTime(a.timestamp)}
                  </span>
                  {isOpen ? (
                    <ChevronUp
                      size={16}
                      aria-hidden
                      style={{ color: 'var(--color-muted)' }}
                    />
                  ) : (
                    <ChevronDown
                      size={16}
                      aria-hidden
                      style={{ color: 'var(--color-muted)' }}
                    />
                  )}
                </button>
                {isOpen && a.excerpt && (
                  <div
                    style={{
                      padding: '0 22px 16px 82px',
                      background: '#FAF7F2',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '.84rem',
                        color: 'var(--color-text)',
                        lineHeight: 1.55,
                        padding: '12px 14px',
                        background: '#fff',
                        borderLeft: `3px solid ${toneColor}`,
                        borderRadius: '0 6px 6px 0',
                        marginTop: -4,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {a.excerpt}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {filtered.length > 5 && (
        <div
          style={{
            padding: '12px 22px',
            background: 'var(--color-surface)',
            textAlign: 'center',
            borderTop: '1px solid var(--color-border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '.78rem',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              color: 'var(--color-text-light)',
              cursor: 'pointer',
            }}
          >
            {showAll ? 'Collapse ↑' : `Load ${filtered.length - 5} more ↓`}
          </button>
        </div>
      )}
    </div>
  )
}

function dotColor(bucket: ActivityBucket): string {
  if (bucket === 'flag') return 'var(--color-alert)'
  if (bucket === 'appointment') return 'var(--color-accent)'
  return 'var(--color-muted)'
}

function toneFromBucket(bucket: ActivityBucket): AvatarTone {
  if (bucket === 'flag') return 'r'
  if (bucket === 'appointment') return 'g'
  return 'n'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}
