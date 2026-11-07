// topic.js
// Shared Hyperswarm discovery topic.
// Both the hiker and checkpoint must use the same value to find each other.

const crypto = require('crypto')

const TOPIC = crypto
  .createHash('sha256')
  .update('trailsignal-checkpoint-v1')
  .digest()

module.exports = { TOPIC }
