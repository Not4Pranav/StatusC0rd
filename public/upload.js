"use strict";

/**
 * Client-side image helper shared by the setup wizard and the dashboard.
 * Downscales pictures before upload so the request stays small and Discord gets
 * a sensible square asset (Discord recommends 512px+ for presence art).
 */
(() => {
  const MAX_OUTPUT_BYTES = 900 * 1024;

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That file is not a readable image."));
      image.src = dataUrl;
    });
  }

  /**
   * Resize an uploaded file into a square data URL.
   * @param {File} file
   * @param {number} size target edge length in pixels
   */
  async function prepare(file, size = 512) {
    if (!file) throw new Error("No file selected.");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
    }
    if (file.size > 12 * 1024 * 1024) throw new Error("That file is larger than 12 MB.");

    const source = await readFile(file);
    if (file.type === "image/gif") return source; // keep animation, server caps size

    const image = await loadImage(source);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";

    // Cover-fit: crop the centre of the source image into a square.
    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    context.drawImage(image, sx, sy, side, side, 0, 0, size, size);

    let quality = 0.92;
    let out = canvas.toDataURL("image/webp", quality);
    while (out.length > MAX_OUTPUT_BYTES * 1.37 && quality > 0.5) {
      quality -= 0.1;
      out = canvas.toDataURL("image/webp", quality);
    }
    return out;
  }

  window.StatusC0rdUpload = { prepare, readFile };
})();
