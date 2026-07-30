/* ===========================================================
   ps1.js — PlayStation-1 rendering emulation
   -----------------------------------------------------------
   Three things made PS1 3D look like PS1 3D:
     1. Vertex snapping — the GTE had no sub-pixel precision, so
        screen-space vertices quantised to a coarse grid and the
        whole world wobbled.
     2. Affine texture mapping — no perspective-correct divide per
        pixel, so textures on big triangles swim and warp.
     3. A ~320x224 framebuffer with 15-bit colour + ordered dither,
        upscaled and smeared by a CRT.
   We reproduce all three.
   =========================================================== */

import * as THREE from 'three';

/* Shared uniform objects so a single write updates every patched
   material at once. */
const uJitter = { value: new THREE.Vector2(160, 112) };
const uJitterOn = { value: 1 };
const uTime = { value: 0 };

export function setTime(t) { uTime.value = t; }

export function setJitterResolution(w, h) {
  // Snap grid is in NDC half-units, so half the pixel resolution.
  uJitter.value.set(Math.max(8, w * 0.5), Math.max(8, h * 0.5));
}
export function setJitterEnabled(on) {
  uJitterOn.value = on ? 1 : 0;
}

/* -----------------------------------------------------------
   ps1ify(material, opts)
   Patches any built-in Three material with vertex snapping and
   (optionally) affine texture mapping.
   ----------------------------------------------------------- */
