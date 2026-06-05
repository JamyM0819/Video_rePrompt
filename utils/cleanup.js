const fs = require('fs');
const path = require('path');
const config = require('./config');

function cleanupJob(jobId, jobStore) {
  const uploadsDir = path.join(config.UPLOAD_DIR, jobId);
  const outputsDir = path.join(config.OUTPUT_DIR, jobId);

  for (const dir of [uploadsDir, outputsDir]) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[cleanup] Failed to remove ${dir}:`, err.message);
    }
  }

  jobStore.delete(jobId);
}

function startCleanupInterval(jobStore) {
  return setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of jobStore) {
      if (now - job.createdAt > config.JOB_TTL_MS) {
        cleanupJob(jobId, jobStore);
      }
    }
  }, 30 * 60 * 1000); // every 30 minutes
}

function cleanupAll(jobStore) {
  for (const jobId of jobStore.keys()) {
    cleanupJob(jobId, jobStore);
  }
}

module.exports = { cleanupJob, startCleanupInterval, cleanupAll };
