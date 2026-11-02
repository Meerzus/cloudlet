/**
 * The hero's landscape (COLOR_PICKER §8.2–8.4): one fragment shader over a full-screen triangle
 * (the quad's two triangles as one). Flat airbrushed fields — sky, far and near hills, one cloud,
 * a lake with a zigzag reflection of the disc, the disc and its grainy halo — with stars, haze or
 * rain by the hour, and film grain on top. Nothing in it depends on time: a frame is drawn only
 * when a uniform changes or the paint bleeds. Own code, MIT like the rest of the site.
 *
 * Palettes are `vec3[9]` in `LANDSCAPE_FIELDS` order (lib/landscape.ts), sRGB in [0, 1].
 */

export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uSize;     // canvas, device px
uniform float uDpr;     // device px per CSS px
uniform vec3 uDisc;     // centre (device px, y up) and radius (device px)
uniform vec3 uCloud;    // centre (device px, y up) and width (device px)
uniform vec2 uLand;     // lake horizon and hill height, fractions of the height from the bottom
uniform vec2 uBolt;     // lightning: x and the top it falls from (device px, y up)
uniform vec3 uFrom[9];
uniform vec3 uFromFx;   // stars, haze, rain
uniform vec3 uTo[9];
uniform vec3 uToFx;
uniform float uBleed;   // 0: all uFrom, 1: all uTo, between: uTo spreads out of the disc

out vec4 outColor;

#define SKY_TOP 0
#define HORIZON 1
#define FAR 2
#define NEAR 3
#define CLOUD 4
#define WATER 5
#define HALO 6
#define ACCENT 7
#define DISC 8

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * noise(p);
    p = p * 2.03 + 17.0;
    amplitude *= 0.5;
  }
  return value;
}

// Airbrush: every edge is a wide ramp, so fields fade into each other like sprayed paint. d < 0 is inside.
float spray(float d, float width) {
  return 1.0 - smoothstep(-width, width, d);
}

float ridge(float x, float base, float amplitude, vec4 waves) {
  return base + amplitude * (0.6 * sin(x * waves.x + waves.y) + 0.4 * sin(x * waves.z + waves.w));
}

// The cloud: a few overlapping puffs on a flat base, in the footer clouds' proportions, no face.
float cloudShape(vec2 p) {
  float d = length(p - vec2(-0.3, -0.02)) - 0.18;
  d = min(d, length(p - vec2(-0.05, 0.08)) - 0.27);
  d = min(d, length(p - vec2(0.24, 0.03)) - 0.2);
  d = min(d, length(p - vec2(0.44, -0.05)) - 0.12);
  return max(d, -(p.y + 0.13));
}

// Four-point stars of different sizes, one per lucky cell; still, never twinkling.
float stars(vec2 frag) {
  float cell = 64.0 * uDpr;
  vec2 id = floor(frag / cell);
  if (hash(id) < 0.76) return 0.0;
  vec2 jitter = vec2(hash(id + 7.1), hash(id + 3.7)) - 0.5;
  vec2 q = (fract(frag / cell) - 0.5 - jitter * 0.4) * cell / uDpr;
  float size = mix(1.6, 7.0, pow(hash(id + 1.3), 3.0));
  float rays = exp(-abs(q.x) / 0.6) * exp(-abs(q.y) / size) + exp(-abs(q.y) / 0.6) * exp(-abs(q.x) / size);
  float core = exp(-dot(q, q) / (0.3 * size));
  return min(1.0, 0.9 * rays + core) * mix(0.45, 1.0, hash(id + 9.2));
}

// Everything above the water; the lake mirrors it.
vec3 land(vec3 P[9], vec3 fx, vec2 frag, bool mirrored) {
  float y = frag.y / uSize.y;
  float x = frag.x / uSize.y;
  float horizon = uLand.x;
  float hills = uLand.y;

  float t = clamp((y - horizon) / (1.0 - horizon), 0.0, 1.0);
  // The bright band hugs the horizon, so the copy higher up always sits on the top of the sky.
  vec3 color = mix(P[HORIZON], P[SKY_TOP], smoothstep(0.0, 1.0, pow(t, 0.45)));
  // Haze: a milky band over the horizon by day.
  color = mix(color, mix(P[HORIZON], vec3(1.0), 0.35), fx.y * 0.55 * exp(-max(0.0, y - horizon) * 9.0));
  if (!mirrored) color = mix(color, mix(P[ACCENT], vec3(1.0), 0.65), fx.x * stars(frag) * smoothstep(horizon + hills, horizon + hills + 0.18, y));

  vec2 c = (frag - uCloud.xy) / uCloud.z;
  float puff = spray(cloudShape(c), 0.035);
  vec3 cloud = mix(mix(P[CLOUD], P[HORIZON], 0.25), P[CLOUD], smoothstep(-0.14, 0.26, c.y));
  color = mix(color, cloud, puff * 0.97);

  float far = ridge(x, horizon + hills * 0.62, hills * 0.32, vec4(2.3, 1.1, 5.9, 0.3));
  vec3 farColor = mix(P[FAR], mix(P[FAR], P[HORIZON], 0.45), smoothstep(far, horizon, y));
  color = mix(color, farColor, spray(y - far, 0.006));

  float near = ridge(x, horizon + hills * 0.2, hills * 0.22, vec4(1.6, 4.0, 4.3, 2.2));
  vec3 nearColor = mix(P[NEAR], mix(P[NEAR], P[HORIZON], 0.2), smoothstep(near, horizon, y));
  color = mix(color, nearColor, spray(y - near, 0.005));

  // Lightning: one still bolt in the distance, from uBolt's top down to the far hills.
  if (fx.z > 0.0 && !mirrored) {
    float bolt = uBolt.x / uSize.y;
    float top = uBolt.y / uSize.y;
    float path = bolt + (fbm(vec2(y * 6.0, 3.1)) - 0.5) * 0.16 * min(1.0, top - horizon) + (noise(vec2(y * 42.0, 1.0)) - 0.5) * 0.015;
    float dx = abs(x - path) * uSize.y / uDpr;
    float foot = ridge(bolt, horizon + hills * 0.62, hills * 0.32, vec4(2.3, 1.1, 5.9, 0.3)) + 0.02;
    float reach = smoothstep(foot, foot + 0.04, y) * (1.0 - smoothstep(top - 0.06, top, y));
    float glow = (exp(-dx / 1.1) + 0.22 * exp(-dx / 16.0)) * reach;
    color = mix(color, mix(P[ACCENT], vec3(1.0), 0.75), fx.z * min(1.0, glow));
  }
  return color;
}

