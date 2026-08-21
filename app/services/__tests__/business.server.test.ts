import { describe, expect, it } from "vitest";
import { isValidProfileUrl, sanitizeSocialProfiles } from "../business.server";

// Official store profiles are published as sameAs; we never verify a
// profile exists, so the only gate is "is this an absolute https URL".
// Anything else must be dropped silently, not published as junk.

describe("isValidProfileUrl", () => {
  it("accepts absolute https URLs", () => {
    expect(isValidProfileUrl("https://www.facebook.com/mystore")).toBe(true);
    expect(isValidProfileUrl("https://instagram.com/mystore")).toBe(true);
  });

  it("rejects http", () => {
    expect(isValidProfileUrl("http://www.facebook.com/mystore")).toBe(false);
  });

  it("rejects protocol-relative and bare domains", () => {
    expect(isValidProfileUrl("//facebook.com/mystore")).toBe(false);
    expect(isValidProfileUrl("facebook.com/mystore")).toBe(false);
    expect(isValidProfileUrl("www.facebook.com/mystore")).toBe(false);
  });

  it("rejects javascript and other non-http schemes", () => {
    expect(isValidProfileUrl("javascript:alert(1)")).toBe(false);
    expect(isValidProfileUrl("mailto:hello@example.com")).toBe(false);
  });

  it("rejects empty and malformed values", () => {
    expect(isValidProfileUrl("")).toBe(false);
    expect(isValidProfileUrl("not a url")).toBe(false);
  });
});

describe("sanitizeSocialProfiles", () => {
  it("keeps only valid https URLs, dropping the rest silently", () => {
    const out = sanitizeSocialProfiles({
      facebook: "https://www.facebook.com/mystore",
      instagram: "instagram.com/mystore",
      tiktok: "",
      x: "http://x.com/mystore",
    });
    expect(out).toEqual({ facebook: "https://www.facebook.com/mystore" });
  });

  it("trims whitespace before validating", () => {
    const out = sanitizeSocialProfiles({
      youtube: "  https://youtube.com/@mystore  ",
    });
    expect(out).toEqual({ youtube: "https://youtube.com/@mystore" });
  });

  it("returns an empty object when nothing was filled in", () => {
    expect(sanitizeSocialProfiles({})).toEqual({});
  });

  it("returns an empty object when every field is invalid", () => {
    const out = sanitizeSocialProfiles({
      facebook: "not a url",
      linkedin: "ftp://linkedin.com/company/mystore",
    });
    expect(out).toEqual({});
  });
});
