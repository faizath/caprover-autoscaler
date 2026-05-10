import { AppScalingConfig, GlobalConfig } from './types';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function numEnv(name: string, defaultVal: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = Number(raw);
  if (isNaN(n)) throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  return n;
}

function validateApp(app: unknown, index: number): AppScalingConfig {
  if (typeof app !== 'object' || app === null) {
    throw new Error(`CAPROVER_AUTOSCALER_CONFIGS[${index}] must be an object`);
  }
  const a = app as Record<string, unknown>;

  const required = ['appName', 'metricsQuery', 'cpuHigh', 'cpuLow', 'memHigh', 'memLow', 'minInstances', 'maxInstances'];
  for (const key of required) {
    if (a[key] === undefined) {
      throw new Error(`CAPROVER_AUTOSCALER_CONFIGS[${index}].${key} is required`);
    }
  }

  const appName = String(a.appName);
  const metricsQuery = String(a.metricsQuery);
  const cpuHigh = Number(a.cpuHigh);
  const cpuLow = Number(a.cpuLow);
  const memHigh = Number(a.memHigh);
  const memLow = Number(a.memLow);
  const minInstances = Number(a.minInstances);
  const maxInstances = Number(a.maxInstances);

  if (cpuHigh <= cpuLow) throw new Error(`CAPROVER_AUTOSCALER_CONFIGS[${index}]: cpuHigh (${cpuHigh}) must be > cpuLow (${cpuLow})`);
  if (memHigh <= memLow) throw new Error(`CAPROVER_AUTOSCALER_CONFIGS[${index}]: memHigh (${memHigh}) must be > memLow (${memLow})`);
  if (minInstances < 1) throw new Error(`CAPROVER_AUTOSCALER_CONFIGS[${index}]: minInstances must be >= 1`);
  if (maxInstances < minInstances) throw new Error(`CAPROVER_AUTOSCALER_CONFIGS[${index}]: maxInstances must be >= minInstances`);

  return { appName, metricsQuery, cpuHigh, cpuLow, memHigh, memLow, minInstances, maxInstances };
}

export function loadConfig(): GlobalConfig {
  const raw = process.env.CAPROVER_AUTOSCALER_CONFIGS;
  if (!raw) throw new Error('Missing required environment variable: CAPROVER_AUTOSCALER_CONFIGS');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('CAPROVER_AUTOSCALER_CONFIGS is not valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('CAPROVER_AUTOSCALER_CONFIGS must be a non-empty JSON array');
  }

  const apps = parsed.map((entry, i) => validateApp(entry, i));

  return {
    caproverUrl: requireEnv('CAPROVER_URL'),
    caproverPass: requireEnv('CAPROVER_PASS'),
    cadvisorUrl: process.env.CADVISOR_URL ?? 'http://srv-captain--cadvisor:8080',
    pollMs: numEnv('POLL_MS', 30_000),
    cooldownMs: numEnv('COOLDOWN_MS', 300_000),
    scaleUpConsecutive: numEnv('SCALE_UP_CONSECUTIVE', 2),
    scaleDownConsecutive: numEnv('SCALE_DOWN_CONSECUTIVE', 5),
    apps,
  };
}
