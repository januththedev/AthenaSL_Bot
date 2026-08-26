import "dotenv/config";

/**
 * One-off Neon connectivity probe: exercises every SQL shape the bot uses
 * against the real database. Run with USE_LOCAL_STORE=0 and POSTGRES_URL set.
 */
process.env["USE_LOCAL_STORE"] = "0";

const { kvSet, kvGet, kvDel, kvKeys, bumpFloodBucket, incrAskUsage, getChatSettings } =
  await import("../src/store.js");
const { config } = await import("../src/config.js");

console.log("db host:", new URL(config.postgresUrl).host);
console.log("local store mode:", config.useLocalStore);

await kvSet("probe:test", { hello: "world" }, 60);
console.log("get:", JSON.stringify(await kvGet("probe:test")));
console.log("flood1:", await bumpFloodBucket(-999999, 1));
console.log("flood2:", await bumpFloodBucket(-999999, 1));
console.log("keys:", JSON.stringify(await kvKeys("probe:*")));
console.log("quota1:", await incrAskUsage(-999999, 1));
console.log("settings:", JSON.stringify(await getChatSettings(-999999)).slice(0, 100));
console.log("del:", await kvDel("probe:test"));
console.log("DB ROUND-TRIP OK");
