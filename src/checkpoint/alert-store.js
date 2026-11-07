import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const STORE_PATH = resolve('data/checkpoint-alerts.json')

export async function loadAlerts () {
  try {
    const contents = await readFile(STORE_PATH, 'utf8')
    const alerts = JSON.parse(contents)
    if (!Array.isArray(alerts)) throw new Error('checkpoint alert store must contain an array')
    return alerts
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error(`Could not read checkpoint alert store: ${error.message}`)
  }
}

export async function saveAlert (alert) {
  const alerts = await loadAlerts()
  alerts.push(alert)
  await mkdir(dirname(STORE_PATH), { recursive: true })
  await writeFile(STORE_PATH, `${JSON.stringify(alerts, null, 2)}\n`)
  return alert
}
