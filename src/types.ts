export interface AppScalingConfig {
  appName: string;
  metricsQuery: string;
  cpuHigh: number;
  cpuLow: number;
  memHigh: number;
  memLow: number;
  minInstances: number;
  maxInstances: number;
}

export interface GlobalConfig {
  caproverUrl: string;
  caproverPass: string;
  cadvisorUrl: string;
  pollMs: number;
  cooldownMs: number;
  scaleUpConsecutive: number;
  scaleDownConsecutive: number;
  apps: AppScalingConfig[];
}

export interface PrevCpuSample {
  cpuUsageSeconds: number;
  scrapeTimestampMs: number;
}

export interface AppUtilization {
  appName: string;
  cpuPercent: number;
  memPercent: number | null;
}

export interface AppScalingState {
  appName: string;
  config: AppScalingConfig;
  lastScaledMs: number;
  consecutiveHighCount: number;
  consecutiveLowCount: number;
  prevCpuSamples: Map<string, PrevCpuSample>;
}
