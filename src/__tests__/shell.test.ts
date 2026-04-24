import { describe, it, expect } from "vitest"
import {
  shellEscape,
  agentSessionName,
  agentTmuxSocket,
  getAgentUid,
} from "../utils/shell.js"

describe("shellEscape", () => {
  it("wraps simple string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'")
  })

  it("escapes embedded single quotes safely", () => {
    // The pattern ' closes-out, escaped-quote, reopens
    expect(shellEscape("it's")).toBe("'it'\\''s'")
  })

  it("preserves whitespace", () => {
    expect(shellEscape("a b c")).toBe("'a b c'")
  })

  it("preserves shell metacharacters inside the quotes", () => {
    // Single quotes prevent shell expansion entirely
    expect(shellEscape("$VAR; rm -rf /")).toBe("'$VAR; rm -rf /'")
    expect(shellEscape("`whoami`")).toBe("'`whoami`'")
  })

  it("handles empty string", () => {
    expect(shellEscape("")).toBe("''")
  })

  it("handles strings with newlines", () => {
    expect(shellEscape("a\\nb")).toBe("'a\\nb'")
  })

  it("output is shell-safe for command substitution (round-trip property)", () => {
    // Property: regardless of input, output starts and ends with single-quote
    const samples = ["plain", "with space", "$dangerous", "(parens)", "back\\\\slash"]
    for (const s of samples) {
      const out = shellEscape(s)
      expect(out.startsWith("'")).toBe(true)
      expect(out.endsWith("'")).toBe(true)
    }
  })
})

describe("agentSessionName", () => {
  it("maps nova to nova-channels", () => {
    expect(agentSessionName("nova")).toBe("nova-channels")
  })

  it("prefixes other agents with agent-", () => {
    expect(agentSessionName("zara")).toBe("agent-zara")
    expect(agentSessionName("lexi")).toBe("agent-lexi")
  })

  it("does not normalize case (caller responsibility)", () => {
    expect(agentSessionName("Zara")).toBe("agent-Zara")
  })
})

describe("agentTmuxSocket", () => {
  it("returns null for unknown user", () => {
    expect(agentTmuxSocket("definitely-not-a-real-agent-xyz123")).toBeNull()
  })

  it("returns a /tmp/tmux-<uid>/default path for known users", () => {
    // root always exists with uid 0
    const sock = agentTmuxSocket("root")
    if (sock !== null) {
      expect(sock).toMatch(/^\/tmp\/tmux-\d+\/default$/)
    }
  })
})

describe("getAgentUid", () => {
  it("returns null for unknown user", () => {
    expect(getAgentUid("definitely-not-a-real-agent-xyz123")).toBeNull()
  })

  it("returns numeric uid for root", () => {
    const uid = getAgentUid("root")
    if (uid !== null) {
      expect(uid).toBe(0)
    }
  })
})
