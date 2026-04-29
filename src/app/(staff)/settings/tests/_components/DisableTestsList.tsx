'use client'

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CatalogCategory } from '@/lib/testing'
import { setTestEnabledAction } from '../actions'

const STORAGE_KEY = 'settings.tests.disable.openCategories.v1'

interface Props {
  schemaCatalog: CatalogCategory[]
  disabled: string[]
}

export function DisableTestsList({ schemaCatalog, disabled }: Props) {
  const [disabledSet, setDisabledSet] = useState<Set<string>>(
    () => new Set(disabled),
  )
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)
  const [, startTransition] = useTransition()

  // Hydrate openCats from localStorage. Separate key from the override
  // editor so the two surfaces have independent state.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setOpenCats(new Set(arr))
      }
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...openCats]))
    } catch {
      // ignore
    }
  }, [openCats, hydrated])

  function toggleCat(catId: string) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  // Optimistic toggle: flip local state, fire server action, rollback on error.
  async function toggleTest(testId: string) {
    const wasDisabled = disabledSet.has(testId)
    const willBeEnabled = wasDisabled // toggling: if disabled, will become enabled

    setDisabledSet((prev) => {
      const next = new Set(prev)
      if (willBeEnabled) next.delete(testId)
      else next.add(testId)
      return next
    })

    startTransition(async () => {
      const res = await setTestEnabledAction(testId, willBeEnabled)
      if (res.error) {
        setDisabledSet((prev) => {
          const next = new Set(prev)
          if (wasDisabled) next.add(testId)
          else next.delete(testId)
          return next
        })
        alert(res.error)
      }
    })
  }

  return (
    <div style={{ padding: '14px 22px 18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {schemaCatalog.map((cat) => {
          const disabledCount = countDisabledIn(cat, disabledSet)
          const open = openCats.has(cat.id)
          return (
            <div
              key={cat.id}
              style={{
                background: '#fff',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => toggleCat(cat.id)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'transparent',
                  border: 'none',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '.95rem',
                  }}
                >
                  {open ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  {cat.name}
                </span>
                <span
                  style={{
                    fontSize: '.74rem',
                    color: disabledCount
                      ? 'var(--color-alert)'
                      : 'var(--color-text-light)',
                    fontWeight: disabledCount ? 600 : 500,
                  }}
                >
                  {disabledCount
                    ? `${disabledCount} disabled`
                    : 'all enabled'}
                </span>
              </button>

              {open && (
                <div
                  style={{
                    borderTop: '1px solid var(--color-border-subtle)',
                    padding: '14px 16px',
                    background: 'var(--color-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  {cat.subcategories.map((sub) => (
                    <div key={sub.id}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          fontSize: '.72rem',
                          textTransform: 'uppercase',
                          letterSpacing: '.06em',
                          color: 'var(--color-muted)',
                          marginBottom: 6,
                        }}
                      >
                        {sub.name}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        {sub.tests.map((test) => {
                          const isDisabled = disabledSet.has(test.id)
                          return (
                            <div
                              key={test.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 10,
                                padding: '8px 12px',
                                background: '#fff',
                                border: '1px solid var(--color-border-subtle)',
                                borderRadius: 8,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 600,
                                    fontSize: '.88rem',
                                    color: 'var(--color-charcoal)',
                                    opacity: isDisabled ? 0.55 : 1,
                                  }}
                                >
                                  {test.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: '.7rem',
                                    color: 'var(--color-text-light)',
                                    marginTop: 2,
                                  }}
                                >
                                  {test.metrics.length} metric
                                  {test.metrics.length === 1 ? '' : 's'} ·{' '}
                                  <code style={{ fontSize: '.7rem' }}>
                                    {test.id}
                                  </code>
                                </div>
                              </div>
                              <ToggleButton
                                enabled={!isDisabled}
                                onClick={() => toggleTest(test.id)}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ToggleButton({
  enabled,
  onClick,
}: {
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        border: enabled
          ? '1px solid var(--color-primary)'
          : '1px solid var(--color-border-subtle)',
        borderRadius: 999,
        background: enabled ? 'var(--color-primary)' : '#fff',
        color: enabled ? '#fff' : 'var(--color-text-light)',
        fontSize: '.74rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: enabled ? 'var(--color-accent)' : 'var(--color-alert)',
        }}
      />
      {enabled ? 'Enabled' : 'Disabled'}
    </button>
  )
}

function countDisabledIn(
  cat: CatalogCategory,
  disabledSet: ReadonlySet<string>,
): number {
  let n = 0
  for (const sub of cat.subcategories) {
    for (const test of sub.tests) {
      if (disabledSet.has(test.id)) n++
    }
  }
  return n
}
