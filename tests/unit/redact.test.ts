import { describe, expect, it } from "vitest";
import { redactString } from "@/lib/redact";

describe("redact", () => {
  it("strips bearer tokens and userinfo before anything is logged", () => {
    const raw = "failed Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz //user:secret@github.com";
    const clean = redactString(raw);
    expect(clean).not.toContain("ghp_");
    expect(clean).not.toContain("secret@");
    expect(clean).toContain("[redacted]");
  });
});
