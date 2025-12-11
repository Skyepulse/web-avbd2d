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
struct LineInfo
{
    @location(0) position: vec2f, // vertex buffer local position
    @location(1) pA: vec2f,       // world space endpoint A
    @location(2) pB: vec2f,       // world space endpoint B
    @location(3) size: f32,       // thickness of the line
};

// ============================== //
struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) color : vec3<f32>,
};

// ============================== //
@vertex
fn vs(
    lineInfo : LineInfo
) -> VSOut {
    var out: VSOut;

    // posA and posB are the world space given enpoints, size the desired thickness of the quad.
    // The vertex buffer provides a local-space position in [-0.5, 0.5]x[-0.5, 0.5] to define the quad.

    let dir = normalize(lineInfo.pB - lineInfo.pA);
    let normal = vec2f(-dir.y, dir.x);
    let halfSize = lineInfo.size * 0.5;

    let worldPos = mix(lineInfo.pA, lineInfo.pB, lineInfo.position.y + 0.5) + normal * lineInfo.position.x * halfSize;
    let worldView: vec2f = (worldPos - uScreen.cameraOffset) * uScreen.zoom;

    let worldAspect = uScreen.halfWorldSize.x / uScreen.halfWorldSize.y;
    let ndcX = (worldView.x / uScreen.halfWorldSize.x) * (worldAspect / uScreen.aspectRatio);
    let ndcY =  worldView.y / uScreen.halfWorldSize.y;

    var color: vec3f = vec3f(1.0, 1.0, 1.0);
    if (lineInfo.size >= 0.5) 
    {
        color = vec3f(1.0, 1.0, 0.0);
    } 
    else if (lineInfo.size >= 0.4)
    {
        color = vec3f(0.0, 0.0, 1.0);
    }
    else 
    {
        color = vec3f(0.0, 1.0, 0.0);
    }
    out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
    out.color = color;
    return out;
}
