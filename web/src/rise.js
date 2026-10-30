// The rise: leaving the water. The surface sinks away below and fades as the air above comes down into place,
// through a pale haze. Built like the dive, on the Web Animations API, so it can be reversed from wherever it is.

const EASE = 'cubic-bezier(0.65, 0, 0.2, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function createRise({ stage, horizon, haze, onOpened, onClosed }) {
  let anims = null
  let heading = 'surface'   // 'horizon' | 'surface'
  let gen = 0

  const isOpen = () => heading === 'horizon'

  function build() {
    const calm = reduced()
    const opts = { duration: calm ? 220 : 1050, easing: calm ? 'ease' : EASE, fill: 'both' }
    const stageKeys = calm
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'blur(0px)' },
          { transform: 'translateY(6vh) scale(0.95)', opacity: 0.5, filter: 'blur(4px)', offset: 0.5 },
          { transform: 'translateY(14vh) scale(0.9)', opacity: 0, filter: 'blur(12px)' },
        ]
    const horizonKeys = calm
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: 'translateY(-9vh) scale(1.05)', opacity: 0, filter: 'blur(12px)' },
          { transform: 'translateY(-5vh) scale(1.03)', opacity: 0, filter: 'blur(8px)', offset: 0.4 },
          { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'blur(0px)' },
        ]
    const hazeKeys = calm
      ? [{ opacity: 0 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0.95, offset: 0.45 }, { opacity: 0.95, offset: 0.9 }, { opacity: 0 }]
    return [
      stage.animate(stageKeys, opts),
      horizon.animate(horizonKeys, opts),
      haze.animate(hazeKeys, { ...opts, easing: 'linear' }),
    ]
  }

  function settle(mine) {
    Promise.all(anims.map((a) => a.finished)).then(() => {
      if (mine !== gen) return
      if (heading === 'horizon') {
        stage.inert = true
        horizon.style.pointerEvents = ''
        onOpened?.()
      } else {
        anims.forEach((a) => a.cancel())
        anims = null
        horizon.hidden = true
        stage.inert = false
        document.body.classList.remove('diving')
        onClosed?.()
      }
    }).catch(() => {})
  }

  function open() {
    if (heading === 'horizon') return
    heading = 'horizon'
    gen++
    if (!anims) {
      horizon.hidden = false
      document.body.classList.add('diving')
      anims = build()
    } else {
      anims.forEach((a) => a.reverse())
    }
    horizon.style.pointerEvents = 'none'
    settle(gen)
  }

  function close() {
    if (heading !== 'horizon' || !anims) return
    heading = 'surface'
    gen++
    stage.inert = false
    horizon.style.pointerEvents = 'none'
    anims.forEach((a) => a.reverse())
    settle(gen)
  }

  return { open, close, isOpen }
}
