export type AssetProgress = { pending: number; total: number }

/** Wait for each frame's first report, then reveal once 20% of assets have
 * settled. Frame startup itself must not count as a completed asset. */
export function canvasLoadProgress(
  frames: readonly { id: string }[] | null,
  reports: Readonly<Record<string, AssetProgress | null>>,
) {
  if (!frames) return { value: 0, ready: false }
  let total = 0
  let completed = 0
  let rendered = 0
  for (const frame of frames) {
    const report = reports[frame.id]
    if (!report) continue
    rendered++
    total += report.total
    completed += report.total - report.pending
  }
  const allReported = rendered === frames.length
  const value = total ? (completed / total) * 100 : allReported ? 100 : 0
  return { value, ready: allReported && value >= 20 }
}
