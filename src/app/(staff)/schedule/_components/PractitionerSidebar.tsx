'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Users, X } from 'lucide-react'

export type StaffMember = {
  user_id: string
  first_name: string
  last_name: string
  is_me: boolean
}

/**
 * Right-edge collapsible panel listing all practitioners in the org.
 * Checking a box adds that practitioner's appointments to the schedule
 * via the `?staff=id1,id2` URL param. The sidebar hides itself when
 * there is only one staff member (solo-practitioner orgs).
 */
export function PractitionerSidebar({
  staff,
  selectedStaffIds,
}: {
  staff: StaffMember[]
  selectedStaffIds: string[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  if (staff.length === 0) return null

  function toggleStaff(id: string) {
    const current = new Set(selectedStaffIds)
    if (current.has(id)) {
      current.delete(id)
    } else {
      current.add(id)
    }
    // At least one must stay selected — fall back to "me" if empty.
    if (current.size === 0) {
      const me = staff.find((s) => s.is_me)
      if (me) current.add(me.user_id)
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set('staff', Array.from(current).join(','))
    router.push(`/schedule?${params.toString()}`)
  }

  return (
    <>
      {/* Collapsed: vertical tab on the right edge */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Show practitioners"
          style={{
            position: 'absolute',
            top: 120,
            right: 0,
            background: 'var(--color-card)',
            border: '1px solid var(--color-border-subtle)',
            borderRight: 'none',
            borderRadius: '8px 0 0 8px',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            color: 'var(--color-text-light)',
            zIndex: 20,
            boxShadow: '-2px 2px 6px rgba(0,0,0,.04)',
          }}
        >
          <Users size={14} aria-hidden />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.6rem',
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: 'var(--color-charcoal)',
            }}
          >
            Practitioners
          </span>
        </button>
      )}

      {/* Expanded: overlay panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 260,
            background: 'var(--color-card)',
            borderLeft: '1px solid var(--color-border-subtle)',
            boxShadow: '-6px 0 18px rgba(0,0,0,.06)',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={14} aria-hidden />
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '.95rem',
                  color: 'var(--color-charcoal)',
                }}
              >
                Practitioners
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-muted)',
                padding: 4,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          <div
            style={{
              padding: 12,
              display: 'grid',
              gap: 4,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontSize: '.7rem',
                color: 'var(--color-muted)',
                padding: '4px 8px 10px',
                lineHeight: 1.4,
              }}
            >
              Select who you'd like to see on the calendar.
            </div>
            {staff.map((s) => {
              const checked = selectedStaffIds.includes(s.user_id)
              return (
                <label
                  key={s.user_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    background: checked
                      ? 'rgba(45,178,76,0.08)'
                      : 'transparent',
                    transition: 'background 120ms',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStaff(s.user_id)}
                    style={{
                      accentColor: 'var(--color-accent)',
                      width: 14,
                      height: 14,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      fontSize: '.86rem',
                      color: 'var(--color-text)',
                      fontWeight: s.is_me ? 600 : 500,
                    }}
                  >
                    {s.first_name} {s.last_name}
                  </span>
                  {s.is_me && (
                    <span
                      style={{
                        fontSize: '.6rem',
                        fontWeight: 700,
                        color: 'var(--color-accent)',
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Me
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
