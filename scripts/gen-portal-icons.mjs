// Portal PWA icon generator — Odyssey "O." mark with a green accent frame.
//
// The installed-app icons (public/icons/*.png) are rasterised from a single
// parametric SVG source so the brand mark can be re-centred / re-tinted / re-framed
// without pixel-pushing. Run:
//   node scripts/gen-portal-icons.mjs preview        # write candidates to scratch
//   node scripts/gen-portal-icons.mjs final <dx>     # overwrite public/icons + icon-source.svg
//
// The charcoal background is sampled from the existing mark so a regen never
// silently shifts the brand colour — only the geometry passed here changes.
// Green is the design-token accent (--color-accent #2DB24C); white is pure.
//
// Layout: charcoal fills the canvas; a thin green rounded-rect ring frames the
// edge; the O·dot lockup sits centred inside. Two ring geometries — a near-edge
// frame for iOS/"any" (iOS rounds the corners itself) and a further-inset ring
// for the Android maskable variant so a circular OEM crop still shows a full ring.

import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const iconsDir = path.join(root, 'public', 'icons')

const GREEN = '#2DB24C' // --color-accent
const WHITE = '#FFFFFF'

// Ring geometries (512 base). `inset` = gap from canvas edge to ring's outer
// edge; `w` = stroke width; `rx` = ring centreline corner radius.
const RING_EDGE = { inset: 24, w: 12, rx: 92 } // iOS / "any" — hugs the edge
const RING_SAFE = { inset: 52, w: 12, rx: 88 } // Android maskable — inside the safe circle

// Read the charcoal straight out of the current mark (top-left corner) so we
// match it exactly instead of guessing between --color-primary and --color-charcoal.
async function sampleBg() {
  const { data } = await sharp(path.join(iconsDir, 'icon-maskable-512.png'))
    .extract({ left: 6, top: 6, width: 2, height: 2 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const [r, g, b] = data
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// Build the mark on a 512 canvas. dxOpt shifts the whole O·dot lockup
// horizontally: 0 = O dead-centre (dot leans right); -46 = equal margins
// left/right (bbox-centred, the "Balanced" look). `ring` frames the edge.
function buildSvg(BG, dxOpt, ring) {
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

  const rPos = ring.inset + ring.w / 2
  const rSize = C - 2 * rPos

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">
<rect width="${C}" height="${C}" fill="${BG}"/>
<rect x="${rPos}" y="${rPos}" width="${rSize}" height="${rSize}" rx="${ring.rx}" fill="none" stroke="${GREEN}" stroke-width="${ring.w}"/>
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
    await render(buildSvg(BG, dx, RING_EDGE), 360, out)
    console.log('wrote', out)
  }
} else {
  const dx = Number(process.argv[3] ?? -46)
  // Canonical source is the near-edge (iOS/"any") variant.
  await writeFile(path.join(iconsDir, 'icon-source.svg'), buildSvg(BG, dx, RING_EDGE))
  await render(buildSvg(BG, dx, RING_EDGE), 512, path.join(iconsDir, 'icon-512.png'))
  await render(buildSvg(BG, dx, RING_EDGE), 192, path.join(iconsDir, 'icon-192.png'))
  await render(buildSvg(BG, dx, RING_EDGE), 180, path.join(iconsDir, 'icon-apple-touch.png'))
  await render(buildSvg(BG, dx, RING_SAFE), 512, path.join(iconsDir, 'icon-maskable-512.png'))
  console.log('final icons written with dx =', dx)
}
