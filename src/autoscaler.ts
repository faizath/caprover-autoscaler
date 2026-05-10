import { CapRoverModels } from 'caprover-api';
import { AppScalingConfig, AppScalingState, AppUtilization, GlobalConfig } from './types';
import { CapRoverClient } from './caprover';

type IAppDef = CapRoverModels.IAppDef;

export function createAppState(config: AppScalingConfig): AppScalingState {
  return {
    appName: config.appName,
    config,
    lastScaledMs: 0,
    consecutiveHighCount: 0,
    consecutiveLowCount: 0,
    prevCpuSamples: new Map(),
  };
}

export async function runScalingDecision(
  state: AppScalingState,
  util: AppUtilization,
  allApps: IAppDef[],
  client: CapRoverClient,
  globalConfig: GlobalConfig
): Promise<void> {
  const { config } = state;
  const now = Date.now();

  const currentInst = allApps.find((a) => a.appName === state.appName)?.instanceCount ?? config.minInstances;

  // 1. Determine pressure
  const isHigh =
    util.cpuPercent > config.cpuHigh ||
    (util.memPercent !== null && util.memPercent > config.memHigh);

  const isLow =
    util.cpuPercent < config.cpuLow &&
    (util.memPercent === null || util.memPercent < config.memLow);

  // 2. Update consecutive counters
  if (isHigh) {
    state.consecutiveHighCount++;
    state.consecutiveLowCount = 0;
  } else if (isLow) {
    state.consecutiveLowCount++;
    state.consecutiveHighCount = 0;
  } else {
    state.consecutiveHighCount = 0;
    state.consecutiveLowCount = 0;
  }

  const cooldownMs = globalConfig.cooldownMs;
  const cooldownActive = (now - state.lastScaledMs) < cooldownMs;

  const memStr = util.memPercent !== null ? `${util.memPercent.toFixed(1)}%` : 'n/a';
  const prefix = `[${state.appName}] cpu=${util.cpuPercent.toFixed(1)}% mem=${memStr} inst=${currentInst} high=${state.consecutiveHighCount}/${globalConfig.scaleUpConsecutive} low=${state.consecutiveLowCount}/${globalConfig.scaleDownConsecutive}`;

  // 3. Cooldown gate
  if (cooldownActive) {
    const remaining = Math.ceil((cooldownMs - (now - state.lastScaledMs)) / 1000);
    console.log(`${prefix} → HOLD (cooldown ${remaining}s remaining)`);
    return;
  }

  // 4. Scale-up check
  if (state.consecutiveHighCount >= globalConfig.scaleUpConsecutive && currentInst < config.maxInstances) {
    const newInst = currentInst + 1;
    await client.setInstanceCount(state.appName, newInst, allApps);
    state.lastScaledMs = now;
    state.consecutiveHighCount = 0;
    state.consecutiveLowCount = 0;
    console.log(`${prefix} → SCALE UP ${currentInst}→${newInst}`);
    return;
  }

  // 5. Scale-down check
  if (state.consecutiveLowCount >= globalConfig.scaleDownConsecutive && currentInst > config.minInstances) {
    const newInst = currentInst - 1;
    await client.setInstanceCount(state.appName, newInst, allApps);
    state.lastScaledMs = now;
    state.consecutiveHighCount = 0;
    state.consecutiveLowCount = 0;
    console.log(`${prefix} → SCALE DOWN ${currentInst}→${newInst}`);
    return;
  }

  console.log(`${prefix} → HOLD`);
}
