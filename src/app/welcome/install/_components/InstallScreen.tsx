'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowDown, Share, Smartphone } from 'lucide-react'

type Platform = 'ios' | 'android' | 'desktop' | 'standalone' | 'unknown'

/**
 * Beneath every "Install" button is a single browser-supplied event. Chrome /
 * Edge / Samsung Internet fire `beforeinstallprompt` when the page meets PWA
 * install criteria; capturing it gives us a one-tap install flow. iOS Safari
 * never fires this event — Apple deliberately gatekeeps install behind manual
 * Share → Add to Home Screen. So the iOS branch shows instructions, and the
 * Android branch wires the captured event to a button.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown'
  const ua = window.navigator.userAgent
  // iOS Safari sets navigator.standalone === true when launched from a home
  // screen icon. Other browsers expose display-mode: standalone via match-media.
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  if (isStandalone) return 'standalone'
  // iPadOS 13+ reports as "Macintosh" with touch — sniff for that too.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && 'ontouchend' in document)
  if (isIOS) return 'ios'
  if (/android/i.test(ua)) return 'android'
  // Tablet/desktop fallback. We treat anything non-mobile as "desktop" for
  // copy purposes — the install matters less here.
  return 'desktop'
}

/**
 * Eyebrow + heading + subtitle live in the AuthShell wrapper at
 * /welcome/install/page.tsx — this component renders just the platform-
 * specific install instructions and the "skip" escape hatch.
 */
export function InstallScreen() {
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const p = detectPlatform()
    setPlatform(p)
    // Already installed → skip straight to portal. No need to make them
    // tap "Continue" — they're literally inside the installed app.
    if (p === 'standalone') {
      window.location.replace('/portal')
      return
    }

    function handler(e: Event) {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // The browser fires `appinstalled` after a successful install. We listen
    // here too as a backstop in case the prompt resolves without a userChoice
    // (rare, but seen on some Samsung Internet builds).
    function onInstalled() {
      window.location.replace('/portal')
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function triggerAndroidInstall() {
    if (!promptEvent || installing) return
    setInstalling(true)
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    setInstalling(false)
    if (choice.outcome === 'accepted') {
      // appinstalled fires shortly after — the listener above bounces us
      // to /portal. If it doesn't fire (Samsung quirk), the user can tap
      // the "Continue to portal" link.
    }
  }

  return (
    <>
      <div>
        {platform === 'ios' && <IOSInstructions />}
        {platform === 'android' && (
          <AndroidInstructions
            onInstall={triggerAndroidInstall}
            hasPrompt={Boolean(promptEvent)}
            installing={installing}
          />
        )}
        {platform === 'desktop' && <DesktopInstructions />}
        {(platform === 'unknown' || platform === 'standalone') && <Loading />}
      </div>

      <Link
        href="/portal"
        style={{
          display: 'block',
          marginTop: 18,
          padding: '10px 14px',
          textAlign: 'center',
          fontSize: '.84rem',
          color: 'var(--color-text-light)',
          textDecoration: 'none',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 8,
        }}
      >
        Skip — open in browser
      </Link>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* iOS                                                                 */
/* ------------------------------------------------------------------ */

function IOSInstructions() {
  return (
    <ol style={ioListStyle}>
      <Step n={1}>
        Tap the{' '}
        <span style={inlineIconStyle}>
          <Share size={14} aria-hidden /> Share
        </span>{' '}
        icon at the bottom of Safari.
        <ShareHintIllustration />
      </Step>
      <Step n={2}>
        Scroll down the share sheet and tap{' '}
        <strong>Add to Home Screen</strong>.
      </Step>
      <Step n={3}>
        Tap <strong>Add</strong> in the top-right. The Odyssey icon appears on
        your home screen.
      </Step>
    </ol>
  )
}

function ShareHintIllustration() {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 14px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: '.78rem',
        color: 'var(--color-text-light)',
      }}
    >
      <Share size={18} aria-hidden style={{ color: 'var(--color-primary)' }} />
      <ArrowDown size={14} aria-hidden />
      <span>Tap this in Safari&rsquo;s bottom toolbar.</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Android                                                             */
/* ------------------------------------------------------------------ */

function AndroidInstructions({
  onInstall,
  hasPrompt,
  installing,
}: {
  onInstall: () => void
  hasPrompt: boolean
  installing: boolean
}) {
  if (hasPrompt) {
    return (
      <div>
        <button
          type="button"
          className="btn primary"
          onClick={onInstall}
          disabled={installing}
          style={{
            width: '100%',
            justifyContent: 'center',
            padding: '12px 22px',
            fontSize: '.95rem',
          }}
        >
          {installing ? 'Installing…' : 'Install Odyssey'}
        </button>
        <p
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          Chrome will ask you to confirm. After install, Odyssey lives on your
          home screen.
        </p>
      </div>
    )
  }
  return (
    <ol style={ioListStyle}>
      <Step n={1}>
        Open Chrome&rsquo;s menu (the three dots in the top-right).
      </Step>
      <Step n={2}>
        Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
      </Step>
      <Step n={3}>Confirm. The Odyssey icon will appear on your home screen.</Step>
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

function DesktopInstructions() {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <Smartphone
        size={24}
        aria-hidden
        style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 2 }}
      />
      <div>
        <div
          style={{
            fontWeight: 600,
            fontSize: '.92rem',
            color: 'var(--color-charcoal)',
            marginBottom: 4,
          }}
        >
          Open this on your phone
        </div>
        <div style={{ fontSize: '.82rem', color: 'var(--color-text-light)', lineHeight: 1.5 }}>
          Odyssey is designed for your phone — log a session, check your
          program, message your practitioner. Open this same link on your
          mobile to add it to your home screen.
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared atoms                                                        */
/* ------------------------------------------------------------------ */

function Loading() {
  return (
    <div
      style={{
        padding: '14px 16px',
        textAlign: 'center',
        fontSize: '.85rem',
        color: 'var(--color-text-light)',
      }}
    >
      Loading…
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        padding: '12px 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 999,
          background: 'var(--color-primary)',
          color: '#fff',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.86rem',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {n}
      </span>
      <div
        style={{
          fontSize: '.92rem',
          color: 'var(--color-text)',
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </li>
  )
}

const ioListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 10,
  overflow: 'hidden',
  background: '#fff',
}

const inlineIconStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 5,
  verticalAlign: 'baseline',
  fontSize: '.85rem',
}
