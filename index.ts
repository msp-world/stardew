import { MSPNode, installShutdownHooks, mspOptionsFromEnv } from "../shared/msp.ts";
import { StardewWorld } from "./world.ts";

export async function startStardewNode(): Promise<{ node: MSPNode; world: StardewWorld }> {
  const node = new MSPNode(process.env.STARDEW_NODE_ID || "stardew", mspOptionsFromEnv("STARDEW"));
  const world = new StardewWorld({ bridgeUrl: process.env.STARDEW_BRIDGE_URL || "http://127.0.0.1:17730" });
  world.attach(node);
  const ep = await node.start();
  world.start();
  console.log(`[stardew] MSP node "${node.nodeId}" listening on ${ep.host}:${ep.port}`);
  return { node, world };
}

if (import.meta.main) {
  const { node, world } = await startStardewNode();
  installShutdownHooks(() => {
    world.stop();
    node.stop();
  });
}
