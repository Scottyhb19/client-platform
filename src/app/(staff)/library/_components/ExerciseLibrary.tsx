'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { MoreHorizontal, Play, Search } from 'lucide-react'

export type LibraryExercise = {
  id: string
  name: string
  movement_pattern_id: string | null
  movement_pattern_name: string | null
  default_sets: number | null
  default_reps: string | null
  default_metric: string | null
  default_metric_value: string | null
  default_rpe: number | null
  usage_count: number
  video_url: string | null
  tag_ids: string[]
  tag_names: string[]
}

export type Pattern = { id: string; name: string }
export type Tag = { id: string; name: string }

interface ExerciseLibraryProps {
  exercises: LibraryExercise[]
  patterns: Pattern[]
  tags: Tag[]
}

export function ExerciseLibrary({
  exercises,
  patterns,
  tags,
}: ExerciseLibraryProps) {
  const [query, setQuery] = useState('')
  const [patternId, setPatternId] = useState<string | null>(null)
  const [tagId, setTagId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return exercises.filter((e) => {
      if (patternId && e.movement_pattern_id !== patternId) return false
      if (tagId && !e.tag_ids.includes(tagId)) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q)
    })
  }, [exercises, query, patternId, tagId])

  return (
    <>
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search
          size={16}
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: 11,
            color: 'var(--color-muted)',
          }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises by name…"
          aria-label="Search exercises"
          style={{
            width: '100%',
            height: 38,
            padding: '0 12px 0 36px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 7,
            background: '#fff',
            fontFamily: 'var(--font-sans)',
            fontSize: '.86rem',
            outline: 'none',
            color: 'var(--color-text)',
          }}
        />
      </div>

      {/* Pattern chips */}
      {patterns.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <button
            type="button"
            className={`chip ${!patternId ? 'on' : ''}`}
            onClick={() => setPatternId(null)}
          >
            All patterns
          </button>
          {patterns.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${patternId === p.id ? 'on' : ''}`}
              onClick={() =>
                setPatternId((cur) => (cur === p.id ? null : p.id))
              }
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Tag chips */}
      {tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          {tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagId((cur) => (cur === t.id ? null : t.id))}
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                border: '1px solid var(--color-border-subtle)',
                background:
                  tagId === t.id ? 'rgba(45,178,76,.1)' : '#fff',
                color:
                  tagId === t.id
                    ? 'var(--color-primary)'
                    : 'var(--color-text-light)',
                fontSize: '.74rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              #{t.name}
            </button>
          ))}
        </div>
      )}

      {exercises.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '28px',
            textAlign: 'center',
            color: 'var(--color-text-light)',
            fontSize: '.88rem',
          }}
        >
          No exercises match your search. Try clearing filters.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}
        >
          {filtered.map((e) => (
            <ExerciseCard key={e.id} exercise={e} />
          ))}
        </div>
      )}
    </>
  )
}

function ExerciseCard({ exercise: e }: { exercise: LibraryExercise }) {
  const hasVideo = !!e.video_url

  return (
    <article
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '100px 1fr',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          background: 'var(--color-primary)',
          display: 'grid',
          placeItems: 'center',
          color: 'rgba(255,255,255,.8)',
          position: 'relative',
          minHeight: 100,
        }}
      >
        <Play
          size={16}
          aria-hidden
          style={{
            background: 'rgba(255,255,255,.9)',
            color: 'var(--color-primary)',
            width: 34,
            height: 34,
            borderRadius: '50%',
            padding: 9,
          }}
        />
        {!hasVideo && (
          <span
            style={{
              position: 'absolute',
              bottom: 8,
              left: 10,
              fontSize: '.6rem',
              color: 'rgba(255,255,255,.55)',
              fontFamily: 'var(--font-display)',
              letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}
          >
            No video
          </span>
        )}
      </div>

      <div style={{ padding: '14px 18px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.05rem',
                color: 'var(--color-charcoal)',
                lineHeight: 1.2,
              }}
            >
              {e.name}
            </div>
            <div
              style={{
                fontSize: '.72rem',
                color: 'var(--color-muted)',
                marginTop: 2,
              }}
            >
              {e.movement_pattern_name ?? 'Unclassified'}
              {e.usage_count > 0 && ` · used ${e.usage_count}×`}
            </div>
          </div>
          <MoreHorizontal
            size={16}
            aria-hidden
            style={{ color: 'var(--color-muted)', flexShrink: 0 }}
          />
        </div>

        {(e.default_sets || e.default_reps || e.default_metric_value) && (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              marginTop: 10,
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.8rem',
              color: 'var(--color-primary)',
              flexWrap: 'wrap',
            }}
          >
            {e.default_sets && e.default_reps && (
              <span>
                {e.default_sets} × {e.default_reps}
              </span>
            )}
            {e.default_metric_value && (
              <>
                <span style={{ color: '#C7BEB4' }}>·</span>
                <span>{e.default_metric_value}</span>
              </>
            )}
            {e.default_rpe && (
              <>
                <span style={{ color: '#C7BEB4' }}>·</span>
                <span>RPE {e.default_rpe}</span>
              </>
            )}
          </div>
        )}

        {e.tag_names.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              marginTop: 8,
            }}
          >
            {e.tag_names.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: '.64rem',
                  fontWeight: 600,
                  color: 'var(--color-text-light)',
                  background: '#F5F0EA',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function EmptyState() {
  return (
    <div
      className="card"
      style={{
        padding: '44px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.2rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        Your library is empty
      </div>
      <p
        style={{
          fontSize: '.9rem',
          margin: '0 auto 18px',
          lineHeight: 1.6,
          maxWidth: 420,
        }}
      >
        Add exercises with defaults (sets, reps, load, RPE) + optional
        YouTube links + tags. They become the building blocks of every
        program and session.
      </p>
      <Link href="/library/new" className="btn primary">
        Create your first exercise
      </Link>
    </div>
  )
}