vec3 scene(vec3 P[9], vec3 fx, vec2 frag) {
  float horizonPx = uLand.x * uSize.y;
  float radius = uDisc.z / uDpr;
  vec3 color;
  if (frag.y >= horizonPx) {
    color = land(P, fx, frag, false);
    // The halo: a grainy radial glow around the disc, then the disc itself (the swatch covers it).
    float d = length(frag - uDisc.xy) / uDpr;
    float glow = exp(-max(0.0, d - radius) / (radius * 0.95)) * mix(0.72, 1.18, hash(frag * 1.7 + 3.0));
    color = mix(color, P[HALO], clamp(glow, 0.0, 1.0) * 0.72);
    color = mix(color, P[DISC], spray(d - radius, 0.8));
  } else {
    vec3 mirrored = land(P, fx, vec2(frag.x, 2.0 * horizonPx - frag.y), true);
    float depth = (horizonPx - frag.y) / uSize.y;
    color = mix(mirrored * 0.9, P[WATER], 0.5 + 0.25 * smoothstep(0.0, uLand.x, depth));
    // A bright seam where the water meets the hills.
    color = mix(color, mix(P[HORIZON], vec3(1.0), 0.2), 0.45 * exp(-(horizonPx - frag.y) / (1.6 * uDpr)));
    // The disc's reflection: short strokes, alternately left and right, narrowing with depth.
    float k = (horizonPx - frag.y) / uDpr;
    float reach = radius * 5.0;
    float band = floor(k / 9.0);
    float phase = fract(k / 9.0);
    float stroke = smoothstep(0.0, 0.15, phase) * (1.0 - smoothstep(0.45, 0.6, phase));
    float halfWidth = radius * (1.0 - k / reach);
    float zig = (mod(band, 2.0) * 2.0 - 1.0) * radius * 0.22;
    float dx = abs((frag.x - uDisc.x) / uDpr - zig);
    float strip = stroke * spray(dx - halfWidth, 2.5) * step(0.0, halfWidth);
    color = mix(color, mix(P[DISC], P[HALO], 0.55), strip * 0.85 * (1.0 - k / reach));
  }
  // Rain: still, slanted streaks over everything.
  if (fx.z > 0.0) {
    vec2 r = mat2(0.98, -0.2, 0.2, 0.98) * frag / uDpr;
    vec2 id = floor(vec2(r.x / 5.0, r.y / 46.0));
    float streak = step(0.93, hash(id)) * exp(-abs(fract(r.x / 5.0) - 0.5) * 8.0) * smoothstep(0.0, 0.2, fract(r.y / 46.0)) * (1.0 - smoothstep(0.45, 0.6, fract(r.y / 46.0)));
    color = mix(color, mix(P[HORIZON], vec3(1.0), 0.4), fx.z * streak * 0.24);
  }
  return color;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 color = scene(uTo, uToFx, frag);
  if (uBleed < 1.0) {
    vec3 before = scene(uFrom, uFromFx, frag);
    // The new palette spreads radially out of the disc; its edge wanders on fbm like wet paint.
    vec2 o = uDisc.xy;
    float farthest = max(max(length(o), length(o - vec2(uSize.x, 0.0))), max(length(o - uSize), length(o - vec2(0.0, uSize.y))));
    float d = length(frag - o) / farthest;
    float edge = uBleed * 1.35 - 0.15 + (fbm(frag / uSize.y * 5.0) - 0.5) * 0.3;
    float wet = 1.0 - smoothstep(edge - 0.015, edge + 0.015, d);
    float rim = exp(-abs(d - edge) * 90.0) * 0.12;
    color = mix(before, color * (1.0 - rim), wet);
  }
  // Film grain, 5 %: a fixed hash per pixel, so a still frame stays still.
  color += (hash(frag + 17.0) - 0.5) * 0.05;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
