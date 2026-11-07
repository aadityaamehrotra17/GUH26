
'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

async function createReportStore(filePath) {
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

  // Serialize writes to prevent simultaneous connections from
  // overwriting each other's reports.
  let writeQueue = Promise.resolve()

  function saveReport(report) {
    const operation = writeQueue.catch(() => {}).then(async () => {
      const existing = reportsById.get(report.id)

      // Repeated delivery of the same report is idempotent.
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(report)) {
          throw new Error('Report ID already exists with different content')
        }

        return { duplicate: true }
      }

      const nextReports = [
        ...reportsById.values(),
        report
      ]

      const temporaryPath = `${filePath}.${process.pid}.tmp`

      // Write the complete file before replacing the previous version.
      await fs.writeFile(
        temporaryPath,
        JSON.stringify(nextReports, null, 2) + '\n',
        'utf8'
      )

      await fs.rename(temporaryPath, filePath)

      // Update memory only after the disk write succeeds.
      reportsById.set(report.id, report)

      return { duplicate: false }
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

module.exports = { createReportStore }
