#!/usr/bin/env node

/**
 * Core Contracts Coverage Threshold Check Script
 *
 * 验证核心合约覆盖率是否达到要求：
 * - 行覆盖率 ≥ 85%
 * - 分支覆盖率 ≥ 80%
 */

const fs = require('fs');
const path = require('path');

// 核心合约覆盖率阈值
const THRESHOLDS = {
  lines: 85,      // 行覆盖率 ≥ 85%
  branches: 80,   // 分支覆盖率 ≥ 80%
};

// 目标核心合约
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
    console.error('❌ 错误: 找不到 lcov.info 文件');
    console.error('   请先运行: forge coverage --report lcov');
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
      // 如果没有分支，认为是100%覆盖（因为没有分支需要测试）
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

  // 计算总体覆盖率
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
  const totalBranches = totalBranchesFound > 0 ? (totalBranchesHit / totalBranchesFound) * 100 : 0;

  return {
    total: { lines: totalLines, branches: totalBranches },
    contracts: contractCoverage
  };
}

function checkTotalCoverage(coverage) {
  console.log('\n========================================');
  console.log('📊 总体覆盖率检查');
  console.log('========================================\n');

  const total = coverage.total;
  const linesPass = total.lines >= THRESHOLDS.lines;
  const branchesPass = total.branches >= THRESHOLDS.branches;
  const allPassed = linesPass && branchesPass;

  console.log(`Lines:    ${total.lines.toFixed(2)}% | 目标: ${THRESHOLDS.lines}% | ${linesPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Branches: ${total.branches.toFixed(2)}% | 目标: ${THRESHOLDS.branches}% | ${branchesPass ? '✅ PASS' : '❌ FAIL'}`);

  return allPassed;
}

function checkCoreContracts(coverage) {
  console.log('\n========================================');
  console.log('🎯 核心合约覆盖率检查');
  console.log('========================================\n');

  let allPassed = true;

  for (const contract of CORE_CONTRACTS) {
    const contractCov = coverage.contracts[contract];
    
    if (!contractCov) {
      console.log(`⚠️  ${contract.padEnd(50)} | 未找到覆盖率数据`);
      allPassed = false;
      continue;
    }

    const linesPass = contractCov.lines >= THRESHOLDS.lines;
    const branchesPass = contractCov.branches >= THRESHOLDS.branches;
    const passed = linesPass && branchesPass;

    const status = passed ? '✅' : '❌';
    const contractName = contract.split('/').pop();

    // 显示分支覆盖率，如果没有分支则显示 "N/A"
    const branchDisplay = contractCov.branchesFound > 0
      ? `${contractCov.branches.toFixed(1)}% (目标 ${THRESHOLDS.branches}%)`
      : 'N/A (无分支)';

    console.log(`${status} ${contractName.padEnd(25)} | 行: ${contractCov.lines.toFixed(1)}% (目标 ${THRESHOLDS.lines}%) | 分支: ${branchDisplay}`);

    if (!passed) {
      allPassed = false;
    }
  }

  return allPassed;
}

function printSummary(totalPassed, contractsPassed) {
  console.log('\n========================================');
  console.log('📋 覆盖率检查摘要');
  console.log('========================================\n');

  if (totalPassed && contractsPassed) {
    console.log('✅ 所有覆盖率检查通过！');
    console.log('   - 总体覆盖率达标 (≥85% 行, ≥80% 分支)');
    console.log('   - 核心合约覆盖率达标');
    console.log('\n🎉 核心合约覆盖率要求已满足！\n');
    process.exit(0);
  } else {
    console.log('❌ 覆盖率检查失败');

    if (!totalPassed) {
      console.log('   - 总体覆盖率未达标');
    }

    if (!contractsPassed) {
      console.log('   - 部分核心合约覆盖率未达标');
    }

    console.log('\n💡 建议:');
    console.log('   1. 检查未覆盖的分支和行');
    console.log('   2. 添加更多测试用例');
    console.log('   3. 运行: forge coverage --report summary 查看详细报告\n');

    process.exit(1);
  }
}

function main() {
  console.log('🔍 开始核心合约覆盖率阈值检查...\n');

  const coverage = parseLcov();

  const totalPassed = checkTotalCoverage(coverage);
  const contractsPassed = checkCoreContracts(coverage);

  printSummary(totalPassed, contractsPassed);
}

main();
