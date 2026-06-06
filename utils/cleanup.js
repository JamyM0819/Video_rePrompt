const fs = require('fs');
const path = require('path');
const config = require('./config');

function cleanupJob(jobId, jobStore) {
  // Keep uploads — only clean expired jobs from memory
  // Disk files are managed manually by the user via the UI
  jobStore.delete(jobId);
}

function startCleanupInterval() {
  // Disabled — uploads/outputs are no longer auto-cleaned
  return null;
}

function cleanupAll() {
  // Disabled — uploads/outputs are kept across restarts
}

module.exports = { cleanupJob, startCleanupInterval, cleanupAll };
