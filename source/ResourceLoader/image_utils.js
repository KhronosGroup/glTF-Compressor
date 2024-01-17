
class ImageUtils
{
    static base64( buffer ) {
        if (typeof(buffer) === "string") return window.btoa( buffer );

        var binary = '';
        const bytes = new Uint8Array( buffer );
        const len = bytes.byteLength;
        for (var i = 0; i < len; i++) {
            binary += String.fromCharCode( bytes[ i ] );
        }
        
        return window.btoa( binary );
    }

    static async loadImageData (img, flip = false) {
        const canvas    = document.createElement("canvas");
        const context   = canvas.getContext("2d", { colorSpace: "srgb" });
        canvas.height = img.height;
        canvas.width  = img.width;
                  
        if (flip) {
          context.translate(0, img.height);
          context.scale(1, -1);
        }
        context.drawImage(img, 0, 0, img.width, img.height);
        
        const rgba = context.getImageData(0, 0, img.width, img.height, { colorSpace: "srgb" });
        return rgba.data;
    };

    static async loadImageDataGL (texture, width, height, gl, isSRGB) {
        const g_readback_vertex_shader = `#version 300 es
            precision highp float;
            out vec2 uv;
            void main(void) {
                float x = float((gl_VertexID & 1) << 2);
                float y = float((gl_VertexID & 2) << 1);
                uv = vec2(x * 0.5, y * 0.5);
                gl_Position = vec4(x - 1.0, y - 1.0, 0, 1);
            }`;
         const g_readback_fragment_shader = `#version 300 es
            precision mediump float;
            layout(location = 0) out vec4 out_color;
            in highp vec2 uv;
            uniform sampler2D u_TextureSampler;
            void main() {    
                out_color = texture(u_TextureSampler, uv);
            }`;
        const vshader = gl.createShader( gl.VERTEX_SHADER );
        gl.shaderSource( vshader, g_readback_vertex_shader );
        gl.compileShader( vshader );
        const fshader = gl.createShader( gl.FRAGMENT_SHADER );
        gl.shaderSource( fshader, g_readback_fragment_shader );
        gl.compileShader( fshader );
        const program = gl.createProgram();

        gl.attachShader(program, vshader);
        gl.attachShader(program, fshader);
        gl.linkProgram(program); 
        
        gl.detachShader(program, vshader);
        gl.detachShader(program, fshader);
        gl.deleteShader(vshader); 
        gl.deleteShader(fshader);

        const texture_src = texture;
        const texture_dst = gl.createTexture();
        const vao = gl.createVertexArray();
        
        while(gl.getError());
        gl.bindTexture(gl.TEXTURE_2D, texture_dst);
        gl.texStorage2D(gl.TEXTURE_2D, 1, isSRGB? gl.SRGB8_ALPHA8 : gl.RGBA8, width, height); 
        
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture_dst, 0);
        
        const texture_loc = gl.getUniformLocation(program, "u_TextureSampler");
        const pixels = new Uint8ClampedArray(width * height * 4);
        
        gl.viewport(0, 0, width, height);

        gl.useProgram(program);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture_src);    
        gl.uniform1i(texture_loc, 0);
        
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
    };

    static downloadBinaryFile(filename, data) {
        const element = document.createElement('a');
        element.setAttribute('href', 'data:application/octet-stream;base64,' + this.base64(data));
        element.setAttribute('download', filename);

        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();

        document.body.removeChild(element);
    }

    static async ImageDataToImg(image_data, img)
    {
        const canvas    = document.createElement("canvas");
        const context   = canvas.getContext("2d");
        canvas.height = image_data.height;
        canvas.width  = image_data.width;
        context.putImageData(image_data, 0, 0);
        canvas.toBlob(
            (blob) => {
                const url = URL.createObjectURL(blob);
                      
                img.onload = () => {
                    URL.revokeObjectURL(url); // clean up this blob
                };                      
                img.src = url;
            },
            "image/jpeg",
             0.8
        );
    }
}

export { ImageUtils };
