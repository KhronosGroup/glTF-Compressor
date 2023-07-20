import { gltfTextureInfo } from "./../gltf/texture.js"
import {ImageType} from "./../gltf/image_type.js"


class ImagePreviewRenderer
{
    constructor(webgl)
    {
        const gl = webgl.context;

        this.sampler = gl.createSampler();
        gl.bindSampler(0, this.sampler);
        gl.samplerParameteri(this.sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.samplerParameteri(this.sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.samplerParameteri(this.sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.samplerParameteri(this.sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindSampler(0, null);
    }

    drawImagePreview(webGl, previewTexture, state, shaderCache, fragDefines)
    {
        if (previewTexture == -1)
        {
            return;
        }
        const aspectRatio = state._view.context.drawingBufferWidth / state._view.context.drawingBufferHeight;

        const gl = webGl.context;

        const vertShader = shaderCache.selectShader("fullscreen.vert", []);
        const fragShader = shaderCache.selectShader("preview.frag", []);
        const shader = shaderCache.getShaderProgram(vertShader, fragShader);

        gl.useProgram(shader.program);

        const zoomUniform = gl.getUniformLocation(shader.program,"u_zoom");
        gl.uniform4f(zoomUniform, state.compressorParameters.previewTextureZoom.left, state.compressorParameters.previewTextureZoom.right, state.compressorParameters.previewTextureZoom.top, state.compressorParameters.previewTextureZoom.bottom)

        // get uniform location
        const location = gl.getUniformLocation(shader.program,"u_previewTexture");
        const image = state.gltf.images[state.gltf.textures[previewTexture].source];
        const info = new gltfTextureInfo(previewTexture, 0, image.imageType !== ImageType.COLOR);

        if (location < 0)
        {
            console.log("Unable to find uniform location of "+info.samplerName);
            return; // only skip this texture
        }
        if (!webGl.setTexture(location, state.gltf, info, 0, state.compressorParameters.previewCompressed)) // binds texture and sampler
        {
            return; // skip this material
        }
        gl.bindSampler(0, this.sampler);

        const linearColor_loc = gl.getUniformLocation(shader.program,"u_linearColor");
        gl.uniform1i(linearColor_loc, info.linear);
        const aspectRatio_loc = gl.getUniformLocation(shader.program,"u_aspectRatio");
        gl.uniform1f(aspectRatio_loc, aspectRatio);

        // fullscreen triangle
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // unbind the texture
        gl.bindTexture(gl.TEXTURE_2D, null);

        // unbind the program
        gl.useProgram(null);
        gl.bindSampler(0, null);
    }
}

export { ImagePreviewRenderer }
