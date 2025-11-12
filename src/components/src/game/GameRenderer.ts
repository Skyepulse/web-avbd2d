/*
 * GameRenderer.ts
 *
 * Responsible for rendering the main game view.
 * Renders for now box-shaped rigid bodies and contact points.
 */

//================================//
import cubeVertWGSL from '../shader/cubeShader_vert.wgsl?raw';
import cubeFragWGSL from '../shader/cubeShader_frag.wgsl?raw';
import contactVertWGSL from '../shader/contact_vert.wgsl?raw';
import contactFragWGSL from '../shader/contact_frag.wgsl?raw';

//================================//
import type GameManager from "./GameManager";
import type { ContactRender } from "./Manifold";
import RigidBox from "./RigidBox";
import { RequestWebGPUDevice } from "@src/helpers/WebGPUutils";
import type { ShaderModule, TimestampQuerySet } from "@src/helpers/WebGPUutils";
import { CreateShaderModule, CreateTimestampQuerySet, ResolveTimestampQuery } from '@src/helpers/WebGPUutils';
import { createQuadVertices, createCircleVerticesTopology } from '@src/helpers/GeometryUtils';
import * as glm from 'gl-matrix';

const positionSize = 3 * 4; // 2 floats for posx posy and rotation, 4 bytes each
const scaleSize = 2 * 4;    // 2 floats, 4 bytes each
const colorSize = 1 * 4;    // 4 bytes (1 byte per channel RGBA)
const vertexSize = 2 * 4; // position
const indicesPerInstance = 6;  // 2 triangles per quad

const initialInstanceSize = 256;
const screenUniformSize = 32; // Uniform buffers should be 16-byte aligned. We store 2 floats + 2 pad floats.

// ================================== //
class GameRenderer
{
    private gameManager: GameManager | null = null;

    private canvas: HTMLCanvasElement | null = null;
    public device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private presentationFormat: GPUTextureFormat | null = null;
    private observer: ResizeObserver | null = null;

    // Rendering pipeline
    private CubesShaderModule: ShaderModule | null = null;
    private CubesPipeline: GPURenderPipeline | null = null;

    // Rendering pipeline for contacts
    private ContactShaderModule: ShaderModule | null = null;
    private ContactPipeline: GPURenderPipeline | null = null;
    private cubePipelineLayout: GPUPipelineLayout | null = null;

    // Storage buffers
    private vertexBuffer: GPUBuffer | null = null;
    private indexBuffer: GPUBuffer | null = null;
    private staticBuffer: GPUBuffer | null = null;
    private changingBuffer: GPUBuffer | null = null;

    // contact buffers
    private contactVertexBuffer: GPUBuffer | null = null;
    private contactIndexBuffer: GPUBuffer | null = null;
    private contactPositionBuffer: GPUBuffer | null = null;

    // Timestamp query
    private timestampQuerySet: TimestampQuerySet | null = null;
    private screenUniformBuffer: GPUBuffer | null = null;
    private screenBindGroup: GPUBindGroup | null = null;

    private changingCpuArray: Float32Array = new Float32Array(initialInstanceSize * (positionSize + scaleSize) / 4);
    private staticCpuArray: Uint8Array = new Uint8Array(initialInstanceSize * 4); // RGBA per instance

    // Members
    private numInstances: number = 0;
    private maxInstances: number = initialInstanceSize;
    private nextId: number = 1;
    private idToIndexMap: Map<number, number> = new Map();
    private indexToId: number[] = [];

    // Contact points
    private contactPositions: Float32Array = new Float32Array(0);
    private numContacts: number = 0;
    private maxContacts: number = 2048;
    private contactIndicesPerInstance: number = 0;

    // Static world size (matches physics world)
    static xWorldSize: number = 100;
    static yWorldSize: number = 60;

    static xWorldLimit: number = 400;
    static yWorldLimit: number = 300;

