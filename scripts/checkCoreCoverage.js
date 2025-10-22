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

function parseCoverageSummary() {
  const summaryPath = path.join(__dirname, '../coverage-summary.txt');

  if (!fs.existsSync(summaryPath)) {
    console.error('❌ 错误: 找不到覆盖率报告文件');
    console.error('   请先运行: forge coverage --report summary');
    process.exit(1);
  }

  const summary = fs.readFileSync(summaryPath, 'utf-8');
  
  // 解析总体覆盖率
  const totalMatch = summary.match(/Total:\s+(\d+\.\d+)%\s+(\d+\.\d+)%/);
  if (!totalMatch) {
    console.error('❌ 错误: 无法解析总体覆盖率');
    process.exit(1);
  }

  const totalLines = parseFloat(totalMatch[1]);
  const totalBranches = parseFloat(totalMatch[2]);

  // 解析各个合约的覆盖率
  const contractCoverage = {};
  const lines = summary.split('\n');
  
  for (const line of lines) {
    for (const contract of CORE_CONTRACTS) {
      if (line.includes(contract)) {
        const match = line.match(/(\d+\.\d+)%\s+(\d+\.\d+)%/);
        if (match) {
          contractCoverage[contract] = {
            lines: parseFloat(match[1]),
            branches: parseFloat(match[2])
          };
        }
      }
    }
  }

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
    
    console.log(`${status} ${contractName.padEnd(25)} | 行: ${contractCov.lines.toFixed(1)}% (目标 ${THRESHOLDS.lines}%) | 分支: ${contractCov.branches.toFixed(1)}% (目标 ${THRESHOLDS.branches}%)`);

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

  const coverage = parseCoverageSummary();

  const totalPassed = checkTotalCoverage(coverage);
  const contractsPassed = checkCoreContracts(coverage);

  printSummary(totalPassed, contractsPassed);
}

main();
