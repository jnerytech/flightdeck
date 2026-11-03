import { describe, expect, test } from "bun:test";
import { readImage, refuseImage } from "../src/lib/session-images.ts";

const MB = 1024 * 1024;

describe("session-images: what may join a message", () => {
  test("a PNG, JPEG, GIF or WebP up to 5 MB is taken", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(refuseImage({ type, size: 5 * MB }, 0)).toBeNull();
    }
  });

  test("another type is refused for its type, a big file for its size", () => {
    expect(refuseImage({ type: "image/svg+xml", size: 10 }, 0)).toBe("type");
    expect(refuseImage({ type: "text/plain", size: 10 }, 0)).toBe("type");
    expect(refuseImage({ type: "image/png", size: 5 * MB + 1 }, 0)).toBe("size");
  });

  test("a sixth image is refused, four already there is fine", () => {
    expect(refuseImage({ type: "image/png", size: 10 }, 4)).toBeNull();
    expect(refuseImage({ type: "image/png", size: 10 }, 5)).toBe("count");
  });

  test("readImage gives the declared type and the bytes in base64", async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    });
    expect(await readImage(file)).toEqual({ mediaType: "image/png", data: "iVBORw==" });
  });
});
