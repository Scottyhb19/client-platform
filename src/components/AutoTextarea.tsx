'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'

/**
 * Textarea that grows with its content — no inner scrollbar, no fixed
 * row count. Used everywhere a clinical note's body lives so an EP can
 * see the whole field at once when reviewing or writing.
 *
 * Implementation: on every value change we reset the element's height
 * to "auto" (so it can shrink) then set it to scrollHeight. useLayoutEffect
 * runs synchronously before paint so there's no visible jump.
 *
 * Plays nicely as a controlled component — pass `value` and `onChange`
 * the same way as a native textarea.
 */
export interface AutoTextareaProps {
  value: string
  onChange: (value: string) => void
  onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  minHeight?: number
  ariaLabel?: string
  style?: CSSProperties
  className?: string
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea(
    {
      value,
      onChange,
      onBlur,
      onKeyDown,
      placeholder,
      disabled,
      readOnly,
      minHeight = 56,
      ariaLabel,
      style,
      className,
    },
    forwardedRef,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null)
    useImperativeHandle(forwardedRef, () => innerRef.current!, [])

    // Resize whenever the value changes. useLayoutEffect rather than
    // useEffect to avoid a one-frame flash at the wrong height.
    useLayoutEffect(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
    }, [value, minHeight])

    // Resize once on mount in case the initial value was already long
    // (covers SSR-rendered values arriving on hydration).
    useEffect(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
    }, [minHeight])

    return (
      <textarea
        ref={innerRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel}
        rows={1}
        className={className}
        style={{
          width: '100%',
          padding: '9px 12px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 7,
          background: 'var(--color-surface)',
          fontSize: '.88rem',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          color: 'var(--color-text)',
          resize: 'none',
          overflow: 'hidden',
          outline: 'none',
          boxSizing: 'border-box',
          minHeight,
          ...style,
        }}
      />
    )
  },
)
