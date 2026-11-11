import * as THREE from 'three';
import gsap from 'gsap';

/**
 * One fixed, full-window WebGL canvas. Every `.media` element that opts in gets a plane
 * that is synced to its DOM rectangle each frame (so GSAP transforms, sticky and Lenis
 * scrolling all "just work"). The shader handles:
 *   - cover-fit + scroll parallax
 *   - mask reveal (bottom-up or left-right) with an inner zoom
 *   - pointer hover: liquid ripple + lens pull + faint chromatic split
 *   - noise-edged wipe between two images (hero sequence, craft section, quick-buy)
 *   - a gentle bend driven by scroll velocity
 */

const VERT = /* glsl */ `
varying vec2 vUv;
uniform float uVel;
uniform vec2  uSize;
uniform vec2  uTilt;   // radians: x = around the X axis, y = around the Y axis
uniform float uLift;   // tiny scale-up while hovered
void main() {
  vUv = uv;
  // work in pixel space so the rotation never distorts the aspect ratio
  vec3 q = vec3(position.xy * uSize, 0.0);
  float cy = cos(uTilt.y); float sy = sin(uTilt.y);
  float cx = cos(uTilt.x); float sx = sin(uTilt.x);
  q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  q = vec3(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
  float d = max(uSize.x, uSize.y) * 2.4;      // perspective distance
  q.xy *= d / (d - q.z);
  q.xy *= 1.0 + uLift;
  vec3 p = vec3(q.xy / uSize, 0.0);
  p.y += sin(uv.x * 3.14159265) * uVel * 0.03;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uTex;
uniform sampler2D uTex2;
uniform vec2  uSize;
uniform vec2  uImg1;
uniform vec2  uImg2;
uniform float uMix;
uniform float uReveal;
uniform float uAxis;
uniform float uFlip;
uniform float uScale;
uniform float uParallax;
uniform float uParAmp;
uniform float uTime;
uniform float uRadius;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec2 cover(vec2 uv, vec2 plane, vec2 img, float scale, float par) {
  float pa = plane.x / plane.y;
  float ia = img.x / img.y;
  vec2 s = pa > ia ? vec2(1.0, ia / pa) : vec2(pa / ia, 1.0);
  float eff = scale * (1.0 + uParAmp * 2.0);
  vec2 c = (uv - 0.5) * s / eff + 0.5;
  float margin = (1.0 - s.y / eff) * 0.5;
  c.y += par * margin * 0.98;
  return c;
}

vec3 scene(vec2 uv) {
  float t = uMix;
  float n = noise(uv * vec2(3.0, 2.2) + vec2(0.0, uTime * 0.04));
  float edge = clamp(uv.y * 0.72 + n * 0.28, 0.0, 1.0);
  float m = smoothstep(0.0, 0.34, t * 1.34 - edge);
  vec2 ca = cover(uv, uSize, uImg1, uScale * (1.0 + 0.05 * t), uParallax);
  vec2 cb = cover(uv, uSize, uImg2, uScale * (1.0 + 0.06 * (1.0 - t)), uParallax);
  vec3 a = texture2D(uTex, ca).rgb;
  vec3 b = texture2D(uTex2, cb).rgb;
  return mix(a, b, m);
}

void main() {
  vec2 uv = vUv;

  // the product is never distorted: hover is a pure 3D tilt in the vertex stage
  vec3 col = scene(uv);

  // rounded-rect mask (radius is 0 by default: print-style square corners)
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = abs(p) - uSize * 0.5 + vec2(uRadius);
  float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = 1.0 - smoothstep(-0.75, 0.75, sdf);

  // directional reveal mask
  float coord = mix(vUv.y, vUv.x, uAxis);
  coord = mix(coord, 1.0 - coord, uFlip);
  float len = mix(uSize.y, uSize.x, uAxis);
  float rv = uReveal >= 0.999 ? 1.0 : clamp((uReveal - coord) * len + 0.5, 0.0, 1.0);
  a *= rv;

  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export class GL {
  constructor(canvas) {
    this.ok = false;
    this.planes = [];
    this.map = new Map();
    this.textures = new Map();
    this.time = 0;
    this.W = window.innerWidth;
    this.H = window.innerHeight;

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (e) {
      return;
    }
    if (!this.renderer.getContext()) return;
    this.ok = true;

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera.position.z = 10;
    this.geo = new THREE.PlaneGeometry(1, 1, 24, 24);

    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    blank.needsUpdate = true;
    this.blank = blank;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.ok) return;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.W, this.H, false);
    const c = this.camera;
    c.left = -this.W / 2;
    c.right = this.W / 2;
    c.top = this.H / 2;
    c.bottom = -this.H / 2;
    c.updateProjectionMatrix();
  }

  load(src) {
    if (!this.textures.has(src)) {
      this.textures.set(
        src,
        new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(
            src,
            (t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
              t.minFilter = THREE.LinearMipmapLinearFilter;
              t.magFilter = THREE.LinearFilter;
              t.generateMipmaps = true;
              t.needsUpdate = true;
              resolve({ tex: t, w: t.image.width, h: t.image.height });
            },
            undefined,
            reject,
          );
        }),
      );
    }
    return this.textures.get(src);
  }

  add(el, opts = {}) {
    const V2 = THREE.Vector2;
    const u = {
      uTex: { value: this.blank },
      uTex2: { value: this.blank },
      uSize: { value: new V2(1, 1) },
      uImg1: { value: new V2(1, 1) },
      uImg2: { value: new V2(1, 1) },
      uMix: { value: 0 },
      uReveal: { value: 1 },
      uAxis: { value: opts.axis || 0 },
      uFlip: { value: opts.flip || 0 },
      uScale: { value: 1 },
      uParallax: { value: 0 },
      uParAmp: { value: opts.parAmp || 0 },
      uHover: { value: 0 },
      uMouse: { value: new V2(0.5, 0.5) },
      uTilt: { value: new V2(0, 0) },
      uLift: { value: 0 },
      uTime: { value: 0 },
      uRadius: { value: opts.radius || 0 },
      uVel: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geo, material);
    mesh.visible = false;
    this.scene.add(mesh);

    const plane = { el, mesh, u, mouse: new V2(0.5, 0.5), loaded: false, src: opts.src };
    plane.ready = this.load(opts.src).then((t) => {
      u.uTex.value = t.tex;
      u.uTex2.value = t.tex;
      u.uImg1.value.set(t.w, t.h);
      u.uImg2.value.set(t.w, t.h);
      plane.loaded = true;
    });
    this.planes.push(plane);
    this.map.set(el, plane);
    return plane;
  }

  /** Set the current pair without a transition (used by the hero sequence). */
  async setPair(plane, srcA, srcB) {
    const [a, b] = await Promise.all([this.load(srcA), this.load(srcB)]);
    const u = plane.u;
    u.uTex.value = a.tex;
    u.uImg1.value.set(a.w, a.h);
    u.uTex2.value = b.tex;
    u.uImg2.value.set(b.w, b.h);
    u.uMix.value = 0;
  }

  /** Noise-edged wipe from whatever is showing to `src`. */
  async transitionTo(plane, src, duration = 1.1) {
    const t = await this.load(src);
    const u = plane.u;
    if (plane.tween) {
      plane.tween.kill();
      if (u.uMix.value > 0.5) {
        u.uTex.value = u.uTex2.value;
        u.uImg1.value.copy(u.uImg2.value);
      }
      u.uMix.value = 0;
    }
    u.uTex2.value = t.tex;
    u.uImg2.value.set(t.w, t.h);
    plane.tween = gsap.to(u.uMix, {
      value: 1,
      duration,
      ease: 'power2.inOut',
      onComplete: () => {
        u.uTex.value = t.tex;
        u.uImg1.value.set(t.w, t.h);
        u.uMix.value = 0;
        plane.tween = null;
      },
    });
    return plane.tween;
  }

  render(time, velocity = 0) {
    if (!this.ok) return;
    const { W, H } = this;
    const vel = Math.max(-1, Math.min(1, velocity));
    for (const p of this.planes) {
      const r = p.el.getBoundingClientRect();
      const vis = p.loaded && r.width > 0 && r.height > 0 && r.bottom > -40 && r.top < H + 40;
      p.mesh.visible = vis;
      if (!vis) continue;
      const u = p.u;
      p.mesh.scale.set(r.width, r.height, 1);
      p.mesh.position.set(r.left + r.width / 2 - W / 2, -(r.top + r.height / 2 - H / 2), 0);
      u.uSize.value.set(r.width, r.height);
      const c = (r.top + r.height / 2 - H / 2) / (H / 2 + r.height / 2);
      u.uParallax.value = Math.max(-1, Math.min(1, c));
      u.uTime.value = time;
      u.uVel.value = vel;
      u.uMouse.value.lerp(p.mouse, 0.1);
      const h = u.uHover.value;
      const MAX = 0.13; // about 7.5 degrees: enough to read as 3D, never enough to hide the product
      u.uTilt.value.set(-(u.uMouse.value.y - 0.5) * 2 * MAX * h, (u.uMouse.value.x - 0.5) * 2 * MAX * h);
      u.uLift.value = 0.018 * h;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