export function ps1ify(material, opts = {}) {
  const { jitter = true, affine = true, flat = true, wind = 0 } = opts;

  if (flat && 'flatShading' in material) material.flatShading = true;

  const prevHook = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    if (prevHook) prevHook(shader, renderer);

    shader.uniforms.uJitter = uJitter;
    shader.uniforms.uJitterOn = uJitterOn;
    shader.uniforms.uTime = uTime;
    shader.uniforms.uWind = { value: wind };

    /* ---------- vertex ---------- */
    let vhead = `
      uniform vec2 uJitter;
      uniform float uJitterOn;
      uniform float uTime;
      uniform float uWind;
    `;
    if (affine) {
      vhead += `
        #ifdef USE_MAP
          varying vec2 vAffUv;
          varying float vAffW;
          varying float vAffMix;
        #endif
      `;
    }
    shader.vertexShader = vhead + shader.vertexShader;

    /* Wind: sway grows with local height, phase varies by world position
       so a hillside of palms doesn't move as one object. */
    if (wind > 0) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        {
          vec4 wpos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wpos = instanceMatrix * wpos;
          #endif
          wpos = modelMatrix * wpos;
          float hgt = clamp(transformed.y * 0.22, 0.0, 1.8);
          float ph  = wpos.x * 0.32 + wpos.z * 0.27;
          float sway = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 0.83 + ph * 1.9) * 0.4;
          transformed.x += sway * hgt * uWind;
          transformed.z += cos(uTime * 1.21 + ph * 1.3) * hgt * uWind * 0.55;
        }
        `
      );
    }

    let vbody = '#include <project_vertex>\n';
    if (jitter) {
      vbody += `
        {
          // Quantise the vertex in normalised device space, exactly like
          // the GTE dropping the fractional bits of its screen coords.
          float w = max(abs(gl_Position.w), 1e-5);
          vec2 ndc = gl_Position.xy / w;
          vec2 snapped = floor(ndc * uJitter + 0.5) / uJitter;
          gl_Position.xy = mix(ndc, snapped, uJitterOn) * w;
        }
      `;
    }
    if (affine) {
      vbody += `
        #ifdef USE_MAP
          /* Cancel the rasteriser's perspective divide: it interpolates
             (v/w) then divides by interp(1/w). Feeding it v*w and w lets
             the fragment stage recover screen-linear (affine) UVs.

             But only out where it belongs. Affine mapping is authentic and
             it looks right at any normal distance; on the single terrain
             triangle you are STANDING on, which spans from under your boots
             to eight metres away, it smears the ground down the bottom of
             the screen. So the effect fades in over the first few metres:
             correct where the warp would be grotesque, PS1 everywhere else. */
          float affK = clamp((gl_Position.w - 1.2) / 3.4, 0.0, 1.0);
          vAffUv = vMapUv * gl_Position.w;
          vAffW  = gl_Position.w;
          vAffMix = affK;
        #endif
      `;
    }
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', vbody);

    /* ---------- fragment ---------- */
    if (affine) {
      shader.fragmentShader = `
        #ifdef USE_MAP
          varying vec2 vAffUv;
          varying float vAffW;
          varying float vAffMix;
        #endif
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          // the affine UV, and the perspective-correct one the rasteriser
          // already gave us, blended by how far away this fragment is
          vec2 affUv = vAffUv / max(vAffW, 1e-5);
          vec2 uvMix = mix(vMapUv, affUv, vAffMix);
          vec4 sampledDiffuseColor = texture2D( map, uvMix );
          diffuseColor *= sampledDiffuseColor;
        #endif
        `
      );
    }
  };

  // Materials with different injected code must not share a program.
  material.customProgramCacheKey = () => `ps1|${jitter ? 1 : 0}|${affine ? 1 : 0}|${wind > 0 ? 1 : 0}`;
  return material;
}

/* Convenience factories -------------------------------------------------- */
export function ps1Material(params = {}, opts = {}) {
  return ps1ify(new THREE.MeshPhongMaterial({
    shininess: 0,
    specular: 0x000000,
    ...params,
  }), opts);
}

export function ps1Lambert(params = {}, opts = {}) {
  return ps1ify(new THREE.MeshLambertMaterial(params), opts);
}

/* ===========================================================
   RetroPipeline — low-res render target + CRT composite
   =========================================================== */

const COMPOSITE_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision mediump float;
uniform sampler2D tDiffuse;
uniform sampler2D tHud;    // interface, drawn at the same internal size
uniform float uHudOn;
uniform vec2  uRes;        // internal framebuffer resolution
uniform float uCrt;        // 0..1 CRT / dither strength
uniform float uTime;
uniform float uFade;       // 1 = normal, 0 = black
uniform vec3  uTint;       // damage / underwater tint
uniform float uTintAmt;
varying vec2 vUv;

// 4x4 Bayer matrix — the PSX dithered 24-bit down to 15-bit with this.
float bayer(vec2 p){
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  if(i== 0) return  0.0/16.0; if(i== 1) return  8.0/16.0;
  if(i== 2) return  2.0/16.0; if(i== 3) return 10.0/16.0;
  if(i== 4) return 12.0/16.0; if(i== 5) return  4.0/16.0;
  if(i== 6) return 14.0/16.0; if(i== 7) return  6.0/16.0;
  if(i== 8) return  3.0/16.0; if(i== 9) return 11.0/16.0;
  if(i==10) return  1.0/16.0; if(i==11) return  9.0/16.0;
  if(i==12) return 15.0/16.0; if(i==13) return  7.0/16.0;
  if(i==14) return 13.0/16.0; return 5.0/16.0;
}

void main(){
  vec2 uv = vUv;

  // Gentle barrel distortion — a Trinitron was never flat.
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  uv = 0.5 + c * (1.0 + 0.055 * r2 * uCrt);

  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 col = texture2D(tDiffuse, uv).rgb;

  // Damage / environment tint, while we're still linear
  col = mix(col, uTint, uTintAmt);

  /* The HUD is composited HERE, before the encode and the dither, so the
     interface picks up the same 15-bit banding, scanlines and barrel curve
     as the world. Drawn on top afterwards it looks like a crisp modern
     overlay pasted onto a PSX game, which is exactly the wrong feel.
     Its canvas is authored in sRGB, so bring it into linear to mix. */
  if (uHudOn > 0.5) {
    vec4 hud = texture2D(tHud, uv);
    vec3 hudLin = pow(max(hud.rgb, vec3(0.0)), vec3(2.2));
    col = mix(col, hudLin, hud.a);
  }

  // Linear -> sRGB. three does not do this for render targets, and a raw
  // ShaderMaterial gets no automatic encode, so it has to happen here.
  col = mix(
    col * 12.92,
    1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
    step(vec3(0.0031308), col)
  );

  // 15-bit colour (32 levels per channel) with ordered dithering.
  vec2 px = uv * uRes;
  float d = (bayer(px) - 0.5) / 32.0;
  col = floor((col + d * uCrt) * 32.0 + 0.5) / 32.0;

  // Scanlines + faint aperture grille.
  float scan = 1.0 - 0.16 * uCrt * pow(sin(px.y * 3.14159), 2.0);
  col *= scan;
  col *= 1.0 - 0.05 * uCrt * pow(sin(px.x * 3.14159), 2.0);

  // Vignette
  col *= 1.0 - 0.42 * r2 * uCrt;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * uFade, 1.0);
}
`;

