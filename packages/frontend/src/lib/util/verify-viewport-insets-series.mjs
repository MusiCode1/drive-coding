/** Cross-check device rows from bug #76 before pinning occludedPx expectations. */
const rows = [
  { series: 278.0, layoutH: 692.7, vvTop: 267.7, raw: 10.3, label: "drag+60 HE kb" },
  { series: 278.0, layoutH: 692.7, vvTop: 234.3, raw: 43.7, label: "drag+120 HE kb" },
  { series: 282.3, layoutH: 692, vvTop: 204.3, raw: 78, label: "raw=78 EN kb" },
]
for (const r of rows) {
  const vvH = r.layoutH - r.vvTop - r.raw
  const sum = r.vvTop + r.raw
  if (Math.abs(sum - r.series) > 0.05) {
    throw new Error(`${r.label}: vvTop+raw=${sum} != series ${r.series}`)
  }
  const check = r.layoutH - r.series
  if (Math.abs(vvH - check) > 0.05) {
    throw new Error(`${r.label}: vvH=${vvH} inconsistent with layoutH-series`)
  }
}
console.log("series ok", rows.length)
