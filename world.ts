/**
 * 《星露谷物语》Stardew Valley SMAPI 桥接 MSP World（移植自 cortico-world-stardew）：
 * - 工具：stardew_observe, stardew_act
 * - 信号：stardew.state, stardew.day_started
 */
import type { MSPNode } from "../shared/msp.ts";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export class StardewWorld {
  private readonly bridgeUrl: string;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: FetchImpl;
  private node: MSPNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastVersion = "";
  private lastDay = "";

  constructor(config: { bridgeUrl?: string; pollIntervalMs?: number } = {}, fetchImpl?: FetchImpl) {
    this.bridgeUrl = (config.bridgeUrl ?? "http://127.0.0.1:17730").replace(/\/+$/, "");
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.fetchImpl = fetchImpl ?? ((u, i) => fetch(u, i));
  }

  attach(node: MSPNode): void {
    this.node = node;
    node.declareSignal("stardew.state", "星露谷角色与周围环境状态变化");
    node.declareSignal("stardew.day_started", "星露谷新的一天开始");

    node.tool(
      "stardew_observe",
      "读取星露谷独立联机角色、附近地图、作物、箱子、物品与菜单状态（含 version）",
      async () => {
        const res = await this.fetchImpl(`${this.bridgeUrl}/observe`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`Stardew SMAPI bridge HTTP ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      { type: "object", additionalProperties: false, properties: {} },
    );

    node.tool(
      "stardew_act",
      "执行星露谷动作（join/move/open_chest/face/select/use_tool/interact/sleep/ship/menu_click/menu_key/wait）",
      async (args) => {
        const res = await this.fetchImpl(`${this.bridgeUrl}/act`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Stardew SMAPI bridge HTTP ${res.status}`);
        return (await res.json()) as Record<string, unknown>;
      },
      {
        type: "object",
        required: ["version", "kind"],
        properties: {
          version: { type: "string" },
          kind: {
            type: "string",
            enum: ["join", "move", "open_chest", "face", "select", "use_tool", "interact", "sleep", "ship", "menu_click", "menu_key", "wait"],
          },
          x: { type: "integer" },
          y: { type: "integer" },
          direction: { type: "integer", minimum: 0, maximum: 3 },
          slot: { type: "integer", minimum: 0, maximum: 35 },
          button: { type: "integer" },
          count: { type: "integer" },
          key: { type: "string" },
          ticks: { type: "integer" },
          name: { type: "string" },
        },
      },
    );

    node.skill({
      name: "observe_then_act",
      summary: "先观察农场与角色位置并获取最新 version，再提交单步动作",
      whenToUse: "执行移动、开箱、使用工具、出货或菜单点击前使用",
      toolsUsed: ["stardew_observe", "stardew_act"],
    });
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    if (this.pollIntervalMs > 0) {
      this.timer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.bridgeUrl}/observe`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      const ver = String(data.version ?? "");
      if (ver && ver !== this.lastVersion) {
        this.lastVersion = ver;
        this.node?.publish("stardew.state", data);
      }
      const dayKey = `${data.season ?? ""}-${data.day ?? ""}`;
      if (data.day && dayKey !== this.lastDay) {
        this.lastDay = dayKey;
        this.node?.publish("stardew.day_started", { season: data.season, day: data.day, weather: data.weather ?? null });
      }
    } catch {
      /* ignore offline */
    }
  }
}
