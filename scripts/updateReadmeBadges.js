#!/usr/bin/env node

/**
 * 更新README.md中的覆盖率badge
 */

const fs = require('fs');
const path = require('path');

function updateBadges() {
  const badgeDataPath = path.join(__dirname, '../coverage-badge.json');
  const readmePath = path.join(__dirname, '../README.md');

  if (!fs.existsSync(badgeDataPath)) {
    console.error('❌ coverage-badge.json not found');
    process.exit(1);
  }

  if (!fs.existsSync(readmePath)) {
    console.error('❌ README.md not found');
    process.exit(1);
  }

  const badgeData = JSON.parse(fs.readFileSync(badgeDataPath, 'utf-8'));
  let readme = fs.readFileSync(readmePath, 'utf-8');

  // 更新coverage总体badge
  const coverageBadge = `[![Coverage](https://img.shields.io/badge/coverage-${encodeURIComponent(badgeData.lines.percentage + '%')}-${badgeData.lines.color})](./coverage_merged/index.html)`;
  readme = readme.replace(
    /\[!\[Coverage\]\(https:\/\/img\.shields\.io\/badge\/coverage-[^\)]+\)\]\([^\)]+\)/,
    coverageBadge
  );

  // 更新lines badge
  const linesBadge = `[![Lines](https://img.shields.io/badge/lines-${encodeURIComponent(badgeData.lines.hit + '/' + badgeData.lines.found)}-${badgeData.lines.color})](./coverage_merged/index.html)`;
  readme = readme.replace(
    /\[!\[Lines\]\(https:\/\/img\.shields\.io\/badge\/lines-[^\)]+\)\]\([^\)]+\)/,
    linesBadge
  );

  // 更新branches badge
  const branchLabel = badgeData.branches.found > 0
    ? `${badgeData.branches.hit}/${badgeData.branches.found}`
    : 'no data';
  const branchColor = badgeData.branches.found > 0 ? badgeData.branches.color : 'lightgrey';
  const branchesBadge = `[![Branches](https://img.shields.io/badge/branches-${encodeURIComponent(branchLabel)}-${branchColor})](./coverage_merged/index.html)`;
  readme = readme.replace(
    /\[!\[Branches\]\(https:\/\/img\.shields\.io\/badge\/branches-[^\)]+\)\]\([^\)]+\)/,
    branchesBadge
  );

  fs.writeFileSync(readmePath, readme);

  console.log('✅ README.md badges updated:');
  console.log(`   Coverage: ${badgeData.lines.percentage}% (${badgeData.lines.color})`);
  console.log(`   Lines: ${badgeData.lines.hit}/${badgeData.lines.found} (${badgeData.lines.color})`);
  console.log(`   Branches: ${branchLabel} (${branchColor})`);
}

updateBadges();
