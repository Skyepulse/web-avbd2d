// ============================== //
struct OurVertexShaderOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective) color: vec4f,
    @location(1) @interpolate(perspective) localPos: vec2f,
    @location(2) @interpolate(perspective) scale: vec2f,
    @location(3) @interpolate(perspective) rotation: f32,
};

// ============================== //
@fragment
fn fs(input: OurVertexShaderOutput) -> @location(0) vec4f
{
    // Compute SDF to get the border of the rectangle.
    let halfExtents : vec2f = input.scale * 0.5;
    let rotation : f32 = input.rotation;

    let c: f32 = cos(rotation);
    let s: f32 = sin(rotation);

    let unrotX: f32 = input.localPos.x * c + input.localPos.y * s;
    let unrotY: f32 = -input.localPos.x * s + input.localPos.y * c;
    let absDist : vec2f = abs(vec2f(unrotX, unrotY));
    let distanceToEdge : f32 = min(halfExtents.x - absDist.x, halfExtents.y - absDist.y);

    // Border thickness (in same units as scale/world-space). Adjust as needed.
    let borderThickness : f32 = 0.1;

    let borderColor : vec4f = vec4f(0.0, 0.0, 0.0, 1.0);
    let fillColor : vec4f = input.color;

    // Hard switch: inside (distance >= borderThickness) -> fill, otherwise border
    if (distanceToEdge >= borderThickness) {
        return fillColor;
    } else {
        return borderColor;
    }
}