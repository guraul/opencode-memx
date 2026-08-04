import { describe, it, expect } from "vitest";
import { loadMemxConfig, getConfigPath } from "../src/config";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const configPath = getConfigPath();

describe("loadMemxConfig throttleMinutes", () => {
  it("defaults throttleMinutes to 10", async () => {
    if (existsSync(configPath)) rmSync(configPath);
    const config = await loadMemxConfig();
    expect(config.throttleMinutes).toBe(10);
  });

  it("reads throttleMinutes from config file", async () => {
    mkdirSync(join(homedir(), ".opencode"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ throttleMinutes: 5 }), "utf-8");
    const config = await loadMemxConfig();
    expect(config.throttleMinutes).toBe(5);
  });
});
