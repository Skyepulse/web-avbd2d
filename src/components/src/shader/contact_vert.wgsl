// ============================== //
struct ScreenInfo {
    halfWorldSize : vec2f,
    aspectRatio : f32,
    zoom : f32,
    cameraOffset : vec2f,
    _pad : vec2f,
};

// ============================== //
@group(0) @binding(0) var<uniform> uScreen : ScreenInfo;

// ============================== //
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec3<f32>,
};

// ============================== //
@vertex
fn vs(
    @location(0) position : vec2<f32>,
    @location(1) instancePos : vec2<f32>
) -> VSOut {
    var out : VSOut;

    let radius = 0.25;
    var world = instancePos + position * radius;
    world = (world - uScreen.cameraOffset) * uScreen.zoom;

    let worldAspect = uScreen.halfWorldSize.x / uScreen.halfWorldSize.y;
    let ndcX = (world.x / uScreen.halfWorldSize.x) * (worldAspect / uScreen.aspectRatio);
    let ndcY =  world.y / uScreen.halfWorldSize.y;

    out.position = vec4<f32>(ndcX, ndcY, 0.0, 1.0);
    out.color = vec3<f32>(1.0, 0.0, 0.0);
    return out;
}
