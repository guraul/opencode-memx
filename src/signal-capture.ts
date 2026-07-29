import type { StyleSignal } from "./types";
import { StyleSignalSchema } from "./types";
import type { Category } from "./types";

const MAX_BUFFER_SIZE = 20;

const EXPLICIT_KEYWORD_RE = /以后都|记住|不要再用|我喜欢|我偏好|别这样|太啰嗦|直接给/;

const NEGATION_WORDS = ["不要", "别用", "别", "不要再用"];
const FORMAT_WORDS = ["表格", "Emoji", "代码块", "列表", "标题"];

const STYLE_SIGNAL_RE = /<!--\s*STYLE_SIGNAL:\s*(\{.+?\})\s*-->/;

function buildFormatFeedbackRe(): RegExp {
  const negPattern = NEGATION_WORDS.map((w) => `(${w})`).join("|");
  const fmtPattern = FORMAT_WORDS.map((w) => `(${w})`).join("|");
  return new RegExp(`(?:${negPattern}).{0,20}(?:${fmtPattern})|(?:${fmtPattern}).{0,20}(?:${negPattern})`);
}

const FORMAT_FEEDBACK_RE = buildFormatFeedbackRe();

export function captureSignals(userMessage: string, aiMessage: string): StyleSignal[] {
  const signals: StyleSignal[] = [];

  const htmlSignals = parseStyleSignalComments(aiMessage);
  signals.push(...htmlSignals);

  const explicitSignal = detectExplicitPreference(userMessage);
  if (explicitSignal) signals.push(explicitSignal);

  const formatSignal = detectFormatFeedback(userMessage);
  if (formatSignal) signals.push(formatSignal);

  return signals;
}

function parseStyleSignalComments(aiMessage: string): StyleSignal[] {
  const signals: StyleSignal[] = [];
  let match: RegExpExecArray | null;

  const re = new RegExp(STYLE_SIGNAL_RE.source, "g");
  while ((match = re.exec(aiMessage)) !== null) {
    try {
      const raw = match[1]!;
      const parsed = JSON.parse(raw);
      const result = StyleSignalSchema.safeParse(parsed);
      if (result.success) {
        signals.push(result.data);
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return signals;
}

function detectExplicitPreference(userMessage: string): StyleSignal | null {
  if (EXPLICIT_KEYWORD_RE.test(userMessage)) {
    return {
      category: inferCategory(userMessage),
      content: extractContent(userMessage),
      evidence: userMessage.slice(0, 200),
      confidence: "medium",
      source: "explicit",
    };
  }
  return null;
}

function detectFormatFeedback(userMessage: string): StyleSignal | null {
  if (FORMAT_FEEDBACK_RE.test(userMessage)) {
    return {
      category: "communication",
      content: extractContent(userMessage),
      evidence: userMessage.slice(0, 200),
      confidence: "high",
      source: "format_feedback",
    };
  }
  return null;
}

function inferCategory(message: string): Category {
  const lower = message.toLowerCase();
  if (/\b(pnpm|npm|yarn|neovim|vim|wezterm|terminal|tool|plugin|extension|editor|IDE)\b/i.test(lower)) {
    return "toolchain";
  }
  if (/\b(架构|设计|模式|orm|数据库|前端|后端|框架|svelte|react|vue|angular|drizzle|prisma)\b/i.test(lower)) {
    return "architecture";
  }
  if (/不要|别|避免|讨厌|不喜欢|别用|太啰嗦|太详细|太长/i.test(lower)) {
    return "pitfall";
  }
  return "communication";
}

function extractContent(message: string): string {
  const cleaned = message
    .replace(/以后都|记住|不要再用|我喜欢|我偏好|别这样|太啰嗦|直接给/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 100 ? cleaned.slice(0, 97) + "..." : cleaned;
}

export class SignalBuffer {
  private signals: StyleSignal[] = [];

  push(signal: StyleSignal): void {
    if (this.signals.length >= MAX_BUFFER_SIZE) {
      this.signals.shift();
    }
    this.signals.push(signal);
  }

  pushAll(newSignals: StyleSignal[]): void {
    for (const s of newSignals) {
      this.push(s);
    }
  }

  getAll(): StyleSignal[] {
    return [...this.signals];
  }

  clear(): void {
    this.signals = [];
  }

  get length(): number {
    return this.signals.length;
  }
}
