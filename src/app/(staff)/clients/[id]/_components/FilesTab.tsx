'use client'

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  deleteClientFileAction,
  getClientFileSignedUrlAction,
  uploadClientFileAction,
  type FileCategory,
} from '../files-actions'

export type ClientFile = {
  id: string
  category: FileCategory
  name: string
  original_filename: string
  mime_type: string | null
  size_bytes: number
  created_at: string
}

const CATEGORIES: Array<{ key: FileCategory; label: string; chipLabel: string }> = [
  { key: 'gpccmp', label: 'GPCCMP (Medicare Plan)', chipLabel: 'GPCCMP' },
  { key: 'radiology', label: 'Radiology Reports', chipLabel: 'Radiology' },
  { key: 'workers_comp', label: "Worker's Comp / CTP", chipLabel: "W. Comp / CTP" },
  { key: 'specialist_letter', label: 'Specialist Letters', chipLabel: 'Specialist' },
  { key: 'referral', label: 'Referrals', chipLabel: 'Referral' },
  { key: 'other', label: 'Other', chipLabel: 'Other' },
]

type FilterKey = 'all' | FileCategory

const MAX_FILE_BYTES = 25 * 1024 * 1024

interface FilesTabProps {
  clientId: string
  files: ClientFile[]
}

export function FilesTab({ clientId, files }: FilesTabProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClientFile | null>(null)
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // Counter prevents flicker when a child element triggers dragleave then
  // dragenter as the pointer crosses inner boundaries.
  const dragDepthRef = useRef(0)

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = {
      all: files.length,
      gpccmp: 0,
      radiology: 0,
      workers_comp: 0,
      specialist_letter: 0,
      referral: 0,
      other: 0,
    }
    for (const f of files) {
      result[f.category]++
    }
    return result
  }, [files])

  const visibleFiles = useMemo(() => {
    const term = search.trim().toLowerCase()
    return files.filter((f) => {
      if (filter !== 'all' && f.category !== filter) return false
      if (term.length === 0) return true
      return (
        f.name.toLowerCase().includes(term) ||
        f.original_filename.toLowerCase().includes(term)
      )
    })
  }, [files, filter, search])

  function openPicker() {
    fileInputRef.current?.click()
  }

  function handleFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      acceptFile(file)
    }
    // Reset so picking the same file twice in a row still fires onChange.
    e.target.value = ''
  }

  function acceptFile(file: File) {
    setUploadError(null)
    if (file.size === 0) {
      setUploadError('That file is empty.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError(
        `File is too large. Max 25 MB; this one is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      )
      return
    }
    setPending(file)
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      dragDepthRef.current++
      setIsDragging(true)
    }
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragging(false)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragging(false)
    const dropped = e.dataTransfer.files
    if (!dropped || dropped.length === 0) return
    if (dropped.length > 1) {
      setUploadError('Drop one file at a time for now.')
      return
    }
    acceptFile(dropped[0])
  }

  function closePending() {
    setPending(null)
    setUploadError(null)
  }

  function onUploaded() {
    setPending(null)
    setUploadError(null)
    router.refresh()
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      {/* Hidden picker — opened by the Upload button or the drop zone click */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFilePicked}
        style={{ display: 'none' }}
      />

      {/* Drop zone */}
      <DropZone
        isActive={isDragging}
        onPickClick={openPicker}
      />

      {bannerError && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'rgba(214,64,69,.08)',
            border: '1px solid rgba(214,64,69,.25)',
            borderRadius: 8,
            color: 'var(--color-alert)',
            fontSize: '.84rem',
          }}
        >
          {bannerError}
        </div>
      )}

      {/* Filter chips + search */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <FilterChip
            label="All"
            count={counts.all}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.key}
              label={c.chipLabel}
              count={counts[c.key]}
              active={filter === c.key}
              onClick={() => setFilter(c.key)}
            />
          ))}
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search
            size={13}
            aria-hidden
            style={{
              position: 'absolute',
              left: 10,
              color: 'var(--color-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            style={{
              width: 240,
              padding: '6px 12px 6px 30px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 7,
              background: 'var(--color-card)',
              fontSize: '.82rem',
              color: 'var(--color-text)',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* List */}
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">
            {filter === 'all'
              ? `Files · ${visibleFiles.length}${
                  search ? ` of ${files.length}` : ''
                }`
              : `${categoryLabel(filter)} · ${visibleFiles.length}`}
          </div>
        </div>

        <FileListHeader />

        {visibleFiles.length === 0 ? (
          <FilesEmpty filter={filter} hasSearch={search.length > 0} />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {visibleFiles.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onDelete={() => setDeleteTarget(file)}
                onDownloadError={(msg) => setBannerError(msg)}
              />
            ))}
          </ul>
        )}
      </div>

      {pending && (
        <UploadModal
          clientId={clientId}
          file={pending}
          uploadError={uploadError}
          onCancel={closePending}
          onUploaded={onUploaded}
          setUploadError={setUploadError}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          file={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null)
            router.refresh()
          }}
          onError={(msg) => setBannerError(msg)}
        />
      )}
    </div>
  )
}

/* ============================== Drop zone ============================== */

function DropZone({
  isActive,
  onPickClick,
}: {
  isActive: boolean
  onPickClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPickClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '18px 22px',
        border: `1.5px dashed ${
          isActive ? 'var(--color-accent)' : 'var(--color-border-subtle)'
        }`,
        borderRadius: 12,
        background: isActive
          ? 'rgba(45,178,76,.06)'
          : 'var(--color-card)',
        transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          background: isActive ? 'var(--color-accent)' : 'var(--color-surface)',
          color: isActive ? '#fff' : 'var(--color-text-light)',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <UploadCloud size={20} aria-hidden />
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.95rem',
            color: 'var(--color-charcoal)',
            marginBottom: 2,
          }}
        >
          {isActive ? 'Drop to upload' : 'Drop a file or click to browse'}
        </div>
        <div
          style={{
            fontSize: '.8rem',
            color: 'var(--color-text-light)',
          }}
        >
          PDF, Word, Excel, images, and most other formats. 25 MB max.
        </div>
      </div>
      <span
        className="btn primary"
        style={{
          fontSize: '.78rem',
          padding: '7px 14px',
          pointerEvents: 'none',
        }}
      >
        <Upload size={13} aria-hidden />
        Upload
      </span>
    </button>
  )
}

/* ============================== Filter chip ============================== */

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        border: `1px solid ${
          active ? 'var(--color-primary)' : 'var(--color-border-subtle)'
        }`,
        background: active ? 'var(--color-primary)' : 'var(--color-card)',
        color: active ? '#fff' : 'var(--color-text-light)',
        fontSize: '.78rem',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {label}
      <span
        style={{
          fontSize: '.7rem',
          padding: '1px 6px',
          borderRadius: 999,
          background: active
            ? 'rgba(255,255,255,.18)'
            : 'var(--color-surface)',
          color: active ? '#fff' : 'var(--color-muted)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

/* ============================== List rows ============================== */

function FileListHeader() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 130px 90px 60px',
        padding: '10px 20px',
        background: 'var(--color-surface)',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '.66rem',
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: 'var(--color-muted)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div>Name</div>
      <div>Category</div>
      <div>Uploaded</div>
      <div>Size</div>
      <div />
    </div>
  )
}

function FileRow({
  file,
  onDelete,
  onDownloadError,
}: {
  file: ClientFile
  onDelete: () => void
  onDownloadError: (msg: string) => void
}) {
  const [isDownloading, startDownload] = useTransition()

  function handleDownload() {
    if (isDownloading) return
    startDownload(async () => {
      const res = await getClientFileSignedUrlAction(file.id)
      if (res.error || !res.url) {
        onDownloadError(res.error ?? 'Download failed.')
        return
      }
      // Open the signed URL — Content-Disposition: attachment is set on the
      // signed URL via the `download` option, so the browser saves rather
      // than navigating.
      window.location.href = res.url
    })
  }

  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 130px 90px 60px',
        padding: '14px 20px',
        alignItems: 'center',
        borderBottom: '1px solid var(--color-border-subtle)',
        fontSize: '.86rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <FileTypeIcon mime={file.mime_type} filename={file.original_filename} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: 'var(--color-text)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={file.name}
          >
            {file.name}
          </div>
          <div
            style={{
              fontSize: '.74rem',
              color: 'var(--color-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={file.original_filename}
          >
            {file.original_filename}
          </div>
        </div>
      </div>

      <div>
        <span
          style={{
            display: 'inline-block',
            fontSize: '.72rem',
            padding: '2px 8px',
            borderRadius: 999,
            background: categoryBg(file.category),
            color: categoryFg(file.category),
            fontWeight: 500,
          }}
        >
          {CATEGORIES.find((c) => c.key === file.category)?.chipLabel ?? file.category}
        </span>
      </div>

      <div style={{ color: 'var(--color-text-light)', fontSize: '.82rem' }}>
        {formatDate(file.created_at)}
      </div>

      <div style={{ color: 'var(--color-text-light)', fontSize: '.82rem' }}>
        {formatSize(file.size_bytes)}
      </div>

      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <RowAction
          label={isDownloading ? 'Downloading…' : 'Download'}
          onClick={handleDownload}
          disabled={isDownloading}
        >
          <Download size={15} aria-hidden />
        </RowAction>
        <RowAction label="Delete" onClick={onDelete} danger>
          <Trash2 size={15} aria-hidden />
        </RowAction>
      </div>
    </li>
  )
}

function RowAction({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 28,
        height: 28,
        display: 'inline-grid',
        placeItems: 'center',
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        color: disabled
          ? 'var(--color-muted)'
          : danger
            ? 'var(--color-alert)'
            : 'var(--color-text-light)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 150ms cubic-bezier(0.4,0,0.2,1)',
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--color-surface)'
        }
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function FilesEmpty({
  filter,
  hasSearch,
}: {
  filter: FilterKey
  hasSearch: boolean
}) {
  let line1 = 'No files yet'
  let line2 =
    'Drop a file above or click Upload. PDFs, Word docs, Excel sheets, images — all welcome.'
  if (hasSearch) {
    line1 = 'No matches'
    line2 = 'Nothing matches that search. Try a different term or clear the search box.'
  } else if (filter !== 'all') {
    line1 = `No ${categoryLabel(filter).toLowerCase()} files yet`
    line2 = 'Files filed under this category will appear here once uploaded.'
  }
  return (
    <div
      style={{
        padding: '40px 24px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: 'var(--color-surface)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--color-muted)',
          margin: '0 auto 14px',
        }}
      >
        <FileText size={20} aria-hidden />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        {line1}
      </div>
      <p
        style={{
          fontSize: '.84rem',
          lineHeight: 1.6,
          margin: '0 auto',
          maxWidth: 440,
        }}
      >
        {line2}
      </p>
    </div>
  )
}

/* ============================== Upload modal ============================== */

function UploadModal({
  clientId,
  file,
  uploadError,
  onCancel,
  onUploaded,
  setUploadError,
}: {
  clientId: string
  file: File
  uploadError: string | null
  onCancel: () => void
  onUploaded: () => void
  setUploadError: (msg: string | null) => void
}) {
  const defaultName = file.name.replace(/\.[^.]+$/, '')
  const [displayName, setDisplayName] = useState(defaultName)
  const [category, setCategory] = useState<FileCategory>('other')
  const [notes, setNotes] = useState('')
  const [isPending, startSave] = useTransition()

  function handleSave() {
    if (isPending) return
    setUploadError(null)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('clientId', clientId)
    fd.append('category', category)
    fd.append('displayName', displayName)
    fd.append('notes', notes)
    startSave(async () => {
      const res = await uploadClientFileAction(fd)
      if (res.error) {
        setUploadError(res.error)
        return
      }
      onUploaded()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-heading"
      onClick={() => !isPending && onCancel()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '22px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2
            id="upload-heading"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.2rem',
              margin: 0,
              color: 'var(--color-charcoal)',
            }}
          >
            Upload file
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            aria-label="Cancel"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-light)',
              cursor: isPending ? 'not-allowed' : 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 8,
            marginBottom: 18,
          }}
        >
          <FileTypeIcon mime={file.type} filename={file.name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '.84rem',
                color: 'var(--color-text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={file.name}
            >
              {file.name}
            </div>
            <div style={{ fontSize: '.72rem', color: 'var(--color-muted)' }}>
              {formatSize(file.size)}
            </div>
          </div>
        </div>

        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FileCategory)}
            disabled={isPending}
            style={selectStyle}
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={isPending}
            maxLength={200}
            style={inputStyle}
          />
        </Field>

        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
            rows={2}
            maxLength={2000}
            placeholder="e.g. Knee MRI from Dr Singh, March 2026"
            style={{
              ...inputStyle,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </Field>

        {uploadError && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: 'rgba(214,64,69,.08)',
              border: '1px solid rgba(214,64,69,.25)',
              borderRadius: 7,
              color: 'var(--color-alert)',
              fontSize: '.82rem',
              marginBottom: 14,
            }}
          >
            {uploadError}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 8,
          }}
        >
          <button
            type="button"
            className="btn outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={isPending || displayName.trim().length === 0}
          >
            {isPending ? 'Uploading…' : 'Save file'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span
        style={{
          display: 'block',
          fontSize: '.7rem',
          color: 'var(--color-muted)',
          fontWeight: 600,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  background: 'var(--color-card)',
  fontSize: '.86rem',
  color: 'var(--color-text)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'auto',
  cursor: 'pointer',
}

/* ============================== Delete confirm ============================== */

function DeleteConfirm({
  file,
  onCancel,
  onDeleted,
  onError,
}: {
  file: ClientFile
  onCancel: () => void
  onDeleted: () => void
  onError: (msg: string) => void
}) {
  const [isDeleting, startDelete] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    if (isDeleting) return
    setError(null)
    startDelete(async () => {
      const res = await deleteClientFileAction(file.id)
      if (res.error) {
        setError(res.error)
        return
      }
      onError('') // clear any prior banner
      onDeleted()
    })
  }

  // ESC closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isDeleting) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDeleting, onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => !isDeleting && onCancel()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '22px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.2rem',
            margin: '0 0 8px',
            color: 'var(--color-charcoal)',
          }}
        >
          Delete this file?
        </h2>
        <p
          style={{
            fontSize: '.86rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.55,
            margin: '0 0 18px',
          }}
        >
          <strong style={{ color: 'var(--color-text)' }}>{file.name}</strong>{' '}
          will be permanently removed from this client&rsquo;s record. This
          can&rsquo;t be undone.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: 'rgba(214,64,69,.08)',
              border: '1px solid rgba(214,64,69,.25)',
              borderRadius: 7,
              color: 'var(--color-alert)',
              fontSize: '.82rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            className="btn outline"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: '.84rem',
              padding: '8px 16px',
              borderRadius: 7,
              border: '1px solid var(--color-alert)',
              background: 'var(--color-alert)',
              color: '#fff',
              cursor: isDeleting ? 'not-allowed' : 'pointer',
              opacity: isDeleting ? 0.7 : 1,
            }}
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================== Helpers ============================== */

function categoryLabel(cat: FilterKey): string {
  if (cat === 'all') return 'All'
  return CATEGORIES.find((c) => c.key === cat)?.label ?? 'Other'
}

function categoryBg(cat: FileCategory): string {
  switch (cat) {
    case 'gpccmp':
      return 'rgba(45,178,76,.12)'
    case 'radiology':
      return 'rgba(80,120,180,.12)'
    case 'workers_comp':
      return 'rgba(214,140,40,.12)'
    case 'specialist_letter':
      return 'rgba(140,90,180,.12)'
    case 'referral':
      return 'rgba(60,160,160,.12)'
    case 'other':
    default:
      return 'var(--color-surface)'
  }
}

function categoryFg(cat: FileCategory): string {
  switch (cat) {
    case 'gpccmp':
      return '#1f6b32'
    case 'radiology':
      return '#385582'
    case 'workers_comp':
      return '#8a5a18'
    case 'specialist_letter':
      return '#5b3d80'
    case 'referral':
      return '#2c6c6c'
    case 'other':
    default:
      return 'var(--color-text-light)'
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function FileTypeIcon({
  mime,
  filename,
}: {
  mime: string | null
  filename: string
}) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  let Icon: typeof FileIcon = FileIcon
  let tone = '#6c635a'

  if (mime?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif'].includes(ext)) {
    Icon = ImageIcon
    tone = '#5b3d80'
  } else if (mime === 'application/pdf' || ext === 'pdf') {
    Icon = FileText
    tone = '#a83232'
  } else if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'doc' ||
    ext === 'docx'
  ) {
    Icon = FileText
    tone = '#2a5d9a'
  } else if (
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv'
  ) {
    Icon = FileSpreadsheet
    tone = '#1f6b32'
  }

  return (
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: 7,
        background: 'var(--color-surface)',
        color: tone,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <Icon size={15} aria-hidden />
    </span>
  )
}
