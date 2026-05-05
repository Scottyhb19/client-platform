'use client'

import Link from 'next/link'
import { Play } from 'lucide-react'
import type { LibraryExercise } from '../types'
import { CardMenu } from './CardMenu'
import { getYoutubeThumbnailUrl } from './youtube'

interface ExerciseCardProps {
  exercise: LibraryExercise
  /** When provided, the card behaves as a picker (no Link, no CardMenu) and
   *  invokes onPick(id) when clicked. Used by the session-builder Library
   *  tab. Default behaviour is the standalone library: Link to /library/[id]
   *  with the CardMenu (Edit + Delete) anchored top-right. */
  onPick?: (exerciseId: string) => void
}

export function ExerciseCard({ exercise: e, onPick }: ExerciseCardProps) {
  const isPicker = typeof onPick === 'function'
  const hasVideo = !!e.video_url
  const thumbnailUrl = getYoutubeThumbnailUrl(e.video_url)

  const body = (
    <>
      <div
        style={{
          background: 'var(--color-primary)',
          display: 'grid',
          placeItems: 'center',
          color: 'rgba(255,255,255,.8)',
          position: 'relative',
          minHeight: 100,
          overflow: 'hidden',
        }}
      >
        {thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.85,
            }}
          />
        )}
        <Play
          size={16}
          aria-hidden
          style={{
            position: 'relative',
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
              fontSize: 'var(--text-2xs)',
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

      <div
        style={{
          padding: '14px 18px',
          paddingRight: isPicker ? 18 : 44,
          textAlign: 'left',
        }}
      >
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
    </>
  )

  const innerStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '100px 1fr',
    color: 'inherit',
    textDecoration: 'none',
    borderRadius: 'var(--radius-card)',
    overflow: 'hidden',
  }

  return (
    <article
      className={`card${isPicker ? '' : ' card-link'}`}
      style={{ position: 'relative', padding: 0, overflow: 'visible' }}
    >
      {isPicker ? (
        <button
          type="button"
          onClick={() => onPick(e.id)}
          aria-label={`Pick ${e.name}`}
          style={{
            ...innerStyle,
            width: '100%',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          {body}
        </button>
      ) : (
        <>
          <Link
            href={`/library/${e.id}`}
            aria-label={`Open ${e.name}`}
            style={innerStyle}
          >
            {body}
          </Link>
          <div style={{ position: 'absolute', top: 10, right: 10 }}>
            <CardMenu
              exerciseId={e.id}
              exerciseName={e.name}
              usageCount={e.usage_count}
            />
          </div>
        </>
      )}
    </article>
  )
}
