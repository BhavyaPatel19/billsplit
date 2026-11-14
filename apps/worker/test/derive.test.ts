import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { deriveImages, MAX_IMAGE_PX, THUMBNAIL_PX } from "../src/process.js";

/** A camera-like JPEG: large, rotated by EXIF orientation, with identifying metadata. */
async function photo(width: number, height: number): Promise<Uint8Array> {
  return sharp({ create: { width, height, channels: 3, background: "#c8c8c8" } })
    .jpeg()
    .withExif({
      IFD0: { ImageDescription: "the uploader's living room", Artist: "Someone" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("deriveImages", () => {
  it("re-encodes to JPEG, applies the orientation and strips metadata", async () => {
    const src = await photo(3000, 1200);
    const srcMeta = await sharp(src).metadata();
    expect(srcMeta.exif).toBeDefined();
    expect(srcMeta.orientation).toBe(6);

    const { image, thumbnail, width, height } = await deriveImages(src);
    const meta = await sharp(image).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(image.toString("latin1")).not.toContain("living room");
    // Orientation 6 is a 90° turn, so the long side becomes the height, then fits in 2000.
    expect([width, height]).toEqual([800, MAX_IMAGE_PX]);
    expect(meta.width).toBe(800);

    const thumb = await sharp(thumbnail).metadata();
    expect(Math.max(thumb.width, thumb.height)).toBe(THUMBNAIL_PX);
    expect(thumb.exif).toBeUndefined();
  });

  it("does not enlarge a small image", async () => {
    const { width, height } = await deriveImages(await photo(640, 480));
    expect([width, height]).toEqual([480, 640]);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(
      deriveImages(new TextEncoder().encode("<html>not a photo</html>")),
    ).rejects.toThrow();
  });
});
