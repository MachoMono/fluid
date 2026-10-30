// The rise: leaving the water. The surface sinks away below and fades as the air above comes down into place,
// through a pale haze. Built like the dive, on the Web Animations API, so it can be reversed from wherever it is.

const EASE = 'cubic-bezier(0.65, 0, 0.2, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function createRise({ stage, above, haze, onOpened, onClosed }) {
  let anims = null
  let heading = 'surface'   // 'above' | 'surface'
  let gen = 0

  const isOpen = () => heading === 'above'

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
    const aboveKeys = calm
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
      above.animate(aboveKeys, opts),
      haze.animate(hazeKeys, { ...opts, easing: 'linear' }),
    ]
  }

  function settle(mine) {
    Promise.all(anims.map((a) => a.finished)).then(() => {
      if (mine !== gen) return
      if (heading === 'above') {
        stage.inert = true
        above.style.pointerEvents = ''
        onOpened?.()
      } else {
        anims.forEach((a) => a.cancel())
        anims = null
        above.hidden = true
        stage.inert = false
        document.body.classList.remove('diving')
        onClosed?.()
      }
    }).catch(() => {})
  }

  function open() {
    if (heading === 'above') return
    heading = 'above'
    gen++
    if (!anims) {
      above.hidden = false
      document.body.classList.add('diving')
      anims = build()
    } else {
      anims.forEach((a) => a.reverse())
    }
    above.style.pointerEvents = 'none'
    settle(gen)
  }

  function close() {
    if (heading !== 'above' || !anims) return
    heading = 'surface'
    gen++
    stage.inert = false
    above.style.pointerEvents = 'none'
    anims.forEach((a) => a.reverse())
    settle(gen)
  }

  return { open, close, isOpen }
}
