// WebGPU zero-copy bilinear compositor for GPU-resident matting tensor buffers.
// Reuses ONNX Runtime's shared ort.env.webgpu.device to render directly from VRAM.

export type WebGpuCompositor = {
  render: (
    cameraImage: HTMLCanvasElement | ImageBitmap | HTMLVideoElement,
    backgroundImage: HTMLCanvasElement | ImageBitmap | HTMLVideoElement | null,
    gpuBuffer: GPUBuffer,
    maskWidth: number,
    maskHeight: number,
    canvasWidth: number,
    canvasHeight: number,
  ) => void
  dispose: () => void
}

const WGSL_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var uv = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}

@group(0) @binding(0) var cameraTexture: texture_2d<f32>;
@group(0) @binding(1) var bgTexture: texture_2d<f32>;
@group(0) @binding(2) var textureSampler: sampler;
@group(0) @binding(3) var<storage, read> maskBuffer: array<f32>;
@group(0) @binding(4) var<uniform> maskDims: vec2<f32>;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let fgColor = textureSample(cameraTexture, textureSampler, in.uv);
  let bgColor = textureSample(bgTexture, textureSampler, in.uv);
  
  let w = maskDims.x;
  let h = maskDims.y;
  // Pixel-center sampling, matching Canvas bilinear resizing.
  let x = clamp(in.uv.x * w - 0.5, 0.0, w - 1.0);
  let y = clamp(in.uv.y * h - 0.5, 0.0, h - 1.0);
  
  let x0 = u32(floor(x));
  let y0 = u32(floor(y));
  let x1 = min(x0 + 1u, u32(w - 1.0));
  let y1 = min(y0 + 1u, u32(h - 1.0));
  
  let fx = fract(x);
  let fy = fract(y);
  
  let stride = u32(w);
  let m00 = maskBuffer[y0 * stride + x0];
  let m10 = maskBuffer[y0 * stride + x1];
  let m01 = maskBuffer[y1 * stride + x0];
  let m11 = maskBuffer[y1 * stride + x1];
  
  let top = mix(m00, m10, fx);
  let bottom = mix(m01, m11, fx);
  let alpha = clamp(mix(top, bottom, fy), 0.0, 1.0);
  
  let composited = mix(bgColor.rgb, fgColor.rgb, alpha);
  return vec4<f32>(composited, 1.0);
}
`

export function createWebGpuCompositor(
  device: GPUDevice,
  targetCanvas: HTMLCanvasElement,
): WebGpuCompositor | null {
  const context = targetCanvas.getContext('webgpu')
  if (!context) return null

  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })

  const module = device.createShaderModule({ code: WGSL_SHADER })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-strip' },
  })

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const dimsBuffer = device.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  let currentCameraTexture: GPUTexture | null = null
  let currentBgTexture: GPUTexture | null = null
  let defaultBgTexture: GPUTexture | null = null

  // Single pixel fallback default dark background texture
  const ensureDefaultBgView = () => {
    if (!defaultBgTexture) {
      defaultBgTexture = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      device.queue.writeTexture({ texture: defaultBgTexture }, new Uint8Array([20, 20, 25, 255]), { bytesPerRow: 4 }, [1, 1, 1])
    }
    return defaultBgTexture.createView()
  }

  return {
    render(cameraImage, backgroundImage, gpuBuffer, maskWidth, maskHeight, canvasWidth, canvasHeight) {
      if (!Number.isInteger(maskWidth) || !Number.isInteger(maskHeight) || maskWidth <= 0 || maskHeight <= 0 || gpuBuffer.size < maskWidth * maskHeight * 4) {
        throw new Error('WebGPU compositor requires a contiguous float32 alpha plane of maskWidth × maskHeight pixels')
      }
      if (targetCanvas.width !== canvasWidth || targetCanvas.height !== canvasHeight) {
        targetCanvas.width = canvasWidth
        targetCanvas.height = canvasHeight
        context.configure({ device, format, alphaMode: 'opaque' })
      }

      device.queue.writeBuffer(dimsBuffer, 0, new Float32Array([maskWidth, maskHeight]))

      const srcW = cameraImage instanceof HTMLVideoElement ? cameraImage.videoWidth : cameraImage.width
      const srcH = cameraImage instanceof HTMLVideoElement ? cameraImage.videoHeight : cameraImage.height

      currentCameraTexture?.destroy()
      currentCameraTexture = device.createTexture({
        size: [srcW, srcH, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      })
      device.queue.copyExternalImageToTexture({ source: cameraImage }, { texture: currentCameraTexture }, [srcW, srcH])

      let bgTextureView: GPUTextureView
      if (backgroundImage) {
        const bgW = backgroundImage instanceof HTMLVideoElement ? backgroundImage.videoWidth : backgroundImage.width
        const bgH = backgroundImage instanceof HTMLVideoElement ? backgroundImage.videoHeight : backgroundImage.height
        currentBgTexture?.destroy()
        currentBgTexture = device.createTexture({
          size: [bgW, bgH, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        })
        device.queue.copyExternalImageToTexture({ source: backgroundImage }, { texture: currentBgTexture }, [bgW, bgH])
        bgTextureView = currentBgTexture.createView()
      } else {
        bgTextureView = ensureDefaultBgView()
      }

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: currentCameraTexture.createView() },
          { binding: 1, resource: bgTextureView },
          { binding: 2, resource: sampler },
          { binding: 3, resource: { buffer: gpuBuffer } },
          { binding: 4, resource: { buffer: dimsBuffer } },
        ],
      })

      const commandEncoder = device.createCommandEncoder()
      const textureView = context.getCurrentTexture().createView()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })

      renderPass.setPipeline(pipeline)
      renderPass.setBindGroup(0, bindGroup)
      renderPass.draw(4)
      renderPass.end()

      device.queue.submit([commandEncoder.finish()])
    },
    dispose() {
      currentCameraTexture?.destroy()
      currentBgTexture?.destroy()
      defaultBgTexture?.destroy()
      dimsBuffer.destroy()
    },
  }
}
