import { describe, it, expect } from "vitest"
import {
  computeNextRun,
  sanitizeScheduleName,
  parseSkillMdFrontmatter,
} from "../services/scheduler.js"

describe("computeNextRun", () => {
  it("returns a Unix epoch in seconds", () => {
    const next = computeNextRun("* * * * *")
    expect(typeof next).toBe("number")
    expect(Number.isInteger(next)).toBe(true)
    // Sane window: between 2020 and year 2100
    expect(next).toBeGreaterThan(1577836800)
    expect(next).toBeLessThan(4102444800)
  })

  it("returns a future timestamp", () => {
    const now = Math.floor(Date.now() / 1000)
    const next = computeNextRun("*/5 * * * *")
    expect(next).toBeGreaterThanOrEqual(now)
    // Next */5 fire is at most 5 minutes + small slack
    expect(next - now).toBeLessThanOrEqual(5 * 60 + 5)
  })

  it("throws on invalid cron expressions", () => {
    expect(() => computeNextRun("not a cron")).toThrow()
    expect(() => computeNextRun("99 99 99 99 99")).toThrow()
  })
})

describe("sanitizeScheduleName", () => {
  it("lowercases input", () => {
    expect(sanitizeScheduleName("Morning Briefing")).toBe("morning-briefing")
  })

  it("collapses whitespace into single dash", () => {
    expect(sanitizeScheduleName("a   b  c")).toBe("a-b-c")
  })

  it("strips non-alphanumeric (keeps dashes)", () => {
    expect(sanitizeScheduleName("hello!@#$%world")).toBe("helloworld")
  })

  it("preserves valid dashes but collapses runs", () => {
    expect(sanitizeScheduleName("foo---bar")).toBe("foo-bar")
  })

  it("trims leading/trailing dashes", () => {
    expect(sanitizeScheduleName("---x---")).toBe("x")
  })

  it("strips Hungarian accents (lossy by design)", () => {
    // Accented chars are not [a-z0-9-], so they get removed
    expect(sanitizeScheduleName("árvíztűrő tükörfúrógép")).toBe("rvztr-tkrfrgp")
  })

  it("returns empty string for whitespace-only input", () => {
    expect(sanitizeScheduleName("   ")).toBe("")
  })

  it("handles plain alphanumeric unchanged", () => {
    expect(sanitizeScheduleName("task42")).toBe("task42")
  })
})

describe("parseSkillMdFrontmatter", () => {
  it("parses name and description from frontmatter", () => {
    const md = `---
name: Test Skill
description: Does the thing
---

Body content here.`
    const result = parseSkillMdFrontmatter(md)
    expect(result.name).toBe("Test Skill")
    expect(result.description).toBe("Does the thing")
    expect(result.body).toBe("Body content here.")
  })

  it("returns body only when no frontmatter present", () => {
    const md = "Just a body, no fences."
    const result = parseSkillMdFrontmatter(md)
    expect(result.name).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.body).toBe("Just a body, no fences.")
  })

  it("trims whitespace around body", () => {
    const md = `---
name: X
description: Y
---


  Body has padding.

`
    const result = parseSkillMdFrontmatter(md)
    expect(result.body).toBe("Body has padding.")
  })

  it("handles missing name field gracefully", () => {
    const md = `---
description: Only desc
---
Body.`
    const result = parseSkillMdFrontmatter(md)
    expect(result.name).toBeUndefined()
    expect(result.description).toBe("Only desc")
  })

  it("preserves multi-line body content verbatim (modulo edge trim)", () => {
    const md = `---
name: Multi
description: Line
---
Line one
Line two
Line three`
    const result = parseSkillMdFrontmatter(md)
    expect(result.body).toContain("Line one")
    expect(result.body).toContain("Line three")
  })
})


describe("ScheduledTask interface", () => {
  it("ScheduledTask carries lastRun field for restart-safe persistence", () => {
    // Type-level check: just verify the import shape is what hydrateLastRunCache relies on.
    // The actual hydrate path is integration-level (filesystem), tested via restart drill.
    const t: import("../services/scheduler.js").ScheduledTask = {
      name: "x", description: "", prompt: "p", schedule: "* * * * *",
      agent: "nova", enabled: true, createdAt: 0, type: "task",
      lastRun: 1700000000, lastResult: "ok",
    }
    expect(t.lastRun).toBe(1700000000)
    expect(t.lastResult).toBe("ok")
  })
})
