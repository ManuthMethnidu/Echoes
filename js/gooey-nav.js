// js/gooey-nav.js
// Native JavaScript + WebGL2 implementation of GooeyNav from React Bits

const THEMES = {
    dark: {
        '--gn-frame': 'rgba(38, 35, 46, 0.66)',
        '--gn-frame-edge': 'rgba(255, 255, 255, 0.08)',
        '--gn-frame-highlight': 'rgba(255, 255, 255, 0.07)',
        '--gn-frame-shadow': '0 22px 44px -20px rgba(0, 0, 0, 0.8), 0 6px 16px -8px rgba(0, 0, 0, 0.5)',
        '--gn-ink': '#f4f4f5',
        '--gn-muted': 'rgba(244, 244, 245, 0.62)',
    },
    light: {
        '--gn-frame': 'rgba(240, 240, 243, 0.8)',
        '--gn-frame-edge': 'rgba(24, 24, 27, 0.07)',
        '--gn-frame-highlight': 'rgba(255, 255, 255, 0.95)',
        '--gn-frame-shadow': '0 22px 44px -22px rgba(24, 24, 27, 0.3), 0 6px 16px -10px rgba(24, 24, 27, 0.16)',
        '--gn-ink': '#27272a',
        '--gn-muted': 'rgba(39, 39, 42, 0.62)',
    },
};

const PILLS = {
    dark: { color: '#f4f4f5', hover: 'rgba(255, 255, 255, 0.08)', shadow: 0.4 },
    light: { color: '#27272a', hover: 'rgba(24, 24, 27, 0.06)', shadow: 0.2 },
};

const SIZES = { sm: 'gooey-nav--sm', md: 'gooey-nav--md', lg: 'gooey-nav--lg' };

const MAX_DROPS = 32;
const MAX_PILLS = 4;
const MARGIN = 72;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uSize;
uniform float uRatio;
uniform vec4 uPills[${MAX_PILLS}];
uniform vec4 uHover;
uniform vec4 uDrops[${MAX_DROPS}];
uniform vec2 uTails[${MAX_DROPS}];
uniform vec3 uTints[${MAX_DROPS}];
uniform int uCount;
uniform float uSmooth;
uniform vec3 uPill;
uniform vec4 uHoverColor;
uniform float uShadow;

out vec4 outColor;

