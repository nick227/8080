// Joint-bilateral mask upsampling: spatially nearby coarse mask samples are
// weighted by similarity to the full-resolution camera pixel. Unlike bilinear
// scaling, an RGB boundary can steer the alpha boundary. This is not a learned
// guided filter and cannot recover foreground absent from the coarse mask.
export function createEdgeRefiner() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, depth: false, antialias: false })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const textures: WebGLTexture[] = []
  let program: WebGLProgram | null = null
  let failed = false
  const dispose = () => {
    textures.forEach(t => gl.deleteTexture(t))
    shaders.forEach(s => gl.deleteShader(s))
    if (program) gl.deleteProgram(program)
  }
  try {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      shaders.push(shader)
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed')
      return shader
    }
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv;
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        uv = vec2(p.x, 1.0 - p.y);
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`)
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 uv;
      uniform sampler2D guide;
      uniform sampler2D mask;
      uniform vec2 maskSize;
      out vec4 color;
      void main() {
        float base = texture(mask, uv).a;
        // Preserve confident interiors; refine only the uncertain edge band.
        if (base < 0.005 || base > 0.995) { color = vec4(0.0, 0.0, 0.0, base); return; }
        vec3 center = texture(guide, uv).rgb;
        vec2 pos = uv * maskSize - 0.5;
        vec2 origin = floor(pos);
        float sum = 0.0, weights = 0.0;
        for (int y = -1; y <= 2; y++) for (int x = -1; x <= 2; x++) {
          vec2 cell = origin + vec2(float(x), float(y));
          vec2 sampleUv = (cell + 0.5) / maskSize;
          vec3 delta = texture(guide, sampleUv).rgb - center;
          vec2 distance = cell - pos;
          // A nonzero color floor limits texture-copy artifacts in noisy shadows.
          float weight = exp(-dot(distance, distance) / 2.0) * (0.02 + exp(-dot(delta, delta) / 0.02));
          sum += texture(mask, sampleUv).a * weight;
          weights += weight;
        }
        float refined = sum / max(weights, 0.00001);
        color = vec4(0.0, 0.0, 0.0, mix(base, refined, 0.85));
      }`)
    program = gl.createProgram()!
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Refiner link failed')
    gl.useProgram(program)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!
      textures.push(texture)
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.uniform1i(gl.getUniformLocation(program, 'guide'), 0)
    gl.uniform1i(gl.getUniformLocation(program, 'mask'), 1)
    const maskSize = gl.getUniformLocation(program, 'maskSize')
    canvas.addEventListener('webglcontextlost', () => { failed = true })
    return {
      dispose,
      render(guide: HTMLCanvasElement, mask: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement | null {
        if (failed || gl.isContextLost()) return null
        try {
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
          gl.viewport(0, 0, width, height)
          gl.useProgram(program)
          for (const [i, source] of [guide, mask].entries()) {
            gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[i]!)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
          }
          gl.uniform2f(maskSize, mask.width, mask.height)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          if (gl.getError() !== gl.NO_ERROR) { failed = true; return null }
          return canvas
        } catch { failed = true; return null }
      },
    }
  } catch { dispose(); return null }
}
