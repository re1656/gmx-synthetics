#!/usr/bin/env node

/**
 * 生成覆盖率badge数据
 */

const fs = require('fs');
const path = require('path');

const CORE_CONTRACTS = [
  'contracts/swap/SwapHandler.sol',
  'contracts/swap/SwapUtils.sol',
  'contracts/exchange/DepositHandler.sol',
  'contracts/exchange/WithdrawalHandler.sol',
  'contracts/pricing/SwapPricingUtils.sol'
];

function parseLcov() {
  const lcovPath = path.join(__dirname, '../lcov.info');

  if (!fs.existsSync(lcovPath)) {
    console.error('❌ lcov.info not found');
    process.exit(1);
  }

  const lcov = fs.readFileSync(lcovPath, 'utf-8');
  const lines = lcov.split('\n');

  const contractCoverage = {};
  let currentFile = null;
  let linesFound = 0;
  let linesHit = 0;
  let branchesFound = 0;
  let branchesHit = 0;

  for (const line of lines) {
    if (line.startsWith('SF:')) {
      currentFile = line.substring(3);
      linesFound = 0;
      linesHit = 0;
      branchesFound = 0;
      branchesHit = 0;
    } else if (line.startsWith('DA:')) {
      const parts = line.substring(3).split(',');
      linesFound++;
      if (parseInt(parts[1]) > 0) linesHit++;
    } else if (line.startsWith('BRDA:')) {
      const parts = line.substring(5).split(',');
      branchesFound++;
      if (parts[3] !== '-' && parseInt(parts[3]) > 0) branchesHit++;
    } else if (line === 'end_of_record' && currentFile) {
      const linesCoverage = linesFound > 0 ? (linesHit / linesFound) * 100 : 0;
      const branchesCoverage = branchesFound > 0 ? (branchesHit / branchesFound) * 100 : 100;

      contractCoverage[currentFile] = {
        lines: linesCoverage,
        branches: branchesCoverage,
        linesFound,
        linesHit,
        branchesFound,
        branchesHit
      };
      currentFile = null;
    }
  }

  // 计算核心合约总体覆盖率
  let totalLinesFound = 0;
  let totalLinesHit = 0;
  let totalBranchesFound = 0;
  let totalBranchesHit = 0;

  for (const contract of CORE_CONTRACTS) {
    const cov = contractCoverage[contract];
    if (cov) {
      totalLinesFound += cov.linesFound;
      totalLinesHit += cov.linesHit;
      totalBranchesFound += cov.branchesFound;
      totalBranchesHit += cov.branchesHit;
    }
  }

  const totalLines = totalLinesFound > 0 ? (totalLinesHit / totalLinesFound) * 100 : 0;
  const totalBranches = totalBranchesFound > 0 ? (totalBranchesHit / totalBranchesFound) * 100 : 100;

  return {
    lines: {
      percentage: totalLines,
      hit: totalLinesHit,
      found: totalLinesFound
    },
    branches: {
      percentage: totalBranches,
      hit: totalBranchesHit,
      found: totalBranchesFound
    }
  };
}

function main() {
  console.log('🎨 Generating coverage badge data...\n');

  const coverage = parseLcov();

  const badgeData = {
    lines: {
      percentage: coverage.lines.percentage.toFixed(1),
      hit: coverage.lines.hit,
      found: coverage.lines.found,
      color: coverage.lines.percentage >= 85 ? 'green' : coverage.lines.percentage >= 70 ? 'yellow' : 'red'
    },
    branches: {
      percentage: coverage.branches.percentage.toFixed(1),
      hit: coverage.branches.hit,
      found: coverage.branches.found,
      color: coverage.branches.percentage >= 80 ? 'green' : coverage.branches.percentage >= 65 ? 'yellow' : 'red'
    }
  };

  // 保存badge数据
  const badgeDataPath = path.join(__dirname, '../coverage-badge.json');
  fs.writeFileSync(badgeDataPath, JSON.stringify(badgeData, null, 2));

  console.log('📊 Coverage Badge Data:');
  console.log(`   Lines: ${badgeData.lines.percentage}% (${badgeData.lines.hit}/${badgeData.lines.found}) - ${badgeData.lines.color}`);
  console.log(`   Branches: ${badgeData.branches.percentage}% (${badgeData.branches.hit}/${badgeData.branches.found}) - ${badgeData.branches.color}`);
  console.log(`\n✅ Badge data saved to coverage-badge.json\n`);
}

main();
