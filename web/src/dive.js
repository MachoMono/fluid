// The dive: the surface zooms toward a point (or the whole screen) and dissolves into the water,
// and the AG-UI view rises out of the depth. It runs on the Web Animations API so it can be reversed at any
// moment from wherever it has got to, which makes zooming out feel like the same motion played back.

const EASE = 'cubic-bezier(0.65, 0, 0.2, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function createDive({ stage, depths, veil, onOpened, onClosed }) {
  let anims = null
  let heading = 'surface'   // where the animation is going: 'depths' | 'surface'
  let gen = 0               // bumps on every direction change so stale completions are ignored

  const isOpen = () => heading === 'depths'

  function build(focus) {
    const vw = innerWidth, vh = innerHeight
    const calm = reduced()
    const duration = calm ? 220 : 1150
    const opts = { duration, easing: calm ? 'ease' : EASE, fill: 'both' }

    let cx = vw / 2, cy = vh / 2, s = 2.3
    if (focus && focus.width > 0 && focus.height > 0) {
      cx = focus.left + focus.width / 2
      cy = focus.top + focus.height / 2
      s = Math.min(5, Math.max(1.7, Math.min(vw / focus.width, vh / focus.height) * 0.78))
    }
    // The point we fly toward stays put while everything scales around it, then slides to the middle of the screen.
    stage.style.transformOrigin = `${cx + scrollX}px ${cy + scrollY}px`
    depths.style.transformOrigin = `${cx}px ${cy}px`
    const tx = vw / 2 - cx, ty = vh / 2 - cy

    const stageKeys = calm
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'translate(0,0) scale(1)', opacity: 1, filter: 'blur(0px)' },
          { transform: `translate(${tx * 0.55}px,${ty * 0.55}px) scale(${1 + (s - 1) * 0.55})`, opacity: 0.55, filter: 'blur(5px)', offset: 0.5 },
          { transform: `translate(${tx}px,${ty}px) scale(${s})`, opacity: 0, filter: 'blur(16px)' },
        ]
    const depthKeys = calm
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: 'scale(0.78)', opacity: 0, filter: 'blur(14px)' },
          { transform: 'scale(0.9)', opacity: 0, filter: 'blur(8px)', offset: 0.4 },
          { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' },
        ]
    // The water between the two layers: dark green that swells while the surface is leaving and stays until the
    // depths have arrived over it, so no bare page colour ever shows at the edges.
    const veilKeys = calm
      ? [{ opacity: 0 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0.95, offset: 0.45 }, { opacity: 0.95, offset: 0.9 }, { opacity: 0 }]

    return [
      stage.animate(stageKeys, opts),
      depths.animate(depthKeys, opts),
      veil.animate(veilKeys, { ...opts, easing: 'linear' }),
    ]
  }

  function settle(mine) {
    Promise.all(anims.map((a) => a.finished)).then(() => {
      if (mine !== gen) return
      if (heading === 'depths') {
        stage.inert = true
        depths.style.pointerEvents = ''
        onOpened?.()
      } else {
        anims.forEach((a) => a.cancel())
        anims = null
        depths.hidden = true
        stage.inert = false
        stage.style.transformOrigin = ''
        document.body.classList.remove('diving')
        onClosed?.()
      }
    }).catch(() => {})  // a cancelled animation rejects; nothing to do
  }

  function open(focus) {
    if (heading === 'depths') return
    heading = 'depths'
    gen++
    if (!anims) {
      depths.hidden = false
      document.body.classList.add('diving')
      anims = build(focus)
    } else {
      anims.forEach((a) => a.reverse())     // still on the way out: turn around from where we are
    }
    depths.style.pointerEvents = 'none'
    settle(gen)
  }

  function close() {
    if (heading !== 'depths' || !anims) return
    heading = 'surface'
    gen++
    stage.inert = false
    depths.style.pointerEvents = 'none'
    anims.forEach((a) => a.reverse())
    settle(gen)
  }

  return { open, close, isOpen }
}
