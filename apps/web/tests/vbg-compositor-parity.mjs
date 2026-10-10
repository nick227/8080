import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
// Optional JSON from the live HUD: compare its exact unmodified model alpha too.
const fixture = process.env.VBG_DIAGNOSTIC ? JSON.parse(await readFile(process.env.VBG_DIAGNOSTIC, 'utf8')) : null
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas'] })
try {
 const page = await browser.newPage()
 await page.goto('http://localhost:5173/vbg-lab.html')
 const results = await page.evaluate(async fixture => {
  const { createWebGpuCompositor } = await import('/src/features/vbg/webgpuCompositor.ts')
  const gpu = navigator.gpu, adapter = await gpu?.requestAdapter()
  if (!adapter) throw new Error('WebGPU unavailable: parity test cannot pass')
  const device = await adapter.requestDevice(), failures = []
  // Retain the WebGPU instance throughout the asynchronous test.
  window.__gpuParity = { gpu, adapter, device }
  device.addEventListener('uncapturederror', event => failures.push(event.error.message))
  const make = (w,h) => Object.assign(document.createElement('canvas'), {width:w,height:h})
  const rows=[]
  async function compare(name, values,w,h, { defaultBackground=false, original=null, W=32, H=24 }={}) {
   const camera=make(W,H), bg=make(W,H), output=make(W,H)
   const c=camera.getContext('2d');c.fillStyle='#e83020';c.fillRect(0,0,W,H);c.fillStyle='#30e020';c.fillRect(0,0,W/2,H/2)
   if(original){const img=new Image();img.src=original;await img.decode();c.drawImage(img,0,0,W,H)}
   const b=bg.getContext('2d');b.fillStyle='#2040d0';b.fillRect(0,0,W,H)
   // Exercise the exact production shader, buffer binding and image upload code
   // against an offscreen attachment. Swapchain presentation is not tested here:
   // this software GPU loses its device when acquiring a canvas swapchain.
   const attachment=device.createTexture({size:[W,H],format:gpu.getPreferredCanvasFormat(),usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC})
   output.getContext = kind => kind === 'webgpu' ? {configure(){},getCurrentTexture:()=>attachment} : null
   device.pushErrorScope('validation')
   const renderer=createWebGpuCompositor(device,output)
   const mask=make(w,h), m=mask.getContext('2d'), px=m.createImageData(w,h)
   values.forEach((a,i)=>px.data[i*4+3]=Math.round(a*255));m.putImageData(px,0,0)
   const reference=make(W,H),ctx=reference.getContext('2d')
   ctx.drawImage(camera,0,0);ctx.globalCompositeOperation='destination-in';ctx.imageSmoothingQuality='low';ctx.drawImage(mask,0,0,W,H)
   ctx.globalCompositeOperation='destination-over';if(!defaultBackground)ctx.drawImage(bg,0,0);else {ctx.fillStyle='rgb(20,20,25)';ctx.fillRect(0,0,W,H)}
   const buffer=device.createBuffer({size:values.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,values)
   let error=null
   try{renderer.render(camera,defaultBackground?null:bg,buffer,w,h,W,H);await device.queue.onSubmittedWorkDone()}catch(e){error=String(e)}
   const gpuError=await device.popErrorScope();if(gpuError)error=gpuError.message
   const stride=Math.ceil(W*4/256)*256
   const readback=device.createBuffer({size:stride*H,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})
   const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:attachment},{buffer:readback,bytesPerRow:stride},[W,H]);device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ)
   const bytes=new Uint8Array(readback.getMappedRange()),ap=new Uint8Array(W*H*4),bgra=gpu.getPreferredCanvasFormat().startsWith('bgra')
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,j=y*stride+x*4;ap[i]=bytes[j+(bgra?2:0)];ap[i+1]=bytes[j+1];ap[i+2]=bytes[j+(bgra?0:2)];ap[i+3]=bytes[j+3]}
   readback.unmap();readback.destroy()
   const expected=ctx.getImageData(0,0,W,H).data
   let max=0,total=0;for(let i=0;i<ap.length;i++){if(i%4===3)continue;const delta=Math.abs(ap[i]-expected[i]);max=Math.max(max,delta);total+=delta}
   rows.push({name,maxError:max,meanError:total/(W*H*3),error})
   const half=device.createBuffer({size:Math.ceil(w*h*2/4)*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST})
   let rejectedHalf=false;try{renderer.render(camera,bg,half,w,h,W,H)}catch{rejectedHalf=true}
   buffer.destroy();half.destroy();renderer.dispose();attachment.destroy()
   if(!rejectedHalf)throw new Error('float16 buffer was silently accepted as float32')
  }
  await compare('opaque + camera orientation',new Float32Array(12).fill(1),4,3)
  await compare('transparent',new Float32Array(12),4,3)
  await compare('half alpha',new Float32Array(12).fill(0.5),4,3)
  await compare('asymmetric mask + pixel centers',new Float32Array([1,1,0,0,1,0.75,0.25,0,0,0,0.5,0]),4,3)
  await compare('default background',new Float32Array(12),4,3,{defaultBackground:true})
  if(fixture){
    if(fixture.dtype!=='float32'||fixture.rawAlpha.length!==fixture.width*fixture.height)throw new Error('Expected a contiguous float32 diagnostic alpha plane')
    await compare(`identical ${fixture.model} alpha`,Float32Array.from(fixture.rawAlpha),fixture.width,fixture.height,{original:fixture.original,W:fixture.width*2,H:fixture.height*2})
  }
  await device.queue.onSubmittedWorkDone();device.destroy();delete window.__gpuParity
  return {rows,failures}
 },fixture)
 console.log(JSON.stringify(results,null,2))
 for(const row of results.rows){assert.equal(row.error,null,row.name);assert.ok(row.meanError<=1.5,`${row.name}: mean pixel error ${row.meanError}`);assert.ok(row.maxError<=4,`${row.name}: max pixel error ${row.maxError}`)}
 assert.deepEqual(results.failures,[])
} finally {await browser.close()}
