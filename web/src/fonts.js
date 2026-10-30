// Agent mini-pages run in a sandbox that cannot reach the app's fonts, so the typeface is embedded in them as data.
import w300 from '@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-300-normal.woff2?url'
import w400 from '@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-400-normal.woff2?url'
import w500 from '@fontsource/zen-kaku-gothic-new/files/zen-kaku-gothic-new-latin-500-normal.woff2?url'

const toData = async (url) => {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return `data:font/woff2;base64,${btoa(bin)}`
}

export async function loadFontCss() {
  const faces = await Promise.all([[300, w300], [400, w400], [500, w500]].map(async ([weight, url]) =>
    `@font-face{font-family:"Zen Kaku Gothic New";font-weight:${weight};font-style:normal;font-display:swap;src:url(${await toData(url)}) format("woff2")}`))
  return faces.join('')
}