export class RetroPipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} baseHeight internal vertical resolution (0 = native)
   */
  constructor(renderer, baseHeight = 224) {
    this.renderer = renderer;
    this.baseHeight = baseHeight;
    this.crt = 1;
    this.fade = 1;
    this.tint = new THREE.Color(0, 0, 0);
    this.tintAmt = 0;

    this.target = new THREE.WebGLRenderTarget(320, 224, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.generateMipmaps = false;

    /* Colour-space contract, and it matters.
       three forces every non-XR render target to LINEAR output regardless of
       what the texture is tagged (WebGLPrograms: `renderTarget === null ?
       outputColorSpace : workingColorSpace`), so the scene pass writes linear
       bytes here. The composite below is a raw ShaderMaterial, which means
       three injects no decode on the way in and no encode on the way out —
       so the encode is ours to do. Skip it and the whole game renders about
       two stops dark. We encode first, then dither and quantise in gamma
       space, which is what a PSX was doing to 15-bit colour anyway. */
    this.target.texture.colorSpace = THREE.NoColorSpace;

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        tHud: { value: null },
        uHudOn: { value: 0 },
        uRes: { value: new THREE.Vector2(320, 224) },
        uCrt: { value: 1 },
        uTime: { value: 0 },
        uFade: { value: 1 },
        uTint: { value: new THREE.Vector3(0, 0, 0) },
        uTintAmt: { value: 0 },
      },
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    this.size = new THREE.Vector2(1, 1);
    this.hudTexture = null;
  }

  /** Hand the pipeline a canvas to composite as the interface layer. */
  setHudCanvas(canvas) {
    if (this.hudTexture) this.hudTexture.dispose();
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;   // sampled raw; decoded in the shader
    this.hudTexture = t;
    this.quadMat.uniforms.tHud.value = t;
    this.quadMat.uniforms.uHudOn.value = 1;
  }

  markHudDirty() { if (this.hudTexture) this.hudTexture.needsUpdate = true; }

  setBaseHeight(h) {
    this.baseHeight = h;
    this.setSize(this.size.x, this.size.y);
  }

  setCRT(on) {
    this.crt = on ? 1 : 0;
    this.quadMat.uniforms.uCrt.value = this.crt;
  }

  setSize(w, h) {
    this.size.set(w, h);
    const aspect = w / Math.max(1, h);
    let iw, ih;
    if (!this.baseHeight) {
      // Native: still cap so huge displays stay playable.
      ih = Math.min(h, 1080);
      iw = Math.round(ih * aspect);
    } else {
      ih = this.baseHeight;
      iw = Math.round(ih * aspect);
    }
    iw = Math.max(64, iw | 0);
    ih = Math.max(64, ih | 0);
    /* Reallocating the render target throws away GL textures and makes a
       new pair. During a live window drag that runs on every mouse move,
       which is what makes a resize feel like it lags a second behind. */
    if (this.internal && this.internal.w === iw && this.internal.h === ih) {
      this.internal.dirty = false;
      return;
    }
    this.target.setSize(iw, ih);
    this.quadMat.uniforms.uRes.value.set(iw, ih);
    setJitterResolution(iw, ih);
    this.internal = { w: iw, h: ih };
  }

  render(scene, camera, dt = 0) {
    const u = this.quadMat.uniforms;
    u.uTime.value += dt;
    u.uFade.value = this.fade;
    u.uTint.value.set(this.tint.r, this.tint.g, this.tint.b);
    u.uTintAmt.value = this.tintAmt;

    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.clear();
    r.render(this.quadScene, this.quadCam);
  }

  dispose() {
    this.target.dispose();
    this.quadMat.dispose();
  }
}
