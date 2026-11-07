// topic.js
// Shared Hyperswarm discovery topic.
// Both the hiker and checkpoint must use the same value to find each other.

import crypto from 'node:crypto'

const TOPIC = crypto
  .createHash('sha256')
  .update('trailsignal-checkpoint-v1')
  .digest()

export { TOPIC }
