// ============================== //
struct vertexStruct {
    @location(0) position: vec2f,
    @location(1) color: vec4f,
    @location(2) worldPos: vec3f,
    @location(3) scale: vec2f,
};

// ============================== //
struct OurVertexShaderOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective) color: vec4f,
    @location(1) @interpolate(perspective) localPos: vec2f,
    @location(2) @interpolate(perspective) scale: vec2f,
    @location(3) @interpolate(perspective) rotation: f32,
};

// ============================== //
struct ScreenInfo {
    halfWorldSize : vec2f,
    aspectRatio : f32,
    zoom : f32,
    cameraOffset : vec2f,
    _pad : vec2f,
};

@group(0) @binding(0)
var<uniform> uScreen : ScreenInfo;

// ============================== //
@vertex
fn vs(
    vert: vertexStruct,
) -> OurVertexShaderOutput {
    var out: OurVertexShaderOutput;

    let rotation: f32 = vert.worldPos.z;
    let cosR: f32 = cos(rotation);
    let sinR: f32 = sin(rotation);

    let scaledPos: vec2f = vert.position * vert.scale;
    let rotatedX: f32 = scaledPos.x * cosR - scaledPos.y * sinR;
    let rotatedY: f32 = scaledPos.x * sinR + scaledPos.y * cosR;
    let worldRotated: vec2f = vert.worldPos.xy + vec2f(rotatedX, rotatedY);

    let worldView: vec2f = (worldRotated - uScreen.cameraOffset) * uScreen.zoom;

    let worldAspect = uScreen.halfWorldSize.x / uScreen.halfWorldSize.y;
    let ndcX = (worldView.x / uScreen.halfWorldSize.x) * (worldAspect / uScreen.aspectRatio);
    let ndcY =  worldView.y / uScreen.halfWorldSize.y;

    out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
    out.color = vert.color;
    out.localPos = vec2f(rotatedX, rotatedY);
    out.scale = vert.scale;
    out.rotation = rotation;
    return out;
}
