import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const keyFor = (appId: string) => `agent:${appId}`;

export async function setAgentKey(appId: string, apiKey: string): Promise<void> {
  await redis.set(keyFor(appId), apiKey);
}

export async function getAgentKey(appId: string): Promise<string | null> {
  const v = await redis.get<string>(keyFor(appId));
  return v ?? null;
}

export async function deleteAgentKey(appId: string): Promise<void> {
  await redis.del(keyFor(appId));
}

export async function listAgentIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | number = 0;
  do {
    const result: [string | number, string[]] = await redis.scan(cursor, {
      match: "agent:*",
      count: 200,
    });
    cursor = result[0];
    for (const k of result[1]) {
      ids.push(k.replace(/^agent:/, ""));
    }
  } while (String(cursor) !== "0");
  return ids;
}
