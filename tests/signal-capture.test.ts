import { describe, it, expect } from "vitest";
import { captureSignals, SignalBuffer } from "../src/signal-capture";
import type { StyleSignal } from "../src/types";

describe("captureSignals", () => {
  it("parses valid STYLE_SIGNAL comment from AI message", () => {
    const user = "refactor this";
    const ai = "Here is the code.\n<!-- STYLE_SIGNAL: {\"category\": \"architecture\", \"content\": \"prefers Composition API\", \"evidence\": \"user asked for refactor\", \"confidence\": \"high\", \"source\": \"explicit\"} -->";
    const result = captureSignals(user, ai);
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe("architecture");
    expect(result[0]!.content).toBe("prefers Composition API");
    expect(result[0]!.confidence).toBe("high");
  });

  it("ignores malformed JSON in STYLE_SIGNAL comment", () => {
    const user = "";
    const ai = "<!-- STYLE_SIGNAL: {invalid json} -->";
    const result = captureSignals(user, ai);
    expect(result).toHaveLength(0);
  });

  it("ignores STYLE_SIGNAL with invalid schema", () => {
    const user = "";
    const ai = "<!-- STYLE_SIGNAL: {\"category\": \"invalid\", \"content\": \"test\"} -->";
    const result = captureSignals(user, ai);
    expect(result).toHaveLength(0);
  });

  it("parses multiple STYLE_SIGNAL comments", () => {
    const user = "";
    const ai = `First comment: <!-- STYLE_SIGNAL: {"category": "communication", "content": "prefers concise", "evidence": "said keep it short", "confidence": "high", "source": "explicit"} -->
Second comment: <!-- STYLE_SIGNAL: {"category": "toolchain", "content": "prefers pnpm", "evidence": "uses pnpm", "confidence": "medium", "source": "implicit_correction"} -->`;
    const result = captureSignals(user, ai);
    expect(result).toHaveLength(2);
    expect(result[0]!.category).toBe("communication");
    expect(result[1]!.category).toBe("toolchain");
  });

  it("returns empty array when no signals present", () => {
    const user = "hello";
    const ai = "hi there, how can I help?";
    const result = captureSignals(user, ai);
    expect(result).toHaveLength(0);
  });

  it("detects explicit '以后都' keyword", () => {
    const user = "以后都用 pnpm 安装依赖";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "explicit")).toBe(true);
  });

  it("detects explicit '记住' keyword", () => {
    const user = "记住，我不喜欢注释里的 Emoji";
    const ai = "明白";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "explicit")).toBe(true);
  });

  it("detects explicit '直接给' keyword", () => {
    const user = "直接给完整的代码就行";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "explicit")).toBe(true);
  });

  it("detects '不用解释' as explicit preference", () => {
    const user = "回答给结论，不用解释结论是怎么得出来的。";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "explicit")).toBe(true);
  });

  it("detects '先给' as explicit preference", () => {
    const user = "以后先给结论";
    const ai = "明白";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "explicit")).toBe(true);
  });

  it("detects '别废话' as explicit preference", () => {
    const user = "别废话，直接说重点";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "explicit")).toBe(true);
  });

  it("detects format feedback '不用解释'", () => {
    const user = "不用解释推导过程";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "format_feedback")).toBe(true);
  });

  it("detects format feedback '不要表格'", () => {
    const user = "不要表格，用列表就行";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "format_feedback")).toBe(true);
  });

  it("detects format feedback '别用 Emoji'", () => {
    const user = "别用 Emoji";
    const ai = "好的";
    const result = captureSignals(user, ai);
    expect(result.some((s) => s.source === "format_feedback")).toBe(true);
  });

  it("combines signals from both STYLE_SIGNAL and explicit keyword", () => {
    const user = "以后都用 pnpm";
    const ai = 'Sure.\n<!-- STYLE_SIGNAL: {"category": "architecture", "content": "likes Vue", "evidence": "uses Vue", "confidence": "high", "source": "explicit"} -->';
    const result = captureSignals(user, ai);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("infers category 'toolchain' for tool-related explicit keywords", () => {
    const user = "以后都用 pnpm 吧";
    const ai = "ok";
    const result = captureSignals(user, ai);
    const toolSignals = result.filter(
      (s) => s.source === "explicit" && s.category === "toolchain",
    );
    expect(toolSignals.length).toBeGreaterThanOrEqual(1);
  });

  it("infers category 'pitfall' for negative preference", () => {
    const user = "别这样太啰嗦了";
    const ai = "好的";
    const result = captureSignals(user, ai);
    const pitSignals = result.filter(
      (s) => s.source === "explicit" && s.category === "pitfall",
    );
    expect(pitSignals.length).toBeGreaterThanOrEqual(1);
  });

  it("infers category 'communication' as fallback", () => {
    const user = "我喜欢简洁的回答";
    const ai = "好的";
    const result = captureSignals(user, ai);
    const commSignals = result.filter(
      (s) => s.source === "explicit" && s.category === "communication",
    );
    expect(commSignals.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SignalBuffer", () => {
  it("starts empty", () => {
    const buf = new SignalBuffer();
    expect(buf.length).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it("adds signals", () => {
    const buf = new SignalBuffer();
    const signal: StyleSignal = {
      category: "communication",
      content: "prefers concise",
      evidence: "said so",
      confidence: "high",
      source: "explicit",
    };
    buf.push(signal);
    expect(buf.length).toBe(1);
    expect(buf.getAll()).toEqual([signal]);
  });

  it("drops oldest when over max (20)", () => {
    const buf = new SignalBuffer();
    for (let i = 0; i < 25; i++) {
      buf.push({
        category: "communication",
        content: `signal ${i}`,
        evidence: `test ${i}`,
        confidence: "medium",
        source: "explicit",
      });
    }
    expect(buf.length).toBe(20);
    const signals = buf.getAll();
    expect(signals[0]!.content).toBe("signal 5");
    expect(signals[19]!.content).toBe("signal 24");
  });

  it("clears all signals", () => {
    const buf = new SignalBuffer();
    buf.push({
      category: "communication",
      content: "test",
      evidence: "test",
      confidence: "medium",
      source: "explicit",
    });
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it("pushAll adds multiple signals", () => {
    const buf = new SignalBuffer();
    const signals: StyleSignal[] = [
      {
        category: "communication",
        content: "a",
        evidence: "evidence a",
        confidence: "high",
        source: "explicit",
      },
      {
        category: "toolchain",
        content: "b",
        evidence: "evidence b",
        confidence: "medium",
        source: "explicit",
      },
    ];
    buf.pushAll(signals);
    expect(buf.length).toBe(2);
  });

  it("dedups signals with same evidence", () => {
    const buf = new SignalBuffer();
    const signal: StyleSignal = {
      category: "communication",
      content: "a",
      evidence: "same",
      confidence: "high",
      source: "explicit",
    };
    buf.push(signal);
    buf.push({ ...signal, content: "b" });
    expect(buf.length).toBe(1);
    expect(buf.getAll()[0]!.content).toBe("a");
  });
});
