/**
 * The color picker landing's paint stirred by the cursor like a liquid: a small stable-fluids
 * simulation (velocity, vorticity confinement, a Jacobi pressure solve, advection) in the paint's own
 * WebGL 2 context. Instead of ink it carries a field of offsets — where the paint under each point of
 * the window has flowed from — and the paint shader reads the paint there, so the picture itself
 * swirls behind the cursor, in its own colors, and settles back as the offsets relax. The paper
 * under the copy stays where the copy is. The method and its constants follow Pavel Dobryakov's
 * WebGL Fluid Simulation (MIT, https://github.com/PavelDoGreat/WebGL-Fluid-Simulation), as the
 * Splash Cursor of React Bits tunes it; this is a rewrite for WebGL 2.
 */

/** Simulation grid, cells on the window's short side. */
const SIM_RESOLUTION = 128;
/** Offset field, texels on the window's short side: the swirls are soft, so it needs no more. */
const OFFSET_RESOLUTION = 256;
/** How fast the paint settles back where it was, per second. */
const OFFSET_DISSIPATION = 1.1;
const VELOCITY_DISSIPATION = 2;
const PRESSURE = 0.1;
const PRESSURE_ITERATIONS = 20;
const CURL = 3;
const SPLAT_RADIUS = 0.2 / 100;
const SPLAT_FORCE = 6000;
/** A click's push, in the units of a moving cursor's. */
const CLICK_FORCE = 1500;
/** After the last push the paint has settled by then, ms: the simulation sleeps. */
const SETTLE_MS = 4500;

const VERTEX = `#version 300 es
uniform vec2 texelSize;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
`;

const SPLAT = `${HEAD}
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec4 color;
uniform vec2 point;
uniform float radius;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  outColor = texture(uTarget, vUv) + exp(-dot(p, p) / radius) * color;
}`;

// Velocity carried by itself; shift moves the field with the page when it scrolls, and what scrolls in is still.
const ADVECTION = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 shift;
uniform float dt;
uniform float dissipation;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize + shift;
  bool inside = all(greaterThanEqual(coord, vec2(0.0))) && all(lessThanEqual(coord, vec2(1.0)));
  outColor = inside ? texture(uSource, coord) / (1.0 + dissipation * dt) : vec4(0.0);
}`;

// The offsets (window uv): a point now shows the paint of the point it was carried from, then relaxes.
const OFFSET = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 shift;
uniform float dt;
uniform float dissipation;
void main() {
  vec2 step_ = -dt * texture(uVelocity, vUv).xy * texelSize;
  vec2 coord = vUv + step_ + shift;
  bool inside = all(greaterThanEqual(coord, vec2(0.0))) && all(lessThanEqual(coord, vec2(1.0)));
  vec2 offset = (inside ? texture(uSource, coord).xy : vec2(0.0)) + step_;
  outColor = vec4(offset / (1.0 + dissipation * dt), 0.0, 1.0);
}`;

const DIVERGENCE = `${HEAD}
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CURL_SHADER = `${HEAD}
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  outColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const VORTICITY = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main() {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy + force * dt;
  outColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}`;

const CLEAR = `${HEAD}
uniform sampler2D uTexture;
uniform float value;
void main() {
  outColor = value * texture(uTexture, vUv);
}`;

const PRESSURE_SHADER = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  outColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT_SUBTRACT = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  outColor = vec4(velocity, 0.0, 1.0);
}`;

interface Program {
  readonly handle: WebGLProgram;
  readonly uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

interface DoubleTarget {
  read: Target;
  write: Target;
}


function link(gl: WebGL2RenderingContext, vertex: WebGLShader, source: string): Program | null {
  const shader = gl.createShader(gl.FRAGMENT_SHADER);
  const handle = gl.createProgram();
  if (!shader || !handle) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== 'production') console.error(gl.getShaderInfoLog(shader));
    return null;
  }
  gl.attachShader(handle, vertex);
  gl.attachShader(handle, shader);
  gl.linkProgram(handle);
  gl.deleteShader(shader);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) return null;
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(handle, i)!.name;
    uniforms[name] = gl.getUniformLocation(handle, name);
  }
  return { handle, uniforms };
}

