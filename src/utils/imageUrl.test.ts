import { describe, expect, it } from "vitest";
import { panelImageUrl } from "./imageUrl";

const BASE = import.meta.env.BASE_URL;

describe("panelImageUrl", () => {
  it("prefixes a deployment-relative gallery path", () => {
    expect(panelImageUrl("images/saga/issue-1.jpg")).toBe(`${BASE}images/saga/issue-1.jpg`);
  });

  it("leaves a blob: URL alone — the reader's own file never gets a prefix", () => {
    const blob = "blob:http://localhost:5173/8f0e-4d1a";
    expect(panelImageUrl(blob)).toBe(blob);
  });

  it("leaves data: and absolute http(s) URLs alone", () => {
    expect(panelImageUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(panelImageUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    expect(panelImageUrl("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
  });

  it("matches the self-contained schemes case-insensitively", () => {
    expect(panelImageUrl("BLOB:abc")).toBe("BLOB:abc");
    expect(panelImageUrl("HTTPS://example.com/a.jpg")).toBe("HTTPS://example.com/a.jpg");
  });

  it("does not mistake a path containing 'http' for an absolute URL", () => {
    expect(panelImageUrl("images/http-comics/1.jpg")).toBe(`${BASE}images/http-comics/1.jpg`);
  });
});
