import fs from 'node:fs/promises'
import path from 'node:path'

export async function createReportStore(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const reportsById = new Map()

  // Load existing reports when the checkpoint starts.
  try {
    const contents = await fs.readFile(filePath, 'utf8')
    const savedReports = JSON.parse(contents)

    if (!Array.isArray(savedReports)) {
      throw new Error('Report storage must contain a JSON array')
    }

    for (const report of savedReports) {
      if (!report || typeof report.id !== 'string') {
        throw new Error('Stored report has an invalid ID')
      }

      reportsById.set(report.id, report)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Could not load checkpoint reports: ${error.message}`)
    }
  }

  let writeQueue = Promise.resolve()

  function saveReport(report) {
    const operation = writeQueue.catch(() => {}).then(async () => {
      const existing = reportsById.get(report.id)

      if (existing) {
        return { duplicate: true, report: existing }
      }

      const nextReports = [
        ...reportsById.values(),
        report
      ]

      const temporaryPath = `${filePath}.${process.pid}.tmp`

      await fs.writeFile(
        temporaryPath,
        JSON.stringify(nextReports, null, 2) + '\n',
        'utf8'
      )

      await fs.rename(temporaryPath, filePath)
      reportsById.set(report.id, report)

      return { duplicate: false, report }
    })

    writeQueue = operation.catch(() => {})
    return operation
  }

  async function getReports() {
    await writeQueue.catch(() => {})
    return Array.from(reportsById.values())
  }

  return {
    saveReport,
    getReports
  }
}
