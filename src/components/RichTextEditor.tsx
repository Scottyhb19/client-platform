'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon,
} from 'lucide-react'
import { isRichHtml, plainTextToRichHtml } from '@/lib/rich-text'

/**
 * Rich-text field for clinical-note content — the formatting-capable
 * sibling of AutoTextarea, with the same controlled `value`/`onChange`
 * string contract so it drops into the existing note forms without
 * changing their state shape.
 *
 * Deliberately small surface (design-system restraint): bold / italic /
 * underline, bullet + numbered lists, Shift+Enter soft line breaks and
 * Tab / Shift+Tab list indenting. The schema below is the whole grammar —
 * anything pasted from elsewhere is reduced to it by the editor, and the
 * server-side sanitiser (src/lib/rich-text-server.ts) enforces the same
 * set again at write time.
 *
 * Emits '' when the document has no visible content, so every existing
 * "is this field empty?" check (client and server) works unchanged.
 * Legacy plain-text values are converted on the way in via
 * plainTextToRichHtml — an old note opened for editing reads exactly as
 * it did in the textarea.
 */
export interface RichTextEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  minHeight?: number
  ariaLabel?: string
  style?: CSSProperties
}

function toEditorContent(value: string): string {
  if (!value) return ''
  return isRichHtml(value) ? value : plainTextToRichHtml(value)
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  minHeight = 64,
  ariaLabel,
  style,
}: RichTextEditorProps) {
  // The last HTML this editor emitted. External value changes (template
  // swap, draft restore) are adopted only when the prop differs from what
  // we last sent up — the same key-on-prop-CHANGE rule the set-grid cells
  // use, so the editor never clobbers in-flight typing after its own save.
  const lastEmittedRef = useRef(value)

  // TipTap binds callbacks once at editor creation; refs keep them
  // pointing at the latest render's closures (a commit-on-blur handler
  // captures state that changes every keystroke). Synced in an effect —
  // events can only fire after render + effects, so they never see stale.
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  useEffect(() => {
    onChangeRef.current = onChange
    onBlurRef.current = onBlur
  })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false,
      }),
    ],
    content: toEditorContent(value),
    editable: !disabled,
    // Next.js SSR: render nothing on the server, mount on the client —
    // avoids the hydration mismatch TipTap warns about.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'rich-editor-content',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.isEmpty ? '' : e.getHTML()
      lastEmittedRef.current = html
      onChangeRef.current(html)
    },
    onBlur: () => onBlurRef.current?.(),
  })

  // Adopt external value changes (and ignore our own echoes).
  useEffect(() => {
    if (!editor) return
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    editor.commands.setContent(toEditorContent(value))
  }, [editor, value])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            // Indent/outdent only apply inside a list item; disable the
            // buttons elsewhere so they never look actionable with no effect.
            canIndent: e.can().sinkListItem('listItem'),
            canOutdent: e.can().liftListItem('listItem'),
            empty: e.isEmpty,
          }
        : null,
  })

  // Layout mirrors the old AutoTextarea exactly — the bordered box IS the
  // writing area — with the formatting controls as a quiet icon row
  // BENEATH the box (operator direction 2026-07-04), not a chrome strip
  // above it.
  return (
    <div
      className={`rich-editor ${disabled ? 'disabled' : ''}`}
      style={style}
    >
      <div style={{ position: 'relative' }}>
        {placeholder && state?.empty && (
          <div className="rich-editor-placeholder" aria-hidden>
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} style={{ minHeight }} />
      </div>
      <div className="rich-editor-toolbar" role="toolbar" aria-label="Formatting">
        <ToolbarButton
          label="Bold"
          active={state?.bold}
          disabled={disabled}
          onPress={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={12} aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={state?.italic}
          disabled={disabled}
          onPress={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={12} aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={state?.underline}
          disabled={disabled}
          onPress={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={12} aria-hidden />
        </ToolbarButton>
        <span className="rich-editor-toolbar-divider" aria-hidden />
        <ToolbarButton
          label="Bullet list"
          active={state?.bulletList}
          disabled={disabled}
          onPress={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={13} aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={state?.orderedList}
          disabled={disabled}
          onPress={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={13} aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Outdent"
          disabled={disabled || !state?.canOutdent}
          onPress={() => editor?.chain().focus().liftListItem('listItem').run()}
        >
          <IndentDecrease size={13} aria-hidden />
        </ToolbarButton>
        <ToolbarButton
          label="Indent"
          disabled={disabled || !state?.canIndent}
          onPress={() => editor?.chain().focus().sinkListItem('listItem').run()}
        >
          <IndentIncrease size={13} aria-hidden />
        </ToolbarButton>
      </div>
    </div>
  )
}

function ToolbarButton({
  label,
  active,
  disabled,
  onPress,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      className={`rich-editor-toolbtn ${active ? 'on' : ''}`}
      // preventDefault keeps the editor selection alive through the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  )
}
