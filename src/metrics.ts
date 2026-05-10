import axios from 'axios';
import { AppScalingConfig, AppUtilization, PrevCpuSample } from './types';

interface ParsedMetric {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// Matches: metric_name{labels} value [timestamp]
const LINE_RE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([\d.eE+\-]+)/;
const LABEL_RE = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

function parseLine(line: string): ParsedMetric | null {
  if (line.startsWith('#') || line.trim() === '') return null;
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const labels: Record<string, string> = {};
  if (m[2]) {
    LABEL_RE.lastIndex = 0;
    let lm: RegExpExecArray | null;
    while ((lm = LABEL_RE.exec(m[2])) !== null) {
      labels[lm[1]] = lm[2];
    }
  }
  return { name: m[1], labels, value: parseFloat(m[3]) };
}

// Extract the label value from a metricsQuery like:
//   container_label_com_docker_swarm_service_name="srv-captain--cargovision-api"
function extractServiceName(metricsQuery: string): string {
  const m = /"([^"]+)"/.exec(metricsQuery);
  return m ? m[1] : metricsQuery;
}

export async function fetchAndParseMetrics(
  cadvisorUrl: string,
  apps: AppScalingConfig[],
  prevCpuSamples: Map<string, Map<string, PrevCpuSample>>,
  scrapeTimeMs: number
): Promise<Map<string, AppUtilization>> {
  const resp = await axios.get<string>(`${cadvisorUrl}/metrics`, {
    timeout: 10_000,
    responseType: 'text',
  });

  const lines = resp.data.split('\n');
  const metrics: ParsedMetric[] = [];
  for (const line of lines) {
    const p = parseLine(line);
    if (p) metrics.push(p);
  }

  // Extract machine CPU cores (single value, no container labels)
  let machineCpuCores = 1;
  for (const m of metrics) {
    if (m.name === 'machine_cpu_cores') {
      machineCpuCores = m.value;
      break;
    }
  }

  // Build per-service-name lookup maps from all metrics
  // Only consider containers (id starts with /docker/)
  type ContainerData = {
    cpuUsageSeconds?: number;
    cpuQuota?: number;
    cpuPeriod?: number;
    memWorkingSet?: number;
    memLimit?: number;
  };

  const containers = new Map<string, Map<string, ContainerData>>();

  for (const m of metrics) {
    const id = m.labels['id'];
    if (!id || !id.startsWith('/docker/')) continue;

    const svcName = m.labels['container_label_com_docker_swarm_service_name'];
    if (!svcName) continue;

    if (!containers.has(svcName)) containers.set(svcName, new Map());
    const svcMap = containers.get(svcName)!;

    if (!svcMap.has(id)) svcMap.set(id, {});
    const c = svcMap.get(id)!;

    switch (m.name) {
      case 'container_cpu_usage_seconds_total': c.cpuUsageSeconds = m.value; break;
      case 'container_spec_cpu_quota':          c.cpuQuota = m.value; break;
      case 'container_spec_cpu_period':         c.cpuPeriod = m.value; break;
      case 'container_memory_working_set_bytes': c.memWorkingSet = m.value; break;
      case 'container_memory_limit_bytes':       c.memLimit = m.value; break;
    }
  }

  const result = new Map<string, AppUtilization>();

  for (const appCfg of apps) {
    const targetSvcName = extractServiceName(appCfg.metricsQuery);

    if (!prevCpuSamples.has(appCfg.appName)) {
      prevCpuSamples.set(appCfg.appName, new Map());
    }
    const appPrev = prevCpuSamples.get(appCfg.appName)!;

    const svcContainers = containers.get(targetSvcName);
    if (!svcContainers || svcContainers.size === 0) continue;

    const cpuPercents: number[] = [];
    const memPercents: number[] = [];
    let hasUnlimitedMem = false;

    for (const [containerId, c] of svcContainers) {
      // --- CPU ---
      if (c.cpuUsageSeconds !== undefined) {
        const prev = appPrev.get(containerId);
        const now = { cpuUsageSeconds: c.cpuUsageSeconds, scrapeTimestampMs: scrapeTimeMs };

        if (prev) {
          const deltaCpuS = c.cpuUsageSeconds - prev.cpuUsageSeconds;
          const deltaTimeS = (scrapeTimeMs - prev.scrapeTimestampMs) / 1000;

          if (deltaCpuS >= 0 && deltaTimeS > 0) {
            const cpuRateCores = deltaCpuS / deltaTimeS;
            const quota = c.cpuQuota ?? -1;
            const period = c.cpuPeriod ?? 100_000;
            const cpuLimitCores = quota > 0 ? quota / period : machineCpuCores;
            cpuPercents.push((cpuRateCores / cpuLimitCores) * 100);
          }
          // if deltaCpuS < 0 (counter reset), reset prev and skip
          if (deltaCpuS < 0) {
            appPrev.set(containerId, now);
            continue;
          }
        }
        appPrev.set(containerId, now);
      }

      // --- Memory ---
      if (c.memWorkingSet !== undefined) {
        const limit = c.memLimit ?? 0;
        if (limit === 0) {
          hasUnlimitedMem = true;
        } else {
          memPercents.push((c.memWorkingSet / limit) * 100);
        }
      }
    }

    if (cpuPercents.length === 0) continue;

    const cpuAvg = cpuPercents.reduce((a, b) => a + b, 0) / cpuPercents.length;
    const memAvg =
      hasUnlimitedMem || memPercents.length === 0
        ? null
        : memPercents.reduce((a, b) => a + b, 0) / memPercents.length;

    result.set(appCfg.appName, {
      appName: appCfg.appName,
      cpuPercent: cpuAvg,
      memPercent: memAvg,
    });
  }

  return result;
}
