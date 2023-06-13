precision highp float;

uniform sampler2D u_previewTexture;
uniform vec4 u_zoom;

in vec2 texCoord;

out vec4 g_finalColor;

void main()
{
    float left = u_zoom.x;
    float right = u_zoom.y;
    float top = u_zoom.z;
    float bottom = u_zoom.w;

    float u =  (right - left) * texCoord.x + left;
    float v =  (top - bottom) * texCoord.y + bottom;

    vec4 color = texture(u_previewTexture, vec2(u,v));
    //vec4 color = texture(u_previewTexture, texCoord);

    g_finalColor = color;
}