/** A cell size for `resolution` cells on the short side of a `width` x `height` window. */
function grid(resolution: number, width: number, height: number) {
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  const short = Math.round(resolution);
  const long = Math.round(resolution * aspect);
  return width > height ? { width: long, height: short } : { width: short, height: long };
}

export class PaintFluid {
  /** The simulation in `gl`, or null when half-float targets cannot be rendered to or a shader fails. */
  static create(gl: WebGL2RenderingContext): PaintFluid | null {
    // Float targets that can also be read back (a click in Tools reads the offset under it).
    if (!gl.getExtension('EXT_color_buffer_float')) return null;
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    if (!vertex) return null;
    gl.shaderSource(vertex, VERTEX);
    gl.compileShader(vertex);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) return null;
    const sources = { splat: SPLAT, advection: ADVECTION, offset: OFFSET, divergence: DIVERGENCE, curl: CURL_SHADER, vorticity: VORTICITY, clear: CLEAR, pressure: PRESSURE_SHADER, gradient: GRADIENT_SUBTRACT };
    const programs = {} as Record<keyof typeof sources, Program>;
    for (const [name, source] of Object.entries(sources) as [keyof typeof sources, string][]) {
      const program = link(gl, vertex, source);
      if (!program) return null;
      programs[name] = program;
    }
    gl.deleteShader(vertex);
    return new PaintFluid(gl, programs);
  }

  private readonly vao: WebGLVertexArrayObject | null;
  private velocity: DoubleTarget | null = null;
  private offsets: DoubleTarget | null = null;
  private pressure: DoubleTarget | null = null;
  private divergence: Target | null = null;
  private curl: Target | null = null;
  private size = { width: 0, height: 0 };
  /** The pointer's last position, uv (origin bottom left), and whether it moved since the last step. */
  private pointer: { x: number; y: number; dx: number; dy: number; moved: boolean } | null = null;
  private clicks: { x: number; y: number }[] = [];
  private lastSplat = -Infinity;
  private lastStep: number | null = null;
  /** The page scrolled since the last step, CSS px. */
  private scrolled = 0;
  private readonly texel = new Float32Array(4);

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly programs: Record<'splat' | 'advection' | 'offset' | 'divergence' | 'curl' | 'vorticity' | 'clear' | 'pressure' | 'gradient', Program>,
  ) {
    this.vao = gl.createVertexArray();
  }

  /** The offsets' texture: rg is where the paint at a window point has flowed from, as a shift in window uv. Null before the first resize. */
  get field(): WebGLTexture | null {
    return this.offsets?.read.texture ?? null;
  }

  /** Whether the paint is still being stirred or settling: it keeps drawing frames and reads the offsets. */
  awake(now = performance.now()): boolean {
    return this.offsets !== null && (this.pointer?.moved === true || this.clicks.length > 0 || now - this.lastSplat < SETTLE_MS);
  }

  /**
   * Where the paint shown at (x, y), CSS px in the window, comes from, as a shift in CSS px (x right,
   * y down): read back from the field, so a click on the paint takes what it shows.
   */
  offsetAt(x: number, y: number): { readonly x: number; readonly y: number } {
    const field = this.offsets?.read;
    if (!field || !this.awake()) return { x: 0, y: 0 };
    const { gl } = this;
    const column = Math.min(field.width - 1, Math.max(0, Math.floor((x / Math.max(1, this.size.width)) * field.width)));
    const row = Math.min(field.height - 1, Math.max(0, Math.floor((1 - y / Math.max(1, this.size.height)) * field.height)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, field.framebuffer);
    gl.readPixels(column, row, 1, 1, gl.RGBA, gl.FLOAT, this.texel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { x: this.texel[0]! * this.size.width, y: -this.texel[1]! * this.size.height };
  }

  /** The page scrolled by `dy` CSS px: the stirred paint moves with it. */
  scroll(dy: number) {
    if (this.awake()) this.scrolled += dy;
  }

  /** The window's size, CSS px: the grids follow its aspect. A new aspect starts with clear water. */
  resize(width: number, height: number) {
    if (width === this.size.width && height === this.size.height) return;
    this.size = { width, height };
    this.release();
    const { gl } = this;
    const sim = grid(SIM_RESOLUTION, width, height);
    const offsets = grid(OFFSET_RESOLUTION, width, height);
    this.velocity = this.double(sim.width, sim.height);
    this.pressure = this.double(sim.width, sim.height);
    this.divergence = this.target(sim.width, sim.height, gl.NEAREST);
    this.curl = this.target(sim.width, sim.height, gl.NEAREST);
    this.offsets = this.double(offsets.width, offsets.height);
  }

  /** The cursor at (x, y), CSS px in the window. */
  move(x: number, y: number) {
    const u = x / Math.max(1, this.size.width);
    const v = 1 - y / Math.max(1, this.size.height);
    const previous = this.pointer;
    if (!previous) {
      this.pointer = { x: u, y: v, dx: 0, dy: 0, moved: false };
      return;
    }
    const aspect = this.size.width / Math.max(1, this.size.height);
    let dx = u - previous.x;
    let dy = v - previous.y;
    if (aspect < 1) dx *= aspect;
    if (aspect > 1) dy /= aspect;
    this.pointer = { x: u, y: v, dx: previous.moved ? previous.dx + dx : dx, dy: previous.moved ? previous.dy + dy : dy, moved: dx !== 0 || dy !== 0 || previous.moved };
  }

  /** The cursor left the window: the next move starts a new stroke, not a jump across it. */
  leave() {
    this.pointer = null;
  }

  /** A click at (x, y), CSS px in the window: a burst that swirls the paint round it. */
  click(x: number, y: number) {
    this.clicks.push({ x: x / Math.max(1, this.size.width), y: 1 - y / Math.max(1, this.size.height) });
  }

  /** The paint settled at once (reduced motion turned on). */
  reset() {
    const { width, height } = this.size;
    this.size = { width: 0, height: 0 };
    this.pointer = null;
    this.clicks = [];
    this.lastSplat = -Infinity;
    if (width && height) this.resize(width, height);
  }

  /** Applies the cursor's input and advances the simulation to `now`; leaves the framebuffer unbound. */
  step(now: number) {
    const { gl } = this;
    if (!this.velocity || !this.offsets) return;
    const dt = Math.min(this.lastStep === null ? 1 / 60 : (now - this.lastStep) / 1000, 1 / 60);
    this.lastStep = now;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    if (this.pointer?.moved) {
      const { x, y, dx, dy } = this.pointer;
      this.splat(x, y, dx * SPLAT_FORCE, dy * SPLAT_FORCE);
      this.pointer = { x, y, dx: 0, dy: 0, moved: false };
      this.lastSplat = now;
    }
    for (const point of this.clicks) {
      const angle = Math.random() * 2 * Math.PI;
      this.splat(point.x, point.y, CLICK_FORCE * Math.cos(angle), CLICK_FORCE * Math.sin(angle));
      this.lastSplat = now;
    }
    this.clicks = [];
    // Scrolling down moves the page's content up the window: the field is read from below.
    const shift = -this.scrolled / Math.max(1, this.size.height);
    this.scrolled = 0;
    this.advance(dt, shift);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!this.awake(now)) this.lastStep = null;
  }

  destroy() {
    this.release();
    const { gl } = this;
    for (const program of Object.values(this.programs)) gl.deleteProgram(program.handle);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }

  private advance(dt: number, shift: number) {
    const { gl, programs: p } = this;
    const velocity = this.velocity!;
    const pressure = this.pressure!;
    const offsets = this.offsets!;
    const texel = [1 / velocity.read.width, 1 / velocity.read.height] as const;

    this.use(p.curl, texel);
    this.bind(p.curl, 'uVelocity', 0, velocity.read);
    this.blit(this.curl!);

    this.use(p.vorticity, texel);
    this.bind(p.vorticity, 'uVelocity', 0, velocity.read);
    this.bind(p.vorticity, 'uCurl', 1, this.curl!);
    gl.uniform1f(p.vorticity.uniforms.curl!, CURL);
    gl.uniform1f(p.vorticity.uniforms.dt!, dt);
    this.blit(velocity.write);
    this.swap(velocity);

    this.use(p.divergence, texel);
    this.bind(p.divergence, 'uVelocity', 0, velocity.read);
    this.blit(this.divergence!);

    this.use(p.clear, texel);
    this.bind(p.clear, 'uTexture', 0, pressure.read);
    gl.uniform1f(p.clear.uniforms.value!, PRESSURE);
    this.blit(pressure.write);
    this.swap(pressure);

    this.use(p.pressure, texel);
    this.bind(p.pressure, 'uDivergence', 0, this.divergence!);
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      this.bind(p.pressure, 'uPressure', 1, pressure.read);
      this.blit(pressure.write);
      this.swap(pressure);
    }

    this.use(p.gradient, texel);
    this.bind(p.gradient, 'uPressure', 0, pressure.read);
    this.bind(p.gradient, 'uVelocity', 1, velocity.read);
    this.blit(velocity.write);
    this.swap(velocity);

    this.use(p.advection, texel);
    this.bind(p.advection, 'uVelocity', 0, velocity.read);
    this.bind(p.advection, 'uSource', 0, velocity.read);
    gl.uniform1f(p.advection.uniforms.dt!, dt);
    gl.uniform2f(p.advection.uniforms.shift!, 0, shift);
    gl.uniform1f(p.advection.uniforms.dissipation!, VELOCITY_DISSIPATION);
    this.blit(velocity.write);
    this.swap(velocity);

    this.use(p.offset, texel);
    this.bind(p.offset, 'uVelocity', 0, velocity.read);
    this.bind(p.offset, 'uSource', 1, offsets.read);
    gl.uniform1f(p.offset.uniforms.dt!, dt);
    gl.uniform2f(p.offset.uniforms.shift!, 0, shift);
    gl.uniform1f(p.offset.uniforms.dissipation!, OFFSET_DISSIPATION);
    this.blit(offsets.write);
    this.swap(offsets);
  }

  private splat(x: number, y: number, dx: number, dy: number) {
    const { gl, programs: p } = this;
    const velocity = this.velocity!;
    const aspect = this.size.width / Math.max(1, this.size.height);
    const radius = SPLAT_RADIUS * (aspect > 1 ? aspect : 1);
    this.use(p.splat, [1 / velocity.read.width, 1 / velocity.read.height]);
    gl.uniform1f(p.splat.uniforms.aspectRatio!, aspect);
    gl.uniform2f(p.splat.uniforms.point!, x, y);
    gl.uniform1f(p.splat.uniforms.radius!, radius);
    this.bind(p.splat, 'uTarget', 0, velocity.read);
    gl.uniform4f(p.splat.uniforms.color!, dx, dy, 0, 0);
    this.blit(velocity.write);
    this.swap(velocity);
  }

  private use(program: Program, texel: readonly [number, number]) {
    this.gl.useProgram(program.handle);
    const location = program.uniforms.texelSize;
    if (location) this.gl.uniform2f(location, texel[0], texel[1]);
  }

  private bind(program: Program, name: string, unit: number, target: Target) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(program.uniforms[name]!, unit);
  }

  private blit(target: Target) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private swap(double: DoubleTarget) {
    const read = double.read;
    double.read = double.write;
    double.write = read;
  }

  private target(width: number, height: number, filter: number): Target {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  }

  private double(width: number, height: number): DoubleTarget {
    return { read: this.target(width, height, this.gl.LINEAR), write: this.target(width, height, this.gl.LINEAR) };
  }

  private release() {
    const { gl } = this;
    const targets = [this.velocity?.read, this.velocity?.write, this.pressure?.read, this.pressure?.write, this.offsets?.read, this.offsets?.write, this.divergence, this.curl];
    for (const target of targets) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    this.velocity = this.pressure = this.offsets = null;
    this.divergence = this.curl = null;
  }
}
