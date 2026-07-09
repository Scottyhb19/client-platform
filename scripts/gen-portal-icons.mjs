// Portal PWA icon generator — Odyssey "O." mark in a green-edged frame.
//
// The installed-app icons (public/icons/*.png) are rasterised from a single
// parametric SVG source so the brand mark can be re-centred / re-tinted / re-framed
// without pixel-pushing. Run:
//   node scripts/gen-portal-icons.mjs preview        # write candidates to scratch
//   node scripts/gen-portal-icons.mjs final <dx>     # overwrite public/icons + icon-source.svg
//
// The charcoal is sampled from the existing mark so a regen never silently shifts
// the brand colour — only the geometry passed here changes. Green is the
// design-token accent (--color-accent #2DB24C); white is pure.
//
// Layout: green fills the canvas edge-to-edge (so the accent IS the outer rim of
// the icon and survives the OS corner-rounding / maskable crop); a charcoal
// rounded panel sits on top inset by the frame width; the O·dot lockup sits
// centred on the charcoal. Full-bleed opaque green keeps it valid as a maskable
// icon (no transparent corners) and gives a clean green rim on iOS.

import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const iconsDir = path.join(root, 'public', 'icons')

const GREEN = '#2DB24C' // --color-accent
const WHITE = '#FFFFFF'

// Frame: green rim width (512 base) + charcoal panel corner radius. innerRx is
// tuned so the charcoal corners sit concentric inside the ~114px iOS squircle,
// leaving an even green rim all the way around the corners.
const FRAME = { w: 18, innerRx: 96 }

// Read the charcoal straight out of the current mark (top-left is now green, so
// sample from the panel interior) so we match it exactly instead of guessing.
async function sampleBg() {
  const { data } = await sharp(path.join(iconsDir, 'icon-maskable-512.png'))
    .extract({ left: 256, top: 90, width: 2, height: 2 }) // inside the charcoal panel, above the O
    .raw()
    .toBuffer({ resolveWithObject: true })
  const [r, g, b] = data
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// Build the mark on a 512 canvas. dxOpt shifts the whole O·dot lockup
// horizontally: 0 = O dead-centre (dot leans right); -46 = equal margins
// left/right (bbox-centred, the "Balanced" look).
function buildSvg(BG, dxOpt) {
  const C = 512
  const cx = C / 2
  const cy = C / 2

  const Oh = 320 // O outer height
  const Ow = 184 // O outer width
  const t = 54 // ring thickness of the O glyph
  const dr = 42 // dot radius
  const dgap = 10 // gap between O's right edge and the dot's left edge

  const Or = Ow / 2 // O outer capsule radius
  const oX = cx - Ow / 2
  const oY = cy - Oh / 2
  const iW = Ow - 2 * t
  const iH = Oh - 2 * t
  const iX = cx - iW / 2
  const iY = cy - iH / 2
  const iR = iW / 2
  const dotCx = cx + Ow / 2 + dgap + dr
  const dotCy = oY + Oh * 0.82 // sit the dot low, like the wordmark's baseline dot

  const fw = FRAME.w
  const panel = C - 2 * fw

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">
<rect width="${C}" height="${C}" fill="${GREEN}"/>
<rect x="${fw}" y="${fw}" width="${panel}" height="${panel}" rx="${FRAME.innerRx}" fill="${BG}"/>
<g transform="translate(${dxOpt} 0)">
<rect x="${oX}" y="${oY}" width="${Ow}" height="${Oh}" rx="${Or}" fill="${WHITE}"/>
<rect x="${iX}" y="${iY}" width="${iW}" height="${iH}" rx="${iR}" fill="${BG}"/>
<circle cx="${dotCx}" cy="${dotCy}" r="${dr}" fill="${GREEN}"/>
</g>
</svg>`
}

async function render(svg, size, outPath) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(outPath)
}

const mode = process.argv[2] || 'final'
const BG = await sampleBg()
console.log('sampled charcoal BG =', BG)

if (mode === 'preview') {
  const scratch = process.env.SCRATCH || here
  for (const dx of [-16, -30, -46]) {
    const out = path.join(scratch, `preview_${dx}.png`)
    await render(buildSvg(BG, dx), 360, out)
    console.log('wrote', out)
  }
} else {
  const dx = Number(process.argv[3] ?? -46)
  const svg = buildSvg(BG, dx)
  await writeFile(path.join(iconsDir, 'icon-source.svg'), svg)
  await render(svg, 512, path.join(iconsDir, 'icon-512.png'))
  await render(svg, 192, path.join(iconsDir, 'icon-192.png'))
  await render(svg, 180, path.join(iconsDir, 'icon-apple-touch.png'))
  await render(svg, 512, path.join(iconsDir, 'icon-maskable-512.png'))
  console.log('final icons written with dx =', dx)
}
