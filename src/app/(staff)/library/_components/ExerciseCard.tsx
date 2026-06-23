'use client'

import Link from 'next/link'
import { Play } from 'lucide-react'
import type { LibraryExercise } from '../types'
import { CardMenu } from './CardMenu'
import { formatDefaultLoad } from './format'
import { formatVolume } from '@/lib/prescription/volume-units'
import { getYoutubeThumbnailUrl } from './youtube'

interface ExerciseCardProps {
  exercise: LibraryExercise
  /** When provided, the card behaves as a picker (no Link, no CardMenu, no
   *  video tab-out) and invokes onPick(id) when clicked. Used by the
   *  session-builder Library tab. Default behaviour is the standalone
   *  library: media zone opens the demo video in a new tab, body links to
   *  /library/[id], CardMenu (Edit + Delete) anchored top-right. */
  onPick?: (exerciseId: string) => void
  /** Compact list-row sizing for the session-builder's 320px right panel
   *  (G-7 follow-up 2026-06-12): smaller media + fonts, tighter rhythm,
   *  and usage count suppressed (it's library-page signal, not picker
   *  signal). Default false keeps the standalone library card unchanged. */
  dense?: boolean
}

export function ExerciseCard({ exercise: e, onPick, dense = false }: ExerciseCardProps) {
  const isPicker = typeof onPick === 'function'
  const hasVideo = !!e.video_url
  const thumbnailUrl = getYoutubeThumbnailUrl(e.video_url)
  const loadLabel = formatDefaultLoad(e.default_metric_value, e.default_metric)
  const volumeLabel = formatVolume(e.default_reps, e.default_rep_metric)

  const media = (
    <div
      style={{
        background: 'var(--color-primary)',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        height: '100%',
        minHeight: dense ? 64 : 100,
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
      {/* Play renders only when there is actually something to play. */}
      {hasVideo && (
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
      )}
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
  )

  const body = (
    <div
      style={{
        padding: dense ? '10px 12px' : '14px 18px',
        paddingRight: isPicker ? (dense ? 12 : 18) : 44,
        textAlign: 'left',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: dense ? '.92rem' : '1.05rem',
          color: 'var(--color-charcoal)',
          lineHeight: 1.2,
        }}
      >
        {e.name}
      </div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-muted)',
          marginTop: 2,
        }}
      >
        {e.movement_pattern_name ??
          (e.movement_pattern_id ? 'Pattern removed' : 'Unclassified')}
        {/* Usage count is library-page signal; the picker hides it. */}
        {!dense && e.usage_count > 0 && ` · used ${e.usage_count}×`}
      </div>

      {(e.default_sets || volumeLabel || loadLabel) && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            marginTop: dense ? 6 : 10,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: dense ? '.76rem' : '.8rem',
            color: 'var(--color-primary)',
            flexWrap: 'wrap',
          }}
        >
          {e.default_sets && volumeLabel && (
            <span>
              {e.default_sets} × {volumeLabel}
            </span>
          )}
          {loadLabel && (
            <>
              {e.default_sets && volumeLabel && (
                <span style={{ color: 'var(--color-text-faint)' }}>·</span>
              )}
              <span>{loadLabel}</span>
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
            marginTop: dense ? 6 : 8,
          }}
        >
          {e.tag_names.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: 600,
                color: 'var(--color-text-light)',
                background: 'var(--color-surface)',
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
  )

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: dense ? '64px 1fr' : '100px 1fr',
    borderRadius: dense ? 'var(--radius-card-dense)' : 'var(--radius-card)',
    overflow: 'hidden',
  }

  if (isPicker) {
    return (
      <article className="card" style={{ position: 'relative', padding: 0 }}>
        <button
          type="button"
          onClick={() => onPick(e.id)}
          aria-label={`Pick ${e.name}`}
          style={{
            ...gridStyle,
            width: '100%',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          {media}
          {body}
        </button>
      </article>
    )
  }

  // Standalone library: the media zone and the body are sibling targets
  // (an <a> can't nest inside an <a>). Media opens the demo video in a new
  // tab when one exists; the body routes to the edit page; CardMenu floats
  // top-right above both.
  return (
    // Flex column + flex:1 on the inner grid so the media strip fills the
    // full card height. The outer library grid stretches every card in a row
    // to the tallest card; without this, a short card (no tags) next to a
    // tag-heavy one leaves the media strip short with white space below it.
    <article
      className="card card-link"
      style={{
        position: 'relative',
        padding: 0,
        overflow: 'visible',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ ...gridStyle, flex: 1 }}>
        {hasVideo ? (
          <a
            href={e.video_url!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Watch ${e.name} demo video`}
            style={{ display: 'grid' }}
          >
            {media}
          </a>
        ) : (
          media
        )}
        <Link
          href={`/library/${e.id}`}
          aria-label={`Open ${e.name}`}
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          {body}
        </Link>
      </div>
      <div style={{ position: 'absolute', top: 10, right: 10 }}>
        <CardMenu
          exerciseId={e.id}
          exerciseName={e.name}
          usageCount={e.usage_count}
        />
      </div>
    </article>
  )
}
