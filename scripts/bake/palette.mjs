// Colour helpers. Every literal in the painters is authored as an sRGB hex
// because that is how a texture artist thinks; the painters work in linear
// light because that is the only space where mixing two colours is correct.

export const toLinear = (srgb) => (srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4))
export const toSrgb = (linear) => (linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055)

/** Parse "#rrggbb" into a linear-light triple. */
export const rgb = (hex) => [
  toLinear(parseInt(hex.slice(1, 3), 16) / 255),
  toLinear(parseInt(hex.slice(3, 5), 16) / 255),
  toLinear(parseInt(hex.slice(5, 7), 16) / 255),
]

/** out = mix(out, colour, t). The painters lerp toward a colour over and over. */
export const blend = (out, colour, t) => {
  if (t <= 0) return
  const k = t > 1 ? 1 : t
  out.r += (colour[0] - out.r) * k
  out.g += (colour[1] - out.g) * k
  out.b += (colour[2] - out.b) * k
}

/** out3 = mix(a, b, t), writing an array. Scratch colours for the painters. */
export const lerp3 = (out, a, b, t) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  out[0] = a[0] + (b[0] - a[0]) * k
  out[1] = a[1] + (b[1] - a[1]) * k
  out[2] = a[2] + (b[2] - a[2]) * k
  return out
}

/** out = mix(a, b, t), writing the sample. */
export const set2 = (out, a, b, t) => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  out.r = a[0] + (b[0] - a[0]) * k
  out.g = a[1] + (b[1] - a[1]) * k
  out.b = a[2] + (b[2] - a[2]) * k
}

/** Multiply the sample's albedo. Used for cavity shade and crack darkening. */
export const shade = (out, k) => {
  out.r *= k
  out.g *= k
  out.b *= k
}

/** Push saturation away from or toward the sample's own luminance. */
export const saturate = (out, k) => {
  const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722
  out.r = l + (out.r - l) * k
  out.g = l + (out.g - l) * k
  out.b = l + (out.b - l) * k
}