    public zoom: number = 1.0;
    public cameraOffset = { x: 0, y: 0 };

    // Texture to render with MSAA
    private msaaTexture: GPUTexture | null = null;
    private msaaView: GPUTextureView | null = null;
    private sampleCount: number = 4 ;

    public renderTimeGPU: number = 0; //ms
    public renderTimeCPU: number = 0; //ms
    // Performance averaging (compute averages every `perfIntervalMs` milliseconds)
    private perfIntervalMs: number = 1000; // ms
    private perfIntervalStart: number = performance.now();
    private perfFrameCount: number = 0;
    private perfCpuAcc: number = 0; // ms accumulator
    private perfGpuAcc: number = 0; // ms accumulator

    private initialized: boolean = false;
    public isInitialized(): boolean { return this.initialized; }

    //=============== PUBLIC =================//
    constructor(canvas: HTMLCanvasElement, gameManager: GameManager)
    {
        this.canvas = canvas;
        this.gameManager = gameManager;
    }

    //================================//
    public async initialize()
    {
        if (!this.canvas)
        {
            this.gameManager?.logWarn("No canvas provided to GameRenderer.");
            return;
        }

        this.device = await RequestWebGPUDevice(['timestamp-query']);
        if (this.device === null || this.device === undefined) 
        {
            this.gameManager?.logWarn("Was not able to acquire a WebGPU device.");
            return;
        }

        this.context = this.canvas.getContext('webgpu');
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        if (!this.context) {
            this.gameManager?.logWarn("WebGPU context is not available.");
            return;
        }

        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            alphaMode: 'premultiplied'
        });

        this.observer = new ResizeObserver(entries => {
            for (const entry of entries) {

                const width = entry.contentBoxSize[0].inlineSize;
                const height = entry.contentBoxSize[0].blockSize;

                if (this.canvas && this.device) {
                    this.canvas.width = Math.max(1, Math.min(width, this.device.limits.maxTextureDimension2D));
                    this.canvas.height = Math.max(1, Math.min(height, this.device.limits.maxTextureDimension2D));
                }

                this.createMSAATexture(); // Recreate MSAA texture on resize
            }
        });
        this.observer.observe(this.canvas);

        this.createMSAATexture();
        this.buildBuffers();
        this.initializePipeline();
        this.initializeContactPipeline();

        console.log("GameRenderer initialized with WebGPU.");
        this.initialized = true;
    }

    //================================//
    public addInstanceBox(RigidBox: RigidBox): number
    {
        return this.addInstance(RigidBox.getPosition(), RigidBox.getScale(), RigidBox.getColor());
    }

    //================================//
    public addInstance(position: glm.vec3, scale: glm.vec2, color: Uint8Array): number
    {
        if (!this.device || !this.staticBuffer || !this.changingBuffer) return -1;

        // Check if there are free slots
        let instanceIndex: number;

        if (this.numInstances >= this.maxInstances)
            this.extendBuffers();

        instanceIndex = this.numInstances++;

        this.staticCpuArray.set(color, instanceIndex * 4);
        this.device.queue.writeBuffer(this.staticBuffer, instanceIndex * colorSize, this.staticCpuArray as BufferSource, instanceIndex * 4, 4);

        const id = this.nextId++;
        this.indexToId[instanceIndex] = id;
        this.idToIndexMap.set(id, instanceIndex);

        this.updateInstancePosition(id, position as Float32Array);
        this.updateInstanceScale(id, scale as Float32Array);

        return id;
    }

    //================================//
    public removeInstance(id: number): void
    {
        if (!this.device || !this.staticBuffer || !this.changingBuffer) return;

        const instanceIndex = this.idToIndexMap.get(id);
        if (instanceIndex === undefined) return;

        const lastIndex = this.numInstances - 1;

        if (instanceIndex !== lastIndex)
        {
            // --- Swap color on CPU and re-upload --- //
            const colorSrcOffset = lastIndex * 4;
            const colorDstOffset = instanceIndex * 4;
            this.staticCpuArray.set(
                this.staticCpuArray.subarray(colorSrcOffset, colorSrcOffset + 4),
                colorDstOffset
            );
            this.device.queue.writeBuffer(
                this.staticBuffer,
                instanceIndex * colorSize,
                this.staticCpuArray as BufferSource,
                colorDstOffset,
                4
            );

            // --- Swap transform data --- //
            const a = this.changingCpuArray;
            const floatsPerInstance = (positionSize + scaleSize) / 4;
            const dstBase = instanceIndex * floatsPerInstance;
            const srcBase = lastIndex * floatsPerInstance;
            for (let k = 0; k < floatsPerInstance; k++) {
                a[dstBase + k] = a[srcBase + k];
            }

            // --- Update ID mappings --- //
            const movedId = this.indexToId[lastIndex];
            this.indexToId[instanceIndex] = movedId;
            this.idToIndexMap.set(movedId, instanceIndex);
        }

        // --- Remove last --- //
        this.idToIndexMap.delete(id);
        this.indexToId.pop();
        this.numInstances--;
    }
    
    //================================//
    public updateInstanceScale(id: number, scale: Float32Array): void
    {
        const instanceIndex = this.idToIndexMap.get(id);
        if (instanceIndex === undefined) return;

        this.changingCpuArray[instanceIndex * (positionSize + scaleSize) / 4 + 3] = scale[0];
        this.changingCpuArray[instanceIndex * (positionSize + scaleSize) / 4 + 4] = scale[1];
    }

    //================================//
    public updateInstancePosition(id: number, position: Float32Array): void
    {
        const instanceIndex = this.idToIndexMap.get(id);
        if (instanceIndex === undefined) return;

        this.changingCpuArray[instanceIndex * (positionSize + scaleSize) / 4 + 0] = position[0];
        this.changingCpuArray[instanceIndex * (positionSize + scaleSize) / 4 + 1] = position[1];
        this.changingCpuArray[instanceIndex * (positionSize + scaleSize) / 4 + 2] = position[2];
    }

    //================================//
    public updateContacts(contacts: ContactRender[]) {
        this.numContacts = Math.min(contacts.length, this.maxContacts);
        if (this.numContacts === 0) return;

        if (this.contactPositions.length < this.numContacts * 2)
            this.contactPositions = new Float32Array(this.maxContacts * 2);

        for (let i = 0; i < this.numContacts; ++i) {
            this.contactPositions[i * 2 + 0] = contacts[i].pos[0];
            this.contactPositions[i * 2 + 1] = contacts[i].pos[1];
        }

        if (this.device && this.contactPositionBuffer)
            this.device.queue.writeBuffer(this.contactPositionBuffer, 0, this.contactPositions as BufferSource);
    }

    //================================//
    public async render()
    {
        if (!this.device || !this.context || !this.presentationFormat) return;

        const startTime = performance.now();
        const textureView = this.context.getCurrentTexture().createView();
        const renderPassDescriptor: GPURenderPassDescriptor = {
            label: 'basic canvas renderPass',
            colorAttachments: [{
                view: this.msaaView as GPUTextureView,
                resolveTarget: textureView, // ← resolves the 4x MSAA buffer into the canvas
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0.3, g: 0.3, b: 0.3, a: 1 }
            }],
            ... (this.timestampQuerySet != null && {
                timestampWrites: {
                    querySet: this.timestampQuerySet.querySet,
                    beginningOfPassWriteIndex: 0,
                    endOfPassWriteIndex: 1,
                }
            }),
        };

        const encoder = this.device.createCommandEncoder({ label: 'canvas render encoder' });
        const pass = encoder.beginRenderPass(renderPassDescriptor);

        // Modify aspect Ratio in uniform buffer in case of canvas resize
        if (this.screenUniformBuffer)
        {
            const halfW = GameRenderer.xWorldSize * 0.5;
            const halfH = GameRenderer.yWorldSize * 0.5;
            const aspect = this.canvas!.width / this.canvas!.height;
            const screenData = new Float32Array([
                halfW,
                halfH,
                aspect,
                this.zoom,
                this.cameraOffset.x,
                this.cameraOffset.y,
                0, 0
            ]);
            this.device.queue.writeBuffer(this.screenUniformBuffer, 0, screenData.buffer);
        }

        if (this.CubesPipeline && this.changingBuffer)
        {
            const byteLen = this.numInstances * (positionSize + scaleSize);
            this.device.queue.writeBuffer(this.changingBuffer, 0, this.changingCpuArray.buffer, 0, byteLen);

            pass.setPipeline(this.CubesPipeline);
            pass.setVertexBuffer(0, this.vertexBuffer as GPUBuffer);
            pass.setVertexBuffer(1, this.staticBuffer as GPUBuffer);
            pass.setVertexBuffer(2, this.changingBuffer as GPUBuffer);
            pass.setIndexBuffer(this.indexBuffer as GPUBuffer, 'uint16');
            pass.setBindGroup(0, this.screenBindGroup as GPUBindGroup);
            pass.drawIndexed(indicesPerInstance, this.numInstances, 0, 0, 0);
        } else
            this.gameManager?.logWarn("CubesPipeline or changingBuffer not initialized.");

        if (this.ContactPipeline && this.contactVertexBuffer && this.contactIndexBuffer && this.contactPositionBuffer)
        {
            pass.setPipeline(this.ContactPipeline);
            pass.setVertexBuffer(0, this.contactVertexBuffer);
            pass.setVertexBuffer(1, this.contactPositionBuffer);
            pass.setIndexBuffer(this.contactIndexBuffer, "uint16");
            pass.setBindGroup(0, this.screenBindGroup!);
            pass.drawIndexed(this.contactIndicesPerInstance, this.numContacts, 0, 0, 0);
        } else
            this.gameManager?.logWarn("ContactPipeline or contact buffers not initialized.");
         
        pass.end();

        if (this.timestampQuerySet != null)
        {
            const res = ResolveTimestampQuery(this.timestampQuerySet, encoder);
            if (!res)
            {
                this.gameManager?.logWarn("Failed to resolve timestamp query.");
            }
        }

        // Submit commands (includes resolve/copy for timestamp queries)
        this.device.queue.submit([encoder.finish()]);

        // CPU-side frame time (time to prepare + submit commands)
        const endTime = performance.now();
        const cpuFrameMs = endTime - startTime;

        // GPU-side frame time (read resolved timestamp results if available)
        let gpuFrameMs = 0;
        if (this.timestampQuerySet && this.timestampQuerySet.resultBuffer) {
            try {
                // Ensure the buffer isn't being mapped or written by the GPU
                // before copying and mapping.
                if (this.timestampQuerySet.resultBuffer.mapState === "unmapped") {
                    // Copy from the GPU-resolved query buffer into the readable buffer.
                    const encoder2 = this.device.createCommandEncoder({ label: "timestamp copy encoder" });
                    encoder2.copyBufferToBuffer(
                        this.timestampQuerySet.resolveBuffer,
                        0,
                        this.timestampQuerySet.resultBuffer,
                        0,
                        this.timestampQuerySet.resultBuffer.size
                    );
                    this.device.queue.submit([encoder2.finish()]);

                    // Wait for the GPU to finish writing so we can map safely.
                    await this.timestampQuerySet.resultBuffer.mapAsync(GPUMapMode.READ);

                    const arrayBuffer = this.timestampQuerySet.resultBuffer.getMappedRange();
                    // Each timestamp is 8 bytes (uint64). Use BigUint64Array for portability.
                    const ts = new BigUint64Array(arrayBuffer.slice(0));
                    if (ts.length >= 2) {
                        const t0 = ts[0];
                        const t1 = ts[1];
                        const diffTicks = Number(t1 - t0);

                        // Convert ticks -> nanoseconds using timestampPeriod if available.
                        let timestampPeriodNs = 1; // fallback: ticks == ns
                        try {
                            const maybe =
                                (this.device as any).timestampPeriod ??
                                (this.device as any).limits?.timestampPeriod ??
                                (this.device as any).adapter?.timestampPeriod;
                            if (typeof maybe === "number" && Number.isFinite(maybe) && maybe > 0)
                                timestampPeriodNs = maybe;
                        } catch {}

                        const ns = diffTicks * timestampPeriodNs;
                        gpuFrameMs = ns / 1e6;
                    }
                    this.timestampQuerySet.resultBuffer.unmap();
                }
            } catch (e: any) {
                // Best-effort: don't block rendering on timing failures
                this.gameManager?.logWarn(`Failed to read GPU timestamps: ${e?.message ?? e}`);
            }
        }

        // Accumulate into interval stats
        this.perfFrameCount++;
        this.perfCpuAcc += cpuFrameMs;
        this.perfGpuAcc += gpuFrameMs;

        const now = performance.now();
        if (now - this.perfIntervalStart >= this.perfIntervalMs) {
            // compute averages
            const frames = Math.max(1, this.perfFrameCount);
            this.renderTimeCPU = this.perfCpuAcc / frames;
            this.renderTimeGPU = this.perfGpuAcc / frames;

            // reset accumulators
            this.perfIntervalStart = now;
            this.perfFrameCount = 0;
            this.perfCpuAcc = 0;
            this.perfGpuAcc = 0;
        }
    }

    // ================================== //
    public reset(): void {
        this.numInstances = 0;
        this.idToIndexMap.clear();
        this.indexToId = [];
        this.numContacts = 0;
        this.contactPositions = new Float32Array(0);
        this.changingCpuArray.fill(0);
        this.staticCpuArray.fill(0);
    }

    // ================================== //
    public async cleanup() {
        // Wait for GPU to finish any pending work
        if (this.device) {
            try { await this.device.queue.onSubmittedWorkDone(); } catch {}
        }

        this.numInstances = 0;
        this.idToIndexMap.clear();
        this.indexToId = [];
        this.changingCpuArray = new Float32Array(this.maxInstances * (positionSize + scaleSize) / 4);
        this.staticCpuArray = new Uint8Array(this.maxInstances * 4);
        this.numContacts = 0;
        this.contactPositions = new Float32Array(0);

        if (this.observer && this.canvas) {
            this.observer.unobserve(this.canvas);
            this.observer.disconnect();
            this.observer = null;
        }

        const destroy = (b?: GPUBuffer | null) => { try { b?.destroy(); } catch {} };
        destroy(this.vertexBuffer); this.vertexBuffer = null;
        destroy(this.indexBuffer); this.indexBuffer = null;
        destroy(this.staticBuffer); this.staticBuffer = null;
        destroy(this.changingBuffer); this.changingBuffer = null;
        destroy(this.contactVertexBuffer); this.contactVertexBuffer = null;
        destroy(this.contactIndexBuffer); this.contactIndexBuffer = null;
        destroy(this.contactPositionBuffer); this.contactPositionBuffer = null;
        destroy(this.screenUniformBuffer); this.screenUniformBuffer = null;

        try { this.msaaTexture?.destroy(); } catch {}
        this.msaaTexture = null;
        this.msaaView = null;

        this.CubesPipeline = null;
        this.ContactPipeline = null;
        this.CubesShaderModule = null;
        this.ContactShaderModule = null;
        this.cubePipelineLayout = null;
        this.timestampQuerySet = null;
    }

    // ================================== //
    public recreateContextIfNeeded() {
        if (!this.canvas || !this.device) return;

        try {
            if (!this.context) {
                this.context = this.canvas.getContext("webgpu");
            }
            if (this.context) {
                this.context.configure({
                    device: this.device,
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    alphaMode: "premultiplied"
                });
                this.createMSAATexture();
            }
        } catch (e) {
            console.warn("WebGPU context reconfiguration failed:", e);
        }
    }


    //=============== PRIVATE =================//

    private createMSAATexture() 
    {
        if (!this.device || !this.presentationFormat || !this.canvas) return;

        try { this.msaaTexture?.destroy(); } catch {} // Make sure to destroy old texture
        this.msaaTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            sampleCount: this.sampleCount,
            format: this.presentationFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.msaaView = this.msaaTexture.createView();
    }
    //================================//
    private buildBuffers()
    {
        if (!this.device || !this.canvas) return;

        const staticBufferSize = this.maxInstances * (colorSize);
        const changingBufferSize = this.maxInstances * (positionSize + scaleSize);

        // Boxes buffers
        const quadTopology = createQuadVertices();
        const vertexBufferSize = quadTopology.vertexData.byteLength;
        const indexBufferSize = quadTopology.indexData.byteLength;

        this.vertexBuffer = this.device.createBuffer({
            label: 'Quad vertex buffer',
            size: vertexBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.vertexBuffer, 0, quadTopology.vertexData as BufferSource);

        this.indexBuffer = this.device.createBuffer({
            label: 'Quad index buffer',
            size: indexBufferSize,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.indexBuffer, 0, quadTopology.indexData as BufferSource);

        // Contact buffers
        const circleTopology = createCircleVerticesTopology({ radius: 1, innerRadius: 0.01 });
        this.contactIndicesPerInstance = circleTopology.numVertices;

        this.contactVertexBuffer = this.device.createBuffer({
            label: 'Contact vertex buffer',
            size: circleTopology.vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.contactVertexBuffer, 0, circleTopology.vertexData as BufferSource);

        this.contactIndexBuffer = this.device.createBuffer({
            label: 'Contact index buffer',
            size: circleTopology.indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.contactIndexBuffer, 0, circleTopology.indexData as BufferSource);

        this.contactPositionBuffer = this.device.createBuffer({
            label: 'Contact position buffer',
            size: this.maxContacts * 2 * 4, // 2 floats (x, y) per contact
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });

        // Instance data buffers
        this.staticBuffer = this.device.createBuffer({
            label: 'Quad static instance buffer',
            size: staticBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        this.changingBuffer = this.device.createBuffer({    
            label: 'Quad changing instance buffer',
            size: changingBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        this.timestampQuerySet = CreateTimestampQuerySet(this.device, 2);

        this.screenUniformBuffer = this.device.createBuffer({
            label: 'Screen uniform buffer',
            size: screenUniformSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Write world size to uniform buffer (won't change)
        const halfW = GameRenderer.xWorldSize * 0.5;
        const halfH = GameRenderer.yWorldSize * 0.5;
        const aspect = this.canvas!.width / this.canvas!.height;
        const screenData = new Float32Array([
            halfW,
            halfH,
            aspect,
            this.zoom,
            this.cameraOffset.x,
            this.cameraOffset.y,
            0, 0
        ]);
        this.device.queue.writeBuffer(
            this.screenUniformBuffer,
            0,
            screenData.buffer
        );
    }

    //================================//
    private extendBuffers()
    {
        if (!this.device || !this.staticBuffer || !this.changingBuffer || !this.indexBuffer) return;

        this.maxInstances *= 2;

        const newStaticBufferSize = this.maxInstances * (colorSize);
        const newChangingBufferSize = this.maxInstances * (positionSize + scaleSize);

        const newStaticBuffer = this.device.createBuffer({
            label: 'Extended static instance buffer',
            size: newStaticBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        const newChangingBuffer = this.device.createBuffer({
            label: 'Extended changing instance buffer',
            size: newChangingBufferSize,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        // Copy old data to new buffers (and cpu array)
        const commandEncoder = this.device.createCommandEncoder({ label: 'Extend buffer encoder' });
        commandEncoder.copyBufferToBuffer(this.staticBuffer, 0, newStaticBuffer, 0, this.staticBuffer.size);
        this.device.queue.submit([commandEncoder.finish()]);

        const oldChangingArray = this.changingCpuArray;
        this.changingCpuArray = new Float32Array(this.maxInstances * (positionSize + scaleSize) / 4);
        this.changingCpuArray.set(oldChangingArray);

        const oldStaticArray = this.staticCpuArray;
        this.staticCpuArray = new Uint8Array(this.maxInstances * 4);
        this.staticCpuArray.set(oldStaticArray);

        this.staticBuffer.destroy();
        this.changingBuffer.destroy();

        this.staticBuffer = newStaticBuffer;
        this.changingBuffer = newChangingBuffer;
    }

    //================================//
    private initializePipeline()
    {
        if (!this.device || !this.presentationFormat) return;

        this.CubesShaderModule = CreateShaderModule(this.device, cubeVertWGSL, cubeFragWGSL, "Cubes Shader");
        if (!this.CubesShaderModule)
        {
            this.gameManager?.logWarn("Failed to create shader modules.");
            return;
        }

        const bgl0 = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                }
            ]
        });
        this.cubePipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [bgl0] });


        this.CubesPipeline = this.device.createRenderPipeline({
            label: 'Cubes Render Pipeline',
            layout: this.cubePipelineLayout,
            vertex: {
                module: this.CubesShaderModule.vertex,
                entryPoint: 'vs',
                buffers: [
                    {
                        arrayStride: vertexSize,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' } // Vertex position
                        ]
                    },
                    {
                        arrayStride: colorSize,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 1, offset: 0, format: 'unorm8x4' } // Instance color
                        ]
                    },
                    {
                        arrayStride: positionSize + scaleSize,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 2, offset: 0, format: 'float32x3' }, // Instance position (x,y,rotation)
                            { shaderLocation: 3, offset: positionSize, format: 'float32x2' }  // Instance scale
                        ]
                    }
                ]
            },
            fragment: {
                module: this.CubesShaderModule.fragment,
                entryPoint: 'fs',
                targets: [
                    {
                        format: this.presentationFormat
                    }
                ]
            },
            multisample: { count: this.sampleCount },
        });

        if (!this.device || !this.screenUniformBuffer) return;

        this.screenBindGroup = this.device.createBindGroup({
            label: 'Screen uniform bind group',
            layout: bgl0,
            entries: [
                { binding: 0, resource: { buffer: this.screenUniformBuffer } }
            ]
        });
    }

    //================================//
    private initializeContactPipeline()
    {
        if (!this.device || !this.presentationFormat || !this.cubePipelineLayout) return;

        this.ContactShaderModule = CreateShaderModule(this.device, contactVertWGSL, contactFragWGSL, "Contact Shader");
        if (!this.ContactShaderModule)
        {
            this.gameManager?.logWarn("Failed to create contact shader modules.");
            return;
        }

        this.ContactPipeline = this.device.createRenderPipeline({
            label: "Contacts Render Pipeline",
            layout: this.cubePipelineLayout,
            vertex: {
                module: this.ContactShaderModule.vertex,
                entryPoint: "vs",
                buffers: [
                    {
                        arrayStride: 8, // 2 floats (x,y)
                        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
                    },
                    {
                        arrayStride: 8, // 2 floats per instance position (x,y)
                        stepMode: "instance",
                        attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
                    },
                ],
            },
            fragment: {
                module: this.ContactShaderModule.fragment,
                entryPoint: "fs",
                targets: [{ format: this.presentationFormat }],
            },
            primitive: { topology: "triangle-list" },
            multisample: { count: this.sampleCount },
        });
    }
}

//================================//
export default GameRenderer;