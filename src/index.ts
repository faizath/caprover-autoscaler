import { loadConfig } from './config';
import { fetchAndParseMetrics } from './metrics';
import { CapRoverClient } from './caprover';
import { createAppState, runScalingDecision } from './autoscaler';
import { AppScalingState, PrevCpuSample } from './types';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new CapRoverClient(config);

  const appStates: AppScalingState[] = config.apps.map(createAppState);
  const prevCpuSamples = new Map<string, Map<string, PrevCpuSample>>();

  console.log('[autoscaler] Starting CapRover horizontal autoscaler');
  console.log(`[autoscaler] Apps: ${config.apps.map((a) => a.appName).join(', ')}`);
  console.log(`[autoscaler] Poll: ${config.pollMs}ms | Cooldown: ${config.cooldownMs}ms | Scale-up after: ${config.scaleUpConsecutive} | Scale-down after: ${config.scaleDownConsecutive}`);

  let isRunning = false;

  async function pollCycle(): Promise<void> {
    if (isRunning) {
      console.warn('[autoscaler] Previous poll cycle still running, skipping');
      return;
    }
    isRunning = true;

    try {
      const now = Date.now();

      const utilizations = await fetchAndParseMetrics(
        config.cadvisorUrl,
        config.apps,
        prevCpuSamples,
        now
      );

      const allApps = await client.getAllAppDefinitions();

      for (const state of appStates) {
        const util = utilizations.get(state.appName);
        if (!util) {
          console.warn(`[${state.appName}] No metrics found (first poll or container not running)`);
          continue;
        }
        try {
          await runScalingDecision(state, util, allApps, client, config);
        } catch (err) {
          console.error(`[${state.appName}] Scaling decision error:`, (err as Error).message);
        }
      }
    } catch (err) {
      console.error('[autoscaler] Poll cycle error:', (err as Error).message);
    } finally {
      isRunning = false;
    }
  }

  const interval = setInterval(() => { void pollCycle(); }, config.pollMs);

  function shutdown(): void {
    console.log('[autoscaler] Shutting down');
    clearInterval(interval);
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Run immediately instead of waiting one full interval
  await pollCycle();
}

main().catch((err) => {
  console.error('[autoscaler] Fatal error:', (err as Error).message);
  process.exit(1);
});
