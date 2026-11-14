/**
 * The paint under the whole color picker landing (COLOR_PICKER §8.2–§8.3, §8.9): one fragment shader
 * over a full-screen triangle, drawn in page coordinates. The long frame (form, light and grain, no
 * color of its own) lies along the page as lib/paint-layout.ts says — tiles mirrored at every seam,
 * a slow warp, the flow — and is read as brightness; under the copy (the calm map) and under the
 * header's controls (a second map, in window coordinates) its paper is lifted toward the ramp's end; the brightness picks a color from a 256-entry
 * ramp, read upside down in the dark theme; a new ramp spreads out of the control that chose it with
 * a noisy edge; a still grain lies on top. Own code, MIT like the rest of the site.
 */

export const PAINT_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

export const PAINT_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uMaterial;  // the long frame, v = 0 its top row
uniform sampler2D uFrom;      // ramp under the spreading one (LUT_SIZE x 1)
uniform sampler2D uTo;        // the new ramp
uniform sampler2D uCalm;      // where the copy sits (page coordinates, one byte per texel)
uniform vec2 uCalmSize;       // the calm map's extent, CSS px
uniform vec2 uSize;           // canvas, device px
uniform float uDpr;           // device px per CSS px
uniform float uScroll;        // page y of the canvas' top row, CSS px
uniform float uWidth;         // the window's width, CSS px
uniform vec2 uTile;           // one copy of the frame on the page, CSS px
uniform float uPhase;         // flow cycle, [0, 1)
uniform float uFlow;          // flow amplitude, in frame uv
uniform sampler2D uHeaderCalm; // where the header's controls sit (window coordinates)
uniform vec2 uHeaderCalmSize; // its extent, CSS px; 0 for none
uniform float uInvert;        // 1 reads the frame upside down (the dark theme)
uniform float uLift;          // the frame's brightness under the copy, at least
uniform vec4 uOrigin;         // the bleed's rectangle in page coordinates: centre and half size, CSS px
uniform float uOriginRadius;  // its corner radius, CSS px
uniform float uBleed;         // 0: all uFrom; 1: all uTo; between: the spread's reach as a share of uReach
uniform float uReach;         // CSS px from the rectangle to the farthest visible corner, plus the edge
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

float mirror(float v) {
  float m = mod(v, 2.0);
  return m < 1.0 ? m : 2.0 - m;
}

float roundBox(vec2 p, vec2 half_, float radius) {
  vec2 q = abs(p) - half_ + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uDpr;
  vec2 page = vec2(css.x, uScroll + css.y);

  // One copy across the window from the page's top, mirrored at every seam, warped below the first screens.
  vec2 uv = vec2(0.5 + (page.x - uWidth * 0.5) / uTile.x, page.y / uTile.y);
  float below = smoothstep(0.6, 1.4, uv.y);
  uv.x += (noise(vec2(uv.y * 0.55, 2.3)) - 0.5) * 0.35 * below;
  uv.y += (noise(vec2(uv.y * 0.4, 7.1)) - 0.5) * 0.45 * below;
  uv = vec2(mirror(uv.x), mirror(uv.y));

  // The flow: two low-frequency fields walked round a circle, so the cycle closes on itself.
  float angle = 6.2831853 * uPhase;
  vec2 loop = vec2(cos(angle), sin(angle)) * 0.8;
  vec2 p = vec2(uv.x * 1.7, page.y / uTile.y * 1.2);
  vec2 drift = vec2(noise(p + loop), noise(p + vec2(4.7, 1.9) + loop.yx))
             + 0.5 * vec2(noise(p * 2.1 + vec2(9.2, 3.1) - loop), noise(p * 2.1 + vec2(1.3, 7.7) - loop.yx));
  uv = clamp(uv + (drift / 1.5 - 0.5) * 2.0 * uFlow, 0.0, 1.0);

  float luminance = dot(texture(uMaterial, uv).rgb, vec3(0.2126, 0.7152, 0.0722));

  // The paper under the copy and the header's controls, lifted with a soft shoulder (about 150 px).
  float calm = smoothstep(0.0, 1.0, texture(uCalm, page / uCalmSize).r);
  if (css.y < uHeaderCalmSize.y) calm = max(calm, smoothstep(0.0, 1.0, texture(uHeaderCalm, css / uHeaderCalmSize).r));
  luminance = mix(luminance, max(luminance, uLift), calm);
  float at = mix(luminance, 1.0 - luminance, uInvert);

  vec3 color = texture(uTo, vec2(at, 0.5)).rgb;
  if (uBleed < 1.0) {
    float distance_ = roundBox(page - uOrigin.xy, uOrigin.zw, uOriginRadius);
    float edge = (fbm(page / 150.0) - 0.5) * 220.0;
    float spread = 1.0 - smoothstep(-18.0, 18.0, distance_ + edge - uBleed * uReach);
    color = mix(texture(uFrom, vec2(at, 0.5)).rgb, color, spread);
  }

  // Still grain, about one CSS px across: it stays put on the screen while the paint flows under it.
  color += (hash(floor(gl_FragCoord.xy / max(1.0, uDpr * 0.75))) - 0.5) * uGrain;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