float sdPill(vec2 p, vec4 box) {
  vec2 extent = max(box.zw, vec2(0.0));
  float r = min(extent.x, extent.y);
  vec2 q = abs(p - box.xy) - extent + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

vec4 blend(vec4 a, vec4 b, float k) {
  float h = clamp(0.5 + 0.5 * (b.w - a.w) / k, 0.0, 1.0);
  return vec4(mix(b.rgb, a.rgb, h), mix(b.w, a.w, h) - k * h * (1.0 - h));
}

vec4 field(vec2 p) {
  vec4 shape = vec4(uPill, 1e5);
  for (int i = 0; i < ${MAX_PILLS}; i++) {
    vec4 pill = uPills[i];
    if (pill.z <= 0.0) continue;
    shape = blend(shape, vec4(uPill, sdPill(p, pill)), uSmooth);
  }
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uCount) break;
    vec4 drop = uDrops[i];
    if (drop.z <= 0.0) continue;
    float d = sdCapsule(p, drop.xy, drop.xy - uTails[i], drop.z);
    if (d > shape.w + uSmooth) continue;
    shape = blend(shape, vec4(uTints[i], d), uSmooth);
  }
  return shape;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uRatio - gl_FragCoord.y) / uRatio;
  vec4 shape = field(p);
  float d = shape.w;
  float aa = max(fwidth(d), 0.35);
  float body = clamp(0.5 - d / aa, 0.0, 1.0);

  vec2 grad = vec2(dFdx(d), -dFdy(d));
  vec2 n = length(grad) > 0.0001 ? normalize(grad) : vec2(0.0, 1.0);
  float rim = (1.0 - smoothstep(0.0, 1.6, -d)) * max(0.0, -n.y) * 0.3;
  vec3 fill = mix(shape.rgb, vec3(1.0), rim) * (1.0 - 0.06 * max(0.0, n.y) * (1.0 - smoothstep(0.0, 6.0, -d)));

  float lifted = field(p - vec2(0.0, 3.0)).w;
  float shadow = (1.0 - smoothstep(-3.0, 9.0, lifted)) * uShadow * (1.0 - body);

  float hover = clamp(0.5 - sdPill(p, uHover) / aa, 0.0, 1.0) * uHoverColor.a;

  vec4 color = vec4(0.0, 0.0, 0.0, shadow);
  color = vec4(uHoverColor.rgb * hover, hover) + color * (1.0 - hover);
  color = vec4(fill * body, body) + color * (1.0 - body);
  outColor = color;
}
`;

function parse(value) {
    if (!value) return [1, 1, 1, 1];
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
    if (match) {
        const hex = match[1].length === 3 ? match[1].replace(/./g, (digit) => digit + digit) : match[1];
        return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).concat(1);
    }
    const rgba = /rgba?\(([^)]+)\)/i.exec(String(value));
    if (rgba) {
        const parts = rgba[1].split(',').map((part) => parseFloat(part));
        return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
    }
    return [1, 1, 1, 1];
}

function contrastInk(rgb) {
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.55 ? '#18161d' : '#ffffff';
}

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function travelEase(t) {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function bezier(a, b, c, d, t) {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function pillPath(x, y, w, h) {
    if (w <= 0.5 || h <= 0.5) return '';
    const r = Math.min(w, h) / 2;
    return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

const UNIFORMS = [
    'uSize',
    'uRatio',
    'uPills',
    'uHover',
    'uDrops',
    'uTails',
    'uTints',
    'uCount',
    'uSmooth',
    'uPill',
    'uHoverColor',
    'uShadow',
];

function build(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[GooeyNav] WebGL program link failed:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    const uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    return { program, uniforms, buffer, position: gl.getAttribLocation(program, 'aPosition') };
}

export class GooeyNav {
    constructor(container, options = {}) {
        this.container = container;
        this.items = options.items || [];
        this.currentIndex = Math.min(
            Math.max(0, options.activeIndex ?? options.initialActiveIndex ?? 0),
            Math.max(0, this.items.length - 1)
        );
        this.onChange = options.onChange;
        this.theme =
            options.theme ||
            (document.documentElement.getAttribute('data-theme') === 'white' ||
            document.documentElement.getAttribute('data-theme') === 'latte'
                ? 'light'
                : 'dark');
        this.size = options.size || 'sm';
        this.frame = options.frame !== false;
        this.color = options.color;
        this.activeTextColor = options.activeTextColor;
        this.colors = options.colors || [];
        this.animationTime = options.animationTime ?? 600;
        this.particleCount = options.particleCount ?? 15;
        this.timeVariance = options.timeVariance ?? 300;
        this.spread = options.spread ?? 56;
        this.gooeyness = options.gooeyness ?? 0.5;
        this.wobble = options.wobble ?? 0.5;
        this.hoverEffect = options.hoverEffect !== false;
        this.className = options.className || '';
        this.style = options.style || {};

        this.disposed = false;
        this.raf = 0;
        this.last = 0;
        this.target = -1;
        this.rects = [];
        this.pills = new Map();
        this.drops = [];
        this.hover = { x: 0, y: 0, w: 0, h: 0, alpha: 0, index: -1 };
        this.view = { width: 0, height: 0 };

        this.pillData = new Float32Array(MAX_PILLS * 4);
        this.dropData = new Float32Array(MAX_DROPS * 4);
        this.tailData = new Float32Array(MAX_DROPS * 2);
        this.tintData = new Float32Array(MAX_DROPS * 3);

        this.mount();
    }

    mount() {
        if (!this.container) return;

        const palette = this.theme === 'light' ? 'light' : 'dark';
        const pillColor = this.color || PILLS[palette].color;
        const pillRgb = parse(pillColor);
        const textColor = this.activeTextColor || contrastInk(pillRgb);

        this.element = document.createElement('nav');
        this.element.className = `gooey-nav ${SIZES[this.size] || SIZES.md}${this.frame ? ' gooey-nav--framed' : ''} ${this.className}`.trim();

        const themeStyles = THEMES[palette] || THEMES.dark;
        for (const [k, v] of Object.entries(themeStyles)) {
            this.element.style.setProperty(k, v);
        }
        this.element.style.setProperty('--gn-pill', pillColor);
        this.element.style.setProperty('--gn-active-ink', textColor);

        if (this.style) {
            Object.assign(this.element.style, this.style);
        }

        if (this.frame) {
            const rim = document.createElement('span');
            rim.className = 'gooey-nav__rim';
            this.element.appendChild(rim);
        }

        const stage = document.createElement('div');
        stage.className = 'gooey-nav__stage';
        this.stage = stage;

        const canvas = document.createElement('canvas');
        canvas.className = 'gooey-nav__canvas';
        canvas.setAttribute('aria-hidden', 'true');
        stage.appendChild(canvas);
        this.canvas = canvas;

        const fallback = document.createElement('span');
        fallback.className = 'gooey-nav__fallback';
        fallback.setAttribute('aria-hidden', 'true');
        stage.appendChild(fallback);
        this.fallback = fallback;

        // Base interactive list
        const list = document.createElement('ul');
        list.className = 'gooey-nav__list';
        this.list = list;

        // Overlay active ink list (clipped)
        const overlay = document.createElement('ul');
        overlay.className = 'gooey-nav__list gooey-nav__list--active';
        overlay.setAttribute('aria-hidden', 'true');
        this.overlay = overlay;

        this.items.forEach((item, index) => {
            // Interactive item
            const li = document.createElement('li');
            li.className = 'gooey-nav__item';
            li.dataset.gooeyIndex = String(index);
            if (index === this.currentIndex) li.dataset.active = '';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gooey-nav__link';
            if (index === this.currentIndex) btn.setAttribute('aria-current', 'page');
            btn.textContent = item.label || '';
            btn.onclick = (e) => {
                e.preventDefault();
                this.select(index);
            };
            li.appendChild(btn);
            list.appendChild(li);

            // Active overlay mirror item
            const overlayLi = document.createElement('li');
            overlayLi.className = 'gooey-nav__item';
            const overlaySpan = document.createElement('span');
            overlaySpan.className = 'gooey-nav__link';
            overlaySpan.textContent = item.label || '';
            overlayLi.appendChild(overlaySpan);
            overlay.appendChild(overlayLi);
        });

        stage.appendChild(list);
        stage.appendChild(overlay);
        this.element.appendChild(stage);

        this.container.innerHTML = '';
        this.container.appendChild(this.element);

        this.initWebGL();
    }

    initWebGL() {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.reduced = reduced;

        let gl = null;
        try {
            gl = this.canvas.getContext('webgl2', {
                alpha: true,
                premultipliedAlpha: true,
                antialias: false,
            });
        } catch {}

        this.gl = gl;
        this.pipeline = gl ? build(gl) : null;

        if (!this.pipeline) {
            this.fallback.style.display = 'block';
            this.canvas.style.display = 'none';
        } else {
            this.fallback.style.display = 'none';
            this.canvas.style.display = 'block';
        }

        const onOver = (event) => {
            const item = event.target.closest('[data-gooey-index]');
            if (!item || !this.list.contains(item)) return;
            const index = Number(item.dataset.gooeyIndex);
            const rect = this.rects[index];
            if (!rect) return;
            if (this.hover.alpha < 0.01) {
                this.hover.x = rect.x + rect.w / 2;
                this.hover.y = rect.y + rect.h / 2;
                this.hover.w = rect.w;
                this.hover.h = rect.h;
            }
            this.hover.index = index;
            this.wake();
        };

        const onLeave = () => {
            this.hover.index = -1;
            this.wake();
        };

        this.list.addEventListener('pointerover', onOver);
        this.list.addEventListener('pointerleave', onLeave);
        this._removePointerListeners = () => {
            this.list.removeEventListener('pointerover', onOver);
            this.list.removeEventListener('pointerleave', onLeave);
        };

        this.resizeObserver = new ResizeObserver(() => {
            this.measure();
            if (!this.drops.length) this.settle(this.target < 0 ? this.currentIndex : this.target);
            else this.render();
        });
        this.resizeObserver.observe(this.stage);
        this.resizeObserver.observe(this.list);

        this.measure();
        this.settle(this.currentIndex);

        document.fonts?.ready.then(() => {
            if (this.disposed) return;
            this.measure();
            if (!this.drops.length) this.settle(this.target);
        });
    }

    measure() {
        if (!this.stage || !this.canvas) return;
        const box = this.stage.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        this.view.width = box.width;
        this.view.height = box.height;
        const outerWidth = box.width + MARGIN * 2;
        const outerHeight = box.height + MARGIN * 2;

        Object.assign(this.canvas.style, {
            left: `${-MARGIN}px`,
            top: `${-MARGIN}px`,
            width: `${outerWidth}px`,
            height: `${outerHeight}px`,
        });

        const width = Math.max(1, Math.round(outerWidth * ratio));
        const height = Math.max(1, Math.round(outerHeight * ratio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        this.rects = Array.from(this.list.children).map((item) => {
            const rect = item.getBoundingClientRect();
            return {
                x: rect.left - box.left,
                y: rect.top - box.top,
                w: rect.width,
                h: rect.height,
            };
        });
    }

    pill(index) {
        if (!this.pills.has(index)) {
            this.pills.set(index, { mass: 0, scale: 0, velocity: 0, outgoing: 0 });
        }
        return this.pills.get(index);
    }

    shape(index, amount) {
        const rect = this.rects[index];
        if (!rect || amount <= 0.002) return null;
        const h = rect.h * Math.min(1.08, 0.42 + 0.58 * Math.sqrt(Math.max(0, amount)));
        const w = Math.max(h, rect.w * Math.max(0, amount) ** 0.75);
        return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
    }

    plan(drop, index, now, fresh) {
        const rect = this.rects[index];
        if (!rect) return;
        const reach = Math.max(0, this.spread);
        const ex = rect.x + rect.w / 2 + (Math.random() - 0.5) * rect.w * 0.45;
        const ey = rect.y + rect.h / 2 + (Math.random() - 0.5) * rect.h * 0.2;
        const base = Math.max(0.15, this.animationTime / 1000);
        const variance = (Math.random() - 0.5) * (Math.max(0, this.timeVariance) / 1000);
        const duration = Math.max(0.15, base * (0.62 + Math.random() * 0.32) + variance * 0.6);
        const out = Math.random() * Math.PI * 2;
        const into = Math.random() * Math.PI * 2;
        const burst = reach * (0.7 + Math.random() * 0.6);
        const swing = reach * (0.55 + Math.random() * 0.55);
        const carry = Math.min(duration / 3, 0.12);

        drop.index = index;
        drop.start = now;
        drop.duration = duration;
        drop.path = [
            drop.x,
            drop.y,
            fresh ? drop.x + Math.cos(out) * burst * 1.6 : drop.x + drop.vx * carry,
            fresh ? drop.y + Math.sin(out) * burst * 1.6 : drop.y + drop.vy * carry,
            ex + Math.cos(into) * swing * 1.5,
            ey + Math.sin(into) * swing * 1.5,
            ex,
            ey,
        ];
    }

    emit(from, to, now) {
        const source = this.pills.get(from);
        const rect = this.rects[from];
        if (!source || !rect || !this.rects[to]) return;
        const available = source.mass - source.outgoing;
        if (available <= 0.002) return;
        const room = MAX_DROPS - this.drops.length;
        const count = Math.min(room, Math.max(1, Math.round(Math.max(1, this.particleCount) * available)));
        if (count <= 0) return;
        const window = Math.max(0.15, this.animationTime / 1000) * 0.16;
        const tints = this.colors.map(parse);

        for (let i = 0; i < count; i++) {
            const mass = available / count;
            source.outgoing += mass;
            this.drops.push({
                x: rect.x + rect.w / 2 + (Math.random() - 0.5) * rect.w * 0.6,
                y: rect.y + rect.h / 2 + (Math.random() - 0.5) * rect.h * 0.3,
                vx: 0,
                vy: 0,
                mass,
                size: 0.8 + Math.random() * 0.4,
                given: 0,
                source: from,
                index: to,
                leave: now + Math.random() * window * 1000,
                emerged: 0,
                absorbed: 0,
                state: 'waiting',
                tint: tints.length ? tints[Math.floor(Math.random() * tints.length)] : null,
            });
        }
    }

    trace(boxes, blobs, smooth) {
        const field = (x, y) => {
            let d = 1e5;
            const merge = (value) => {
                const h = clamp01(0.5 + (0.5 * (value - d)) / smooth);
                d = value + (d - value) * h - smooth * h * (1 - h);
            };
            for (const box of boxes) {
                const r = Math.min(box.hw, box.hh);
                const qx = Math.abs(x - box.cx) - box.hw + r;
                const qy = Math.abs(y - box.cy) - box.hh + r;
                merge(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
            }
            for (const blob of blobs) {
                const px = x - blob.x;
                const py = y - blob.y;
                const bx = -blob.tx;
                const by = -blob.ty;
                const span = bx * bx + by * by;
                const h = span > 0.0001 ? clamp01((px * bx + py * by) / span) : 0;
                const value = Math.hypot(px - bx * h, py - by * h) - blob.r;
                if (value > d + smooth) continue;
                merge(value);
            }
            return d;
        };

        const step = 2;
        const parts = [];
        for (let y = 0; y < this.view.height; y += 1) {
            const cy = y + 0.5;
            let previous = field(0, cy);
            let start = previous < 0 ? 0 : null;
            for (let x = step; x <= this.view.width + step; x += step) {
                const value = field(Math.min(x, this.view.width), cy);
                if (previous < 0 !== value < 0) {
                    const cross = x - step + ((step * previous) / (previous - value));
                    if (value < 0) start = cross;
                    else if (start !== null) {
                        parts.push(`M${start.toFixed(1)},${y}H${cross.toFixed(1)}V${y + 1}H${start.toFixed(1)}Z`);
                        start = null;
                    }
                }
                previous = value;
            }
            if (start !== null) parts.push(`M${start.toFixed(1)},${y}H${this.view.width}V${y + 1}H${start.toFixed(1)}Z`);
        }
        return parts.join('');
    }

    render() {
        const height = this.rects[this.target]?.h ?? this.rects[0]?.h ?? 36;
        const smooth = height * (0.18 + 0.5 * clamp01(this.gooeyness));
        const boxes = [];
        const blobs = [];

        for (const [index, state] of this.pills) {
            const box = this.shape(index, state.scale);
            if (box) boxes.push({ cx: box.x + box.w / 2, cy: box.y + box.h / 2, hw: box.w / 2, hh: box.h / 2 });
        }

        for (const drop of this.drops) {
            if (drop.state === 'waiting') continue;
            const radius = 0.26 * height * drop.size * Math.min(drop.emerged, 1 - drop.absorbed);
            if (radius <= 0.05) continue;
            const speed = Math.hypot(drop.vx, drop.vy);
            const length = Math.min(radius * 1.1, speed * 0.018);
            blobs.push({
                x: drop.x,
                y: drop.y,
                r: radius,
                tx: speed > 0.01 ? (drop.vx / speed) * length : 0,
                ty: speed > 0.01 ? (drop.vy / speed) * length : 0,
                tint: drop.tint,
            });
        }

        const settledPill = boxes.length === 1 && !blobs.length;
        if (settledPill) {
            const box = boxes[0];
            this.overlay.style.clipPath = `path('${pillPath(box.cx - box.hw, box.cy - box.hh, box.hw * 2, box.hh * 2)}')`;
        } else {
            this.overlay.style.clipPath = `path('${this.trace(boxes, blobs, smooth) || 'M0,0Z'}')`;
        }
        this.overlay.style.visibility = 'visible';

        if (!this.pipeline || !this.gl) {
            const box = this.shape(this.target, 1);
            if (box) {
                this.fallback.style.transform = `translate(${box.x.toFixed(2)}px, ${box.y.toFixed(2)}px)`;
                this.fallback.style.width = `${box.w}px`;
                this.fallback.style.height = `${box.h}px`;
            }
            this.fallback.style.opacity = box ? '1' : '0';
            return;
        }

        const gl = this.gl;
        let slot = 0;
        for (const box of boxes) {
            if (slot >= MAX_PILLS) break;
            this.pillData[slot * 4] = box.cx + MARGIN;
            this.pillData[slot * 4 + 1] = box.cy + MARGIN;
            this.pillData[slot * 4 + 2] = box.hw;
            this.pillData[slot * 4 + 3] = box.hh;
            slot += 1;
        }
        this.pillData.fill(0, slot * 4);

        let count = 0;
        const palette = this.theme === 'light' ? 'light' : 'dark';
        const pillColor = this.color || PILLS[palette].color;
        const pillRgb = parse(pillColor);

        for (const blob of blobs) {
            if (count >= MAX_DROPS) break;
            this.dropData[count * 4] = blob.x + MARGIN;
            this.dropData[count * 4 + 1] = blob.y + MARGIN;
            this.dropData[count * 4 + 2] = blob.r;
            this.dropData[count * 4 + 3] = 0;
            this.tailData[count * 2] = blob.tx;
            this.tailData[count * 2 + 1] = blob.ty;
            const tint = blob.tint || pillRgb;
            this.tintData[count * 3] = tint[0];
            this.tintData[count * 3 + 1] = tint[1];
            this.tintData[count * 3 + 2] = tint[2];
            count += 1;
        }

        const { program, uniforms, buffer, position } = this.pipeline;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(uniforms.uSize, this.view.width + MARGIN * 2, this.view.height + MARGIN * 2);
        gl.uniform1f(uniforms.uRatio, this.canvas.width / Math.max(1, this.view.width + MARGIN * 2));
        gl.uniform4fv(uniforms.uPills, this.pillData);
        gl.uniform4f(uniforms.uHover, this.hover.x + MARGIN, this.hover.y + MARGIN, this.hover.w / 2, this.hover.h / 2);
        gl.uniform4fv(uniforms.uDrops, this.dropData);
        gl.uniform2fv(uniforms.uTails, this.tailData);
        gl.uniform3fv(uniforms.uTints, this.tintData);
        gl.uniform1i(uniforms.uCount, count);
        gl.uniform1f(uniforms.uSmooth, smooth);
        gl.uniform3f(uniforms.uPill, pillRgb[0], pillRgb[1], pillRgb[2]);
        const hoverRgb = parse(PILLS[palette].hover);
        gl.uniform4f(uniforms.uHoverColor, hoverRgb[0], hoverRgb[1], hoverRgb[2], hoverRgb[3] * this.hover.alpha);
        gl.uniform1f(uniforms.uShadow, PILLS[palette].shadow);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    frameLoop(now) {
        this.raf = 0;
        const dt = Math.min(0.05, (now - this.last) / 1000 || 0);
        this.last = now;
        const emergeTime = 0.09;
        const absorbTime = 0.12;

        for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];
            if (drop.state === 'waiting') {
                if (now < drop.leave) continue;
                drop.state = 'flying';
                this.plan(drop, drop.index, now, true);
            }
            if (drop.state === 'flying') {
                drop.emerged = Math.min(1, drop.emerged + dt / emergeTime);
                const source = this.pills.get(drop.source);
                if (source && drop.given < drop.mass) {
                    const step = Math.min(drop.mass * (dt / emergeTime), drop.mass - drop.given);
                    source.mass = Math.max(0, source.mass - step);
                    source.outgoing = Math.max(0, source.outgoing - step);
                    drop.given += step;
                }
                const t = clamp01((now - drop.start) / 1000 / drop.duration);
                const eased = travelEase(t);
                const [x0, y0, x1, y1, x2, y2, x3, y3] = drop.path;
                const x = bezier(x0, x1, x2, x3, eased);
                const y = bezier(y0, y1, y2, y3, eased);
                if (dt > 0) {
                    drop.vx = (x - drop.x) / dt;
                    drop.vy = (y - drop.y) / dt;
                }
                drop.x = x;
                drop.y = y;
                if (t >= 1) drop.state = 'absorbing';
            }
            if (drop.state === 'absorbing') {
                const step = Math.min(1 - drop.absorbed, dt / absorbTime);
                drop.absorbed += step;
                drop.vx *= 0.8;
                drop.vy *= 0.8;
                const host = this.pill(drop.index);
                host.mass = Math.min(1, host.mass + drop.mass * step);
                if (drop.absorbed >= 1) this.drops.splice(i, 1);
            }
        }

        const zeta = this.reduced ? 1 : 1 - 0.72 * clamp01(this.wobble);
        const omega = 26;
        const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = dt / steps;

        for (const [index, state] of this.pills) {
            for (let n = 0; n < steps; n++) {
                state.velocity += (omega * omega * (state.mass - state.scale) - 2 * zeta * omega * state.velocity) * h;
                state.scale += state.velocity * h;
            }
            if (index !== this.target && state.mass <= 0.002 && state.outgoing <= 0.002 && Math.abs(state.scale) < 0.004) {
                this.pills.delete(index);
            }
        }

        if (this.hover.index >= 0 && this.rects[this.hover.index]) {
            const rect = this.rects[this.hover.index];
            const k = 1 - Math.exp(-dt / 0.06);
            this.hover.x += (rect.x + rect.w / 2 - this.hover.x) * k;
            this.hover.y += (rect.y + rect.h / 2 - this.hover.y) * k;
            this.hover.w += (rect.w - this.hover.w) * k;
            this.hover.h += (rect.h - this.hover.h) * k;
        }
        const hoverGoal = this.hoverEffect && this.hover.index >= 0 && this.hover.index !== this.target ? 1 : 0;
        this.hover.alpha += (hoverGoal - this.hover.alpha) * (1 - Math.exp(-dt / 0.08));

        this.render();

        const host = this.pills.get(this.target);
        const resting =
            this.drops.length === 0 &&
            this.pills.size === 1 &&
            host &&
            Math.abs(host.mass - host.scale) < 0.0008 &&
            Math.abs(host.velocity) < 0.004;

        const hoverRect = this.rects[this.hover.index];
        const hovering =
            Math.abs(hoverGoal - this.hover.alpha) > 0.003 ||
            (hoverRect &&
                Math.abs(hoverRect.x + hoverRect.w / 2 - this.hover.x) + Math.abs(hoverRect.w - this.hover.w) > 0.1);

        if (!resting || hovering) {
            this.raf = requestAnimationFrame((t) => this.frameLoop(t));
        } else {
            host.mass = 1;
            host.scale = 1;
            host.velocity = 0;
            this.hover.alpha = hoverGoal;
            this.render();
        }
    }

    wake() {
        if (this.raf || this.disposed) return;
        this.last = performance.now();
        this.raf = requestAnimationFrame((t) => this.frameLoop(t));
    }

    settle(index) {
        this.pills.clear();
        this.drops.length = 0;
        this.target = index;
        const state = this.pill(index);
        state.mass = 1;
        state.scale = 1;
        state.velocity = 0;
        this.render();
    }

    go(index, animate = true) {
        if (index === this.target) return;
        if (!this.rects[index] || !animate || this.reduced || this.target < 0) {
            this.settle(index);
            return;
        }

        const now = performance.now();
        this.target = index;
        this.pill(index);

        for (const drop of this.drops) {
            drop.index = index;
            if (drop.state === 'flying') this.plan(drop, index, now, false);
            if (drop.state === 'absorbing') {
                drop.state = 'flying';
                drop.mass *= 1 - drop.absorbed;
                drop.absorbed = 0;
                this.plan(drop, index, now, false);
            }
        }

        for (const from of [...this.pills.keys()]) {
            if (from !== index) this.emit(from, index, now);
        }
        this.wake();
    }

    select(index) {
        if (index === this.currentIndex) return;
        this.currentIndex = index;

        // Update active dataset on buttons
        Array.from(this.list.children).forEach((li, i) => {
            const link = li.querySelector('.gooey-nav__link');
            if (i === index) {
                li.dataset.active = '';
                link?.setAttribute('aria-current', 'page');
            } else {
                delete li.dataset.active;
                link?.removeAttribute('aria-current');
            }
        });

        this.go(index, true);
        this.onChange?.(index, this.items[index]);
    }

    setActiveIndex(index) {
        if (index < 0 || index >= this.items.length) return;
        this.select(index);
    }

    destroy() {
        this.disposed = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.resizeObserver?.disconnect();
        this._removePointerListeners?.();

        if (this.gl && this.pipeline) {
            this.gl.deleteBuffer(this.pipeline.buffer);
            this.gl.deleteProgram(this.pipeline.program);
        }
        this.element?.remove();
    }
}
