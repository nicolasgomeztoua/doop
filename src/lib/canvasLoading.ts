export type AssetProgress = { pending: number; total: number }

/** Include one unit per frame so an iframe that has not rendered cannot
 * accidentally count as complete, even when its HTML contains no assets. */
export function canvasLoadProgress(
  frames: readonly { id: string }[] | null,
  reports: Readonly<Record<string, AssetProgress | null>>,
) {
  if (!frames) return { value: 0, ready: false }
  let total = 1 + frames.length // canvas data plus each rendered frame
  let completed = 1
  let ready = true
  for (const frame of frames) {
    const report = reports[frame.id]
    if (!report) {
      ready = false
      continue
    }
    total += report.total
    completed += 1 + report.total - report.pending
    if (report.pending) ready = false
  }
  return { value: (completed / total) * 100, ready }
}
