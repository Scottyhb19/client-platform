'use client'

/**
 * Shared Profile-tab UI atoms (profile rework commit 2).
 *
 * - ProfileCard: the card shell for the four Profile sections (Contact,
 *   Medical history, Medications, Goals). Uses the design-system `.card`
 *   class (surface / border / 14px radius / card shadow tokens) — no
 *   hardcoded colour, radius, or shadow. Header is title + optional action.
 *
 * - RowOverflowMenu: progressive disclosure for row actions. No action links
 *   show at rest; a single overflow control reveals on row hover / keyboard
 *   focus, opening a small menu. Fully keyboard accessible (roving focus,
 *   arrows / Home / End / Escape, type-to-open). Only items flagged
 *   tone:'alert' use the red token, and only inside the menu.
 *
 * - ProfileRow: a name (body weight) + optional one-line muted context note,
 *   with the overflow menu revealed on hover / focus-within. Shared by the
 *   Medical history and Medications cards.
 *
 * Reveal is driven by the row's hover + focus-within state (not global CSS),
 * so the control is keyboard-reachable: tabbing onto it sets focus-within,
 * which reveals it; an open menu always holds focus inside the row, so it
 * stays revealed while the mouse is elsewhere.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

/* ============================ ProfileCard ============================ */

export function ProfileCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card" style={{ overflow: 'visible' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-hairline)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.98rem',
            letterSpacing: '.01em',
            color: 'var(--color-text)',
          }}
        >
          {title}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/* ========================== RowOverflowMenu ========================== */

export type OverflowItem = {
  key: string
  label: string
  /** Only 'alert' renders red — reserved for Archive. */
  tone?: 'alert'
  disabled?: boolean
  onSelect: () => void
}

export function RowOverflowMenu({
  ariaLabel,
  items,
  busy = false,
  visible,
}: {
  ariaLabel: string
  items: OverflowItem[]
  busy?: boolean
  /** Revealed by the parent row's hover / focus-within. */
  visible: boolean
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()

  // Close on outside mousedown. The menu closes on item-select BEFORE any
  // ConfirmDialog opens, so the portaled-dialog / outside-click race
  // (project memory portal_dialog_outside_click_conflict) never arises here.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Move DOM focus to the active item whenever the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus()
  }, [open, activeIndex])

  function openMenu(index: number) {
    if (busy || items.length === 0) return
    setActiveIndex(index)
    setOpen(true)
  }

  function closeMenu(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function selectItem(item: OverflowItem) {
    if (item.disabled) return
    // Close first so the menu is unmounted before onSelect opens a dialog.
    setOpen(false)
    item.onSelect()
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu(0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu(items.length - 1)
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + items.length) % items.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(items.length - 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu(true)
    } else if (e.key === 'Tab') {
      // Let focus move on naturally, but dismiss the menu.
      setOpen(false)
    }
  }

  const shown = visible || open

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={triggerRef}
        type="button"
        className="btn ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={busy}
        onClick={() => (open ? closeMenu(false) : openMenu(0))}
        onKeyDown={onTriggerKeyDown}
        style={{
          padding: 4,
          opacity: shown ? 1 : 0,
          // Keep it keyboard-reachable (Tab still focuses an opacity:0 button,
          // which flips `visible` via the row's focus-within); block stray
          // pointer hits while hidden.
          pointerEvents: shown ? 'auto' : 'none',
          transition: 'opacity var(--motion-fast) var(--ease)',
        }}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            minWidth: 168,
            padding: 4,
            background: 'var(--color-card)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-card-dense)',
            boxShadow: '0 8px 24px rgba(35,31,32,.12)',
          }}
        >
          {items.map((item, i) => {
            const isAlert = item.tone === 'alert'
            const isActiveItem = i === activeIndex
            return (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={isActiveItem ? 0 : -1}
                disabled={item.disabled}
                onClick={() => selectItem(item)}
                onMouseEnter={() => setActiveIndex(i)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  border: 'none',
                  borderRadius: 'var(--radius-button)',
                  background: isActiveItem
                    ? 'var(--color-surface)'
                    : 'transparent',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: '.82rem',
                  color: item.disabled
                    ? 'var(--color-muted)'
                    : isAlert
                      ? 'var(--color-alert)'
                      : 'var(--color-text)',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ============================= ProfileRow ============================= */

export function ProfileRow({
  name,
  contextNote,
  meta,
  subdued = false,
  busy = false,
  menuLabel,
  menuItems,
}: {
  name: string
  /** Optional one-line neutral context note (smaller, muted). */
  contextNote?: string | null
  /** Optional secondary meta line (e.g. medical-history diagnosed date). */
  meta?: React.ReactNode
  subdued?: boolean
  busy?: boolean
  menuLabel: string
  /** CN-7: empty array = read-only row — no overflow menu renders at all. */
  menuItems: OverflowItem[]
}) {
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const revealed = hovered || focusWithin

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFocusWithin(false)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 0',
        borderBottom: '1px solid var(--color-border-hairline)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '.86rem',
            fontWeight: 600,
            color: subdued ? 'var(--color-text-light)' : 'var(--color-text)',
          }}
        >
          {name}
        </div>
        {meta}
        {contextNote && (
          <div
            style={{
              fontSize: '.8rem',
              color: 'var(--color-text-light)',
              lineHeight: 1.5,
              marginTop: 3,
            }}
          >
            {contextNote}
          </div>
        )}
      </div>
      {menuItems.length > 0 && (
        <RowOverflowMenu
          ariaLabel={menuLabel}
          items={menuItems}
          busy={busy}
          visible={revealed}
        />
      )}
    </div>
  )
}
