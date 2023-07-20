precision highp float;

uniform sampler2D u_previewTexture;
uniform vec4 u_zoom;
uniform bool u_linearColor;
uniform float u_aspectRatio;

in vec2 texCoord;

out vec4 g_finalColor;

const float GAMMA = 2.2;
const float INV_GAMMA = 1.0 / GAMMA;

// linear to sRGB approximation
// see http://chilliant.blogspot.com/2012/08/srgb-approximations-for-hlsl.html
vec3 linearTosRGB(vec3 color)
{
    return pow(color, vec3(INV_GAMMA));
}

void main()
{
    float left = u_zoom.x;
    float right = u_zoom.y;
    float top = u_zoom.z;
    float bottom = u_zoom.w;

    float u =  (right - left) * texCoord.x + left;
    float v =  (top - bottom) * texCoord.y + bottom;
    v = 1.0 - v;
    if(u_aspectRatio >= 1.0)
        u *= u_aspectRatio;
    else
        v /= u_aspectRatio;

    vec4 color = texture(u_previewTexture, vec2(u,v));
    //vec4 color = texture(u_previewTexture, texCoord);
    
    if(u_linearColor)
    {
        g_finalColor = color;
    }
    else
    {
        g_finalColor = vec4(linearTosRGB(color.rgb), color.a);
    }  

    if(u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0)
    {
        g_finalColor = vec4(0,0,0,1);
    }
}
