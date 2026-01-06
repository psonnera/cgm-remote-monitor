#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  let commit = process.env.HEAD; // Check if HEAD env var is set (Docker build)
  
  if (!commit) {
    // Try to get git commit hash from git command
    commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  }
  
  // Create the cache directory if it doesn't exist
  const cacheDir = path.join(__dirname, '..', 'node_modules', '.cache', '_ns_cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  // Write the commit hash to a file
  const commitFile = path.join(cacheDir, 'gitCommit');
  fs.writeFileSync(commitFile, commit, 'utf8');
  
  console.log('Git commit hash saved:', commit);
} catch (err) {
  // If git is not available or we're not in a git repo, write 'unknown'
  console.log('Could not determine git commit hash:', err.message);
}
