/**
 * The landing's material (COLOR_PICKER §8.2–8.3, §8.9): one fragment shader over a full-screen
 * triangle. A generated frame (form, light and grain, no color of its own) is read as brightness,
 * the brightness picks a color from a 256-entry ramp, a slow low-frequency displacement makes it
 * flow, a new ramp spreads out of a rounded rectangle (the picker panel) with a noisy edge, and a
 * still grain lies on top. Own code, MIT like the rest of the site.
 */

export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Rectangles under the copy, at most: the lines of the headline and the lede, and the header. */
export const CALM_RECTS = 8;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uMaterial;  // the frame, flipped so v = 0 is its bottom row
uniform sampler2D uFrom;      // ramp under the spreading one (LUT_SIZE × 1)
uniform sampler2D uTo;        // the new ramp
uniform vec2 uSize;           // canvas, device px
uniform float uDpr;           // device px per CSS px
uniform vec4 uFit;            // the frame's visible window: centre (uv) and size (uv)
uniform float uPhase;         // flow cycle, [0, 1)
uniform float uFlow;          // flow amplitude, in frame uv
uniform vec2 uInvert;         // from, to: 1 reads the frame upside down (a dark scene)
uniform vec4 uOrigin;         // the bleed's rectangle: centre and half size (device px, y up)
uniform float uOriginRadius;  // its corner radius (device px)
uniform float uBleed;         // 0: all uFrom; 1: all uTo; between: the spread's reach as a share of uReach
uniform float uReach;         // device px from the rectangle to the farthest corner, plus the edge
uniform vec4 uCalm[${CALM_RECTS}];        // rectangles under the copy: min and max (device px, y up); unused ones are empty
uniform float uCalmFeather;   // how far their lift fades out (device px)
uniform float uCalmLuminance; // the frame's brightness under the copy, at least
uniform float uGrain;         // amplitude of the still grain

out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}

float roundBox(vec2 p, vec2 half_, float radius) {
  vec2 q = abs(p) - half_ + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float box(vec2 p, vec4 rect) {
  vec2 centre = (rect.xy + rect.zw) * 0.5;
  vec2 half_ = max((rect.zw - rect.xy) * 0.5, 0.0);
  vec2 q = abs(p - centre) - half_;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = uFit.xy + (frag / uSize - 0.5) * uFit.zw;

  // Flow: two low-frequency fields walked round a circle, so the cycle closes on itself.
  float angle = 6.2831853 * uPhase;
  vec2 loop = vec2(cos(angle), sin(angle)) * 0.8;
  vec2 p = uv * vec2(1.7, 1.2);
  vec2 drift = vec2(noise(p + loop), noise(p + vec2(4.7, 1.9) + loop.yx))
             + 0.5 * vec2(noise(p * 2.1 + vec2(9.2, 3.1) - loop), noise(p * 2.1 + vec2(1.3, 7.7) - loop.yx));
  uv += (drift / 1.5 - 0.5) * 2.0 * uFlow;

  float luminance = dot(texture(uMaterial, uv).rgb, vec3(0.2126, 0.7152, 0.0722));

  // The calm zone under the copy: the frame's own paper, lifted where the paint would reach the text.
  float calm = 0.0;
  for (int index = 0; index < ${CALM_RECTS}; index++) {
    // A soft, round falloff: a linear one drew the rectangles' outline into the paper.
    float reach = max(box(frag, uCalm[index]), 0.0) / uCalmFeather;
    calm = max(calm, exp(-3.0 * reach * reach));
  }
  luminance = mix(luminance, max(luminance, uCalmLuminance), calm);

  vec3 from = texture(uFrom, vec2(mix(luminance, 1.0 - luminance, uInvert.x), 0.5)).rgb;
  vec3 to = texture(uTo, vec2(mix(luminance, 1.0 - luminance, uInvert.y), 0.5)).rgb;
  float spread = 1.0;
  if (uBleed < 1.0) {
    float distance_ = roundBox(frag - uOrigin.xy, uOrigin.zw, uOriginRadius);
    float edge = (fbm(frag / (150.0 * uDpr)) - 0.5) * 220.0 * uDpr;
    spread = 1.0 - smoothstep(-18.0 * uDpr, 18.0 * uDpr, distance_ + edge - uBleed * uReach);
  }
  vec3 color = mix(from, to, spread);

  // Still grain, about one CSS px across: it stays put while the material flows under it.
  color += (hash(floor(frag / max(1.0, uDpr * 0.75))) - 0.5) * uGrain;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
