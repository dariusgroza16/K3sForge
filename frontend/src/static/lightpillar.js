// Full light-pillar shader implementation ported from React component
// https://reactbits.dev/backgrounds/light-pillar
(function(){
  const container = document.querySelector('.light-pillar-container');
  if (!container) return;

  // WebGL feature detection
  const canvasTest = document.createElement('canvas');
  const gl = canvasTest.getContext('webgl') || canvasTest.getContext('experimental-webgl');
  if (!gl) {
    container.classList.add('light-pillar-fallback');
    container.textContent = 'WebGL not supported';
    return;
  }

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  // Device detection and quality settings
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isLowEndDevice = isMobile || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);

  let quality = 'high';
  if (isLowEndDevice && quality === 'high') quality = 'medium';
  if (isMobile && quality !== 'low') quality = 'low';

  const qualitySettings = {
    low: { iterations: 24, waveIterations: 1, pixelRatio: 0.5, precision: 'mediump', stepMultiplier: 1.5 },
    medium: { iterations: 40, waveIterations: 2, pixelRatio: 0.65, precision: 'mediump', stepMultiplier: 1.2 },
    high: { iterations: 80, waveIterations: 4, pixelRatio: Math.min(window.devicePixelRatio, 2), precision: 'highp', stepMultiplier: 1.0 }
  };

  const settings = qualitySettings[quality] || qualitySettings.medium;

  // Initialize renderer with quality settings
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    powerPreference: quality === 'high' ? 'high-performance' : 'low-power',
    precision: settings.precision,
    stencil: false,
    depth: false
  });

  renderer.setSize(width, height);
  renderer.setPixelRatio(settings.pixelRatio);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.pointerEvents = 'none';
  renderer.domElement.style.mixBlendMode = 'screen';
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  container.classList.add('canvas-mounted');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const parseColor = hex => {
    const color = new THREE.Color(hex);
    return new THREE.Vector3(color.r, color.g, color.b);
  };

  // Shader configuration - using red & white
  const topColor = '#ff2934';
  const bottomColor = '#c0bfc0';
  const intensity = 1.3;
  const rotationSpeed = 0.4;
  const interactive = false;
  const glowAmount = 0.002;
  const pillarWidth = 3.4;
  const pillarHeight = 0.4;
  const noiseIntensity = 0;
  const pillarRotation = 38;

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    precision ${settings.precision} float;

    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec2 uMouse;
    uniform vec3 uTopColor;
    uniform vec3 uBottomColor;
    uniform float uIntensity;
    uniform bool uInteractive;
    uniform float uGlowAmount;
    uniform float uPillarWidth;
    uniform float uPillarHeight;
    uniform float uNoiseIntensity;
    uniform float uRotCos;
    uniform float uRotSin;
    uniform float uPillarRotCos;
    uniform float uPillarRotSin;
    uniform float uWaveSin;
    uniform float uWaveCos;
    varying vec2 vUv;

    const float STEP_MULT = ${settings.stepMultiplier.toFixed(1)};
    const int MAX_ITER = ${settings.iterations};
    const int WAVE_ITER = ${settings.waveIterations};

    void main() {
      vec2 uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);
      uv = vec2(uPillarRotCos * uv.x - uPillarRotSin * uv.y, uPillarRotSin * uv.x + uPillarRotCos * uv.y);

      vec3 ro = vec3(0.0, 0.0, -10.0);
      vec3 rd = normalize(vec3(uv, 1.0));

      float rotC = uRotCos;
      float rotS = uRotSin;
      if(uInteractive && (uMouse.x != 0.0 || uMouse.y != 0.0)) {
        float a = uMouse.x * 6.283185;
        rotC = cos(a);
        rotS = sin(a);
      }

      vec3 col = vec3(0.0);
      float t = 0.1;
      
      for(int i = 0; i < MAX_ITER; i++) {
        vec3 p = ro + rd * t;
        p.xz = vec2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);

        vec3 q = p;
        q.y = p.y * uPillarHeight + uTime;
        
        float freq = 1.0;
        float amp = 1.0;
        for(int j = 0; j < WAVE_ITER; j++) {
          q.xz = vec2(uWaveCos * q.x - uWaveSin * q.z, uWaveSin * q.x + uWaveCos * q.z);
          q += cos(q.zxy * freq - uTime * float(j) * 2.0) * amp;
          freq *= 2.0;
          amp *= 0.5;
        }
        
        float d = length(cos(q.xz)) - 0.2;
        float bound = length(p.xz) - uPillarWidth;
        float k = 4.0;
        float h = max(k - abs(d - bound), 0.0);
        d = max(d, bound) + h * h * 0.0625 / k;
        d = abs(d) * 0.15 + 0.01;

        float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
        col += mix(uBottomColor, uTopColor, grad) / d;

        t += d * STEP_MULT;
        if(t > 50.0) break;
      }

      float widthNorm = uPillarWidth / 3.0;
      col = tanh(col * uGlowAmount / widthNorm);
      
      col -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * uNoiseIntensity;
      
      gl_FragColor = vec4(col * uIntensity, 1.0);
    }
  `;

  const pillarRotRad = (pillarRotation * Math.PI) / 180;
  const waveSin = Math.sin(0.4);
  const waveCos = Math.cos(0.4);
  const mouseRef = new THREE.Vector2(0, 0);
  let timeRef = 0;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uMouse: { value: mouseRef },
      uTopColor: { value: parseColor(topColor) },
      uBottomColor: { value: parseColor(bottomColor) },
      uIntensity: { value: intensity },
      uInteractive: { value: interactive },
      uGlowAmount: { value: glowAmount },
      uPillarWidth: { value: pillarWidth },
      uPillarHeight: { value: pillarHeight },
      uNoiseIntensity: { value: noiseIntensity },
      uRotCos: { value: 1.0 },
      uRotSin: { value: 0.0 },
      uPillarRotCos: { value: Math.cos(pillarRotRad) },
      uPillarRotSin: { value: Math.sin(pillarRotRad) },
      uWaveSin: { value: waveSin },
      uWaveCos: { value: waveCos }
    },
    transparent: true,
    depthWrite: false,
    depthTest: false
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Mouse interaction (optional)
  let mouseMoveTimeout = null;
  const handleMouseMove = event => {
    if (!interactive) return;
    if (mouseMoveTimeout) return;

    mouseMoveTimeout = window.setTimeout(() => {
      mouseMoveTimeout = null;
    }, 16);

    const rect = container.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    mouseRef.set(x, y);
  };

  if (interactive) {
    container.addEventListener('mousemove', handleMouseMove, { passive: true });
  }

  // Animation loop with FPS throttling
  let lastTime = performance.now();
  const targetFPS = quality === 'low' ? 30 : 60;
  const frameTime = 1000 / targetFPS;
  let rafId = null;

  const animate = currentTime => {
    const deltaTime = currentTime - lastTime;

    if (deltaTime >= frameTime) {
      timeRef += 0.016 * rotationSpeed;
      const t = timeRef;
      material.uniforms.uTime.value = t;
      material.uniforms.uRotCos.value = Math.cos(t * 0.3);
      material.uniforms.uRotSin.value = Math.sin(t * 0.3);
      renderer.render(scene, camera);
      lastTime = currentTime - (deltaTime % frameTime);
    }

    rafId = requestAnimationFrame(animate);
  };
  rafId = requestAnimationFrame(animate);

  // Resize handling
  let resizeTimeout = null;
  const handleResize = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);

    resizeTimeout = window.setTimeout(() => {
      const newWidth = container.clientWidth || window.innerWidth;
      const newHeight = container.clientHeight || window.innerHeight;
      renderer.setSize(newWidth, newHeight);
      material.uniforms.uResolution.value.set(newWidth, newHeight);
    }, 150);
  };

  window.addEventListener('resize', handleResize, { passive: true });

  // Cleanup
  container._lightPillarCleanup = function() {
    window.removeEventListener('resize', handleResize);
    if (interactive) {
      container.removeEventListener('mousemove', handleMouseMove);
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    }
    if (material) material.dispose();
    if (geometry) geometry.dispose();
  };
})();
