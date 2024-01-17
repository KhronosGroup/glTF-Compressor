import { GltfObject } from './gltf_object.js';
import { isPowerOf2 } from './math_utils.js';
import { getExtension } from './utils.js';
import { AsyncFileReader } from '../ResourceLoader/async_file_reader.js';
import { GL } from "../Renderer/webgl";
import { ImageMimeType } from "./image_mime_type.js";
import { ImageType } from "./image_type.js";
import { ImageUtils } from '../ResourceLoader/image_utils.js';
import * as jpeg  from "jpeg-js";
import * as png from 'fast-png';

class gltfImage extends GltfObject
{
    constructor(
        uri = undefined,
        type = GL.TEXTURE_2D,
        miplevel = 0,
        bufferView = undefined,
        name = undefined,
        mimeType = undefined,
        image = undefined)
    {
        super();
        this.uri = uri;
        this.bufferView = bufferView;
        this.mimeType = mimeType;
        this.image = image; // javascript image
        this.name = name;
        this.type = type; // nonstandard
        this.miplevel = miplevel; // nonstandard

        // GSV-KTX (non gltf)
        this.fileSize = 0;
        this.gpuSize = 0;
        this.gpuFormat = "RGBA8888";
        this.thumbnail = undefined;
        this.imageType = ImageType.COLOR;
        this.imageUsage = new Set();
        this.compressedFileSize = 0;
        this.compressedGpuSize = 0;        
        this.compressedGpuFormat = "RGBA8888";
        this.compressedMimeType = mimeType;
        this.compressedImage = undefined;
        //this.compressedImageBlob = undefined;
        this.compressedImageTypedArrayBuffer = undefined;
        this.compressedImageNeedUpdate = true;
        this.compressedTextureNeedUpdate = true;
        //TODO: Maybe we need to handle width, height
    }

    resolveRelativePath(basePath)
    {
        if (typeof this.uri === 'string' || this.uri instanceof String) {
            if (this.uri.startsWith('./')) {
                this.uri = this.uri.substring(2);
            }
            this.uri = basePath + this.uri;
        }
    }

    async load(gltf, additionalFiles = undefined)
    {
        if (this.image !== undefined)
        {
            if (this.mimeType !== ImageMimeType.GLTEXTURE)
            {
                console.error("image has already been loaded");
            }
            return;
        }

        if (!await this.setImageFromBufferView(gltf) &&
            !await this.setImageFromFiles(gltf, additionalFiles) &&
            !await this.setImageFromUri(gltf))
        {
            return;
        }

        return;
    }

    static loadHTMLImage(url)
    {
        return new Promise( (resolve, reject) => {
            const image = new Image();
            image.addEventListener('load', () => resolve(image) );
            image.addEventListener('error', reject);
            image.src = url;
            image.crossOrigin = "";
        });
    }

    setMimetypeFromFilename(filename)
    {

        let extension = getExtension(filename)
        if(extension == "ktx2" || extension == "ktx")
        {
            this.mimeType = ImageMimeType.KTX2;
        } 
        else if(extension == "jpg" || extension == "jpeg")
        {
            this.mimeType = ImageMimeType.JPEG;
        }
        else if(extension == "png" )
        {
            this.mimeType = ImageMimeType.PNG;
        } 
        else 
        {
            console.warn("MimeType not defined");
            // assume jpeg encoding as best guess
            this.mimeType = ImageMimeType.JPEG; 
        }
    
    }

    async setImageFromUri(gltf)
    {
        if (this.uri === undefined)
        {
            return false;
        }
        
        if (this.mimeType === undefined)
        {
            this.setMimetypeFromFilename(this.uri);
        }
        
        this.compressedMimeType = this.mimeType;

        if(this.mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxDecoder !== undefined)
            {
                const array = await fetch(this.uri).then(res => res.arrayBuffer()).catch(console.error);
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(new Uint8Array(array));
                this.fileSize = array.byteLength;
                this.gpuSize = this.image.gpuSize;
                this.gpuFormat = this.image.gpuFormat;

                // Compressed image (just a copy of original)
                this.compressedMimeType = ImageMimeType.KTX2;
                this.compressedImage = await gltf.ktxDecoder.loadKtxFromBuffer(new Uint8Array(array));
                this.compressedImageTypedArrayBuffer = new Uint8Array(array);
                this.compressedFileSize = this.fileSize;
                this.compressedGpuSize = this.compressedImage.gpuSize;
                this.compressedGpuFormat = this.compressedImage.gpuFormat;
                this.compressedTextureNeedUpdate = true;

                // thumbnail
                const gl = GL;
                const aspect_ratio = this.image.width / this.image.height;
                const downscaled_width = Math.min(this.image.width, 98 * aspect_ratio);
                const downscaled_height = Math.min(this.image.height, 98);
                const raw_data = await ImageUtils.loadImageDataGL(this.image, downscaled_width, downscaled_height, gl, this.image.isSRGB);
                const image_data = new ImageData(raw_data, downscaled_width, downscaled_height);
                const canvas    = document.createElement("canvas");
                const context   = canvas.getContext("2d");
                canvas.height = downscaled_height;
                canvas.width  = downscaled_width;
                context.putImageData(image_data, 0, 0);
                this.thumbnail = new Image(downscaled_width, downscaled_height);
                canvas.toBlob(
                    (blob) => {
                        const url = URL.createObjectURL(blob);
                      
                        this.thumbnail.onload = () => {
                          URL.revokeObjectURL(url); // clean up this blob
                        };                      
                        this.thumbnail.src = url;
                    },
                    "image/jpeg",
                    0.8
                );
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxDecoder not initalized');
            }
        }
        else if (typeof(Image) !== 'undefined' && (this.mimeType === ImageMimeType.JPEG || this.mimeType === ImageMimeType.PNG || this.mimeType === ImageMimeType.WEBP))
        {
            const response = await fetch(this.uri);
            const blob = await response.blob();
            this.mimeType = blob.type;
            this.fileSize = blob.size;
            const objectURL = URL.createObjectURL(blob);
            this.image = await gltfImage.loadHTMLImage(objectURL).catch( (error) => {
                console.error(error);
            });
            this.gpuSize = this.image.width * this.image.height * 4;
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            // Compressed image (just a copy of original)
            this.compressedMimeType = this.mimeType;
            this.compressedImage = await gltfImage.loadHTMLImage(objectURL).catch( (error) => {
                console.error(error);
            });
            this.compressedImageTypedArrayBuffer = new Uint8Array(await blob.arrayBuffer());
            this.compressedFileSize = this.fileSize;
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedTextureNeedUpdate = true;

            // thumbnail
            this.thumbnail = await gltfImage.loadHTMLImage(objectURL).catch( (error) => {
                console.error(error);
            });

            //URL.revokeObjectURL(objectURL);
        }
        else if(this.mimeType === ImageMimeType.JPEG && this.uri instanceof ArrayBuffer)
        {
            this.image = jpeg.decode(this.uri, {useTArray: true});
            this.fileSize = this.uri.byteLength;
            this.gpuSize = this.image.width * this.image.height * 4;
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            // compressed image
            this.compressedImage = {width: this.image.width, height: this.image.height, data: new Uint8Array(this.image.data)};
            this.compressedImageTypedArrayBuffer = new Uint8Array(this.uri);
            this.compressedFileSize = this.fileSize;
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedTextureNeedUpdate = true;

            // thumbnail
            const image_data = new ImageData(this.image.data, this.image.width, this.image.height);
            this.thumbnail = new Image(this.image.width, this.image.height);
            ImageUtils.ImageDataToImg(image_data, this.thumbnail);
        }
        else if(this.mimeType === ImageMimeType.PNG && this.uri instanceof ArrayBuffer)
        {
            this.image = png.decode(this.uri);
            this.fileSize = this.uri.byteLength;
            this.gpuSize = this.image.width * this.image.height * 4; // images are stored as RGBA in GPU
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            // compressed image
            this.compressedImage = {
                width: this.image.width, 
                height: this.image.height, 
                data: this.image.data.constructor === Uint8Array ? new Uint8Array(this.image.data) : this.image.data.constructor === Uint8ClampedArray? new Uint8ClampedArray(this.image.data) : new Uint16Array(this.image.data),
                depth: this.image.depth,
                channels: this.image.channels
            };
            this.compressedImageTypedArrayBuffer = new Uint8Array(this.uri);
            this.compressedFileSize = this.fileSize;
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedTextureNeedUpdate = true;

            // thumbnail
            const image_data = new ImageData(this.image.data, this.image.width, this.image.height);
            this.thumbnail = new Image(this.image.width, this.image.height);
            ImageUtils.ImageDataToImg(image_data, this.thumbnail);
        }
        else if(this.mimeType === ImageMimeType.WEBP && this.uri instanceof ArrayBuffer)
        {
            if (gltf.webpLibrary !== undefined)
            {
                const array = (this.uri instanceof ArrayBuffer)? this.uri : await fetch(this.uri).then(res => res.arrayBuffer()).catch(console.error);
                this.image = await gltf.webpLibrary.decode(array);
                this.fileSize = array.byteLength;
                this.gpuSize = this.image.width * this.image.height * 4;
                this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
                this.gpuFormat = "RGBA8888";

                // Compressed image (just a copy of original)
                this.compressedMimeType = ImageMimeType.WEBP;
                this.compressedImage = await gltf.webpLibrary.decode(array);
                this.compressedImageTypedArrayBuffer = new Uint8Array(array);
                this.compressedFileSize = this.fileSize;
                this.compressedGpuSize = this.gpuSize;
                this.compressedGpuFormat = this.gpuFormat;
                this.compressedTextureNeedUpdate = true;

                // thumbnail
                const image_data = new ImageData(this.image.data, this.image.width, this.image.height);
                this.thumbnail = new Image(this.image.width, this.image.height);
                ImageUtils.ImageDataToImg(image_data, this.thumbnail);
            }
            else
            {
                console.warn('Loading of webp images failed: webpLibrary not initalized');
            }

        }
        else
        {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }

    async setImageFromBufferView(gltf)
    {
        const view = gltf.bufferViews[this.bufferView];
        if (view === undefined)
        {
            return false;
        }

        console.log("Load image: " + this.mimeType);

        const buffer = gltf.buffers[view.buffer].buffer;
        const array = new Uint8Array(buffer, view.byteOffset, view.byteLength);
        this.fileSize = view.byteLength;
        this.compressedFileSize = this.fileSize;
        this.compressedMimeType = this.mimeType;
        if (this.mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxDecoder !== undefined)
            {
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(array);
                this.fileSize = array.byteLength;
                this.gpuSize = this.image.gpuSize;
                this.gpuFormat = this.image.gpuFormat;

                // Compressed image (just a copy of original)
                this.compressedMimeType = ImageMimeType.KTX2;
                this.compressedImage = await gltf.ktxDecoder.loadKtxFromBuffer(array);
                this.compressedImageTypedArrayBuffer = array;
                this.compressedFileSize = this.fileSize;
                this.compressedGpuSize = this.compressedImage.gpuSize;
                this.compressedGpuFormat = this.compressedImage.gpuFormat;
                this.compressedTextureNeedUpdate = true;

                // thumbnail
                const gl = GL;
                const aspect_ratio = this.image.width / this.image.height;
                const downscaled_width = Math.min(this.image.width, 98 * aspect_ratio);
                const downscaled_height = Math.min(this.image.height, 98);
                const raw_data = await ImageUtils.loadImageDataGL(this.image, downscaled_width, downscaled_height, gl, this.image.isSRGB);
                const image_data = new ImageData(raw_data, downscaled_width, downscaled_height);
                const canvas    = document.createElement("canvas");
                const context   = canvas.getContext("2d");
                canvas.height = downscaled_height;
                canvas.width  = downscaled_width;
                context.putImageData(image_data, 0, 0);
                this.thumbnail = new Image(downscaled_width, downscaled_height);
                canvas.toBlob(
                    (blob) => {
                        const url = URL.createObjectURL(blob);
                      
                        this.thumbnail.onload = () => {
                          URL.revokeObjectURL(url); // clean up this blob
                        };                      
                        this.thumbnail.src = url;
                    },
                    "image/jpeg",
                    0.8
                );
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxDecoder not initalized');
            }
        }
        else if(typeof(Image) !== 'undefined' && (this.mimeType === ImageMimeType.JPEG || this.mimeType === ImageMimeType.PNG || this.mimeType === ImageMimeType.WEBP))
        {
            const blob = new Blob([array], { "type": this.mimeType });
            const objectURL = URL.createObjectURL(blob);
            this.image = await gltfImage.loadHTMLImage(objectURL).catch( () => {
                console.error("Could not load image from buffer view");
            });
            this.gpuSize = this.image.width * this.image.height * 4;
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            // Compressed image (just a copy of original)
            this.compressedImage = await gltfImage.loadHTMLImage(objectURL).catch( (error) => {
                console.error(error);
            });         
            this.compressedImageTypedArrayBuffer = new Uint8Array(array);   
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedTextureNeedUpdate = true;

            // thumbnail
            this.thumbnail = await gltfImage.loadHTMLImage(objectURL).catch( (error) => {
                console.error(error);
            });

            //URL.revokeObjectURL(objectURL);
        }
        else if(this.mimeType === ImageMimeType.JPEG)
        {
            this.image = jpeg.decode(array, {useTArray: true});
            this.gpuSize = this.image.width * this.image.height * 4;
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            // compressed image
            this.compressedImage = {width: this.image.width, height: this.image.height, data: new Uint8Array(this.image.data)};
            this.compressedImageTypedArrayBuffer = new Uint8Array(array);
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedTextureNeedUpdate = true;

            // thumbnail
            const image_data = new ImageData(new Uint8Array(this.image.data), this.image.width, this.image.height);
            this.thumbnail = new Image(this.image.width, this.image.height);
            ImageUtils.ImageDataToImg(image_data, this.thumbnail);
        }
        else if(this.mimeType === ImageMimeType.PNG)
        {
            this.image = png.decode(array);
            this.gpuSize = this.image.width * this.image.height * 4;
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            // compressed image
            this.compressedImage = {
                width: this.image.width, 
                height: this.image.height, 
                data: this.image.data.constructor === Uint8Array ? new Uint8Array(this.image.data) : this.image.data.constructor === Uint8ClampedArray? new Uint8ClampedArray(this.image.data) : new Uint16Array(this.image.data),
                depth: this.image.depth,
                channels: this.image.channels
            };
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedImageTypedArrayBuffer = new Uint8Array(array);
            this.compressedTextureNeedUpdate = true;

            // thumbnail
            const image_data = new ImageData(this.compressedImage.data, this.image.width, this.image.height);
            this.thumbnail = new Image(this.image.width, this.image.height);
            ImageUtils.ImageDataToImg(image_data, this.thumbnail);
        }
        else if (this.mimeType === ImageMimeType.WEBP)
        {
            if (gltf.webpLibrary !== undefined)
            {
                this.image = await gltf.webpLibrary.decode(array);
                this.fileSize = array.byteLength;
                this.gpuSize = this.image.width * this.image.height * 4;
                this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
                this.gpuFormat = "RGBA8888";

                // Compressed image (just a copy of original)
                this.compressedMimeType = ImageMimeType.WEBP;
                this.compressedImage = await gltf.webpLibrary.decode(array);
                this.compressedImageTypedArrayBuffer = new Uint8Array(array);
                this.compressedFileSize = this.fileSize;
                this.compressedGpuSize = this.gpuSize;
                this.compressedGpuFormat = this.gpuFormat;
                this.compressedTextureNeedUpdate = true;

                // thumbnail
                const image_data = new ImageData(this.image.data, this.image.width, this.image.height);
                this.thumbnail = new Image(this.image.width, this.image.height);
                ImageUtils.ImageDataToImg(image_data, this.thumbnail);
            }
            else
            {
                console.warn('Loading of webp images failed: webpLibrary not initalized');
            }
        }
        else
        {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }

        return true;
    }

    base64ToArrayBuffer(base64) {
        var binaryString = atob(base64);
        var bytes = new Uint8Array(binaryString.length);
        for (var i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    async setImageFromFiles(gltf, files)
    {
        if (this.uri === undefined || files === undefined)
        {
            return false;
        }

        let foundFile = files.find(file => {
            if (file[0] == "/" + this.uri) {
                return true;
            }
        });

        if (foundFile === undefined)
        {
            return false;
        }
        
        this.fileSize = foundFile.size;

        if (this.mimeType === undefined)
        {
            this.setMimetypeFromFilename(foundFile[0]);
        }

        this.compressedMimeType = this.mimeType;

        if(this.mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxDecoder !== undefined)
            {
                const data = new Uint8Array(await foundFile[1].arrayBuffer());
                this.image = await gltf.ktxDecoder.loadKtxFromBuffer(data);
                this.fileSize = data.byteLength;
                this.gpuSize = this.image.gpuSize;
                this.gpuFormat = this.image.gpuFormat;

                // Compressed image (just a copy of original)
                this.compressedImage = await gltf.ktxDecoder.loadKtxFromBuffer(data);
                this.compressedImageTypedArrayBuffer = data;
                this.compressedFileSize = this.fileSize;
                this.compressedGpuSize = this.compressedImage.gpuSize;
                this.compressedGpuFormat = this.compressedImage.gpuFormat;
                this.compressedTextureNeedUpdate = true;

                // thumbnail
                const gl = GL;
                const aspect_ratio = this.image.width / this.image.height;
                const downscaled_width = Math.min(this.image.width, 98 * aspect_ratio);
                const downscaled_height = Math.min(this.image.height, 98);
                const raw_data = await ImageUtils.loadImageDataGL(this.image, downscaled_width, downscaled_height, gl, this.image.isSRGB);
                const image_data = new ImageData(raw_data, downscaled_width, downscaled_height);
                const canvas    = document.createElement("canvas");
                const context   = canvas.getContext("2d");
                canvas.height = downscaled_height;
                canvas.width  = downscaled_width;
                context.putImageData(image_data, 0, 0);
                this.thumbnail = new Image(downscaled_width, downscaled_height);
                canvas.toBlob(
                    (blob) => {
                        const url = URL.createObjectURL(blob);
                      
                        this.thumbnail.onload = () => {
                          URL.revokeObjectURL(url); // clean up this blob
                        };                      
                        this.thumbnail.src = url;
                    },
                    "image/jpeg",
                    0.8
                );
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxDecoder not initalized');
            }
        }
        else if (typeof(Image) !== 'undefined' && (this.mimeType === ImageMimeType.JPEG || this.mimeType === ImageMimeType.PNG))
        {
            const imageData = await AsyncFileReader.readAsDataURL(foundFile[1]).catch( () => {
                console.error("Could not load image with FileReader");
            });
            this.image = await gltfImage.loadHTMLImage(imageData).catch( () => {
                console.error("Could not create image from FileReader image data");
            });
            this.gpuSize = this.image.width * this.image.height * 4;
            this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
            this.gpuFormat = "RGBA8888";

            const blob = new Blob([imageData], { "type": this.mimeType });
            // Compressed image (just a copy of original)
            this.compressedImage = await gltfImage.loadHTMLImage(imageData).catch( (error) => {
                console.error(error);
            });         
            this.compressedImageTypedArrayBuffer = new Uint8Array(await blob.arrayBuffer());  
            this.compressedGpuSize = this.gpuSize;
            this.compressedGpuFormat = this.gpuFormat;
            this.compressedTextureNeedUpdate = true;
            const str = new TextDecoder().decode(this.compressedImageTypedArrayBuffer);
            const blobText = await blob.text();
            const originalImageBase64 = blobText.substring(blobText.indexOf(",") + 1);
            this.originalImageTypedArrayBuffer = this.base64ToArrayBuffer(originalImageBase64);  
            this.fileSize = this.originalImageTypedArrayBuffer.byteLength;

            // thumbnail
            this.thumbnail = await gltfImage.loadHTMLImage(imageData).catch( (error) => {
                console.error(error);
            });
        }
        else if(this.mimeType === ImageMimeType.WEBP)
        {
            if (gltf.webpLibrary !== undefined)
            {
                const data = new Uint8Array(await foundFile.arrayBuffer());
                this.image = await gltf.webpLibrary.loadWebpFromBuffer(data);
                this.fileSize = data.byteLength;
                this.gpuSize = this.image.width * this.image.height * 4;
                this.gpuSize = Math.floor(this.gpuSize * 4 / 3 );
                this.gpuFormat = "RGBA8888";

                // Compressed image (just a copy of original)
                this.compressedMimeType = ImageMimeType.WEBP;
                this.compressedImage = await gltf.webpLibrary.decode(data);
                this.compressedImageTypedArrayBuffer = new Uint8Array(data);
                this.compressedFileSize = this.fileSize;
                this.compressedGpuSize = this.gpuSize;
                this.compressedGpuFormat = this.gpuFormat;
                this.compressedTextureNeedUpdate = true;

                // thumbnail
                const image_data = new ImageData(this.image.data, this.image.width, this.image.height);
                this.thumbnail = new Image(this.image.width, this.image.height);
                ImageUtils.ImageDataToImg(image_data, this.thumbnail);
            }
            else
            {
                console.warn('Loading of webp images failed: webpLibrary not initalized');
            }
        }
        else
        {
            console.error("Unsupported image type " + this.mimeType);
            return false;
        }


        return true;
    }

    async rescaleImage(width, height, gltf) {

    }

    // Compress the image to a new format and resolution
    // mimeType: target mime type
    // width: target width
    // height: target height
    // options: encoder options
    // gltf: gltf object
    // progressCallback: callback for updating the UI when encoding has been performed
    async compressImage(mimeType, width, height, options, gltf, progressCallback)
    {
        const gl = GL;
        // TODO: CHECK HOW TO REMOVE THE HACK
        while(gl.getError() != gl.NO_ERROR)
            console.log("GL Error");

        let raw_data = (this.mimeType !== ImageMimeType.KTX2) ?
         await ImageUtils.loadImageDataGL(this.glTexture, this.image.width, this.image.height, gl, this.imageType === ImageType.COLOR) :
         await ImageUtils.loadImageDataGL(this.image, this.image.width, this.image.height, gl, this.imageType === ImageType.COLOR);

        raw_data = (height !== this.image.height || width !== this.image.width) 
            ? await gltf.webpLibrary.rescale(raw_data, this.image.width, this.image.height, 4, width, height)
            : raw_data;
            
        if (mimeType === ImageMimeType.KTX2)
        {
            if (gltf.ktxEncoder !== undefined)
            {
                options.srgb = this.imageType === ImageType.COLOR;
                const data_promise = gltf.ktxEncoder.compress(raw_data, width, height, 4, options);
                progressCallback();
                const data = await data_promise;
                this.compressedImage = await gltf.ktxEncoder.loadKtxFromBuffer(data);
                // Free up the thread for 10ms in order to allow the UI to be updated
                const small_delay = new Promise((res) => setTimeout(() => res("small_delay"), 10));
                await small_delay;
                this.compressedImageTypedArrayBuffer = data;
                this.compressedFileSize = data.byteLength;
                this.compressedGpuSize = this.compressedImage.gpuSize;
                this.compressedGpuFormat = this.compressedImage.gpuFormat;
                this.compressedMimeType = ImageMimeType.KTX2;
                this.compressedTextureNeedUpdate = true;

                return data;
            }
            else
            {
                console.warn('Loading of ktx images failed: KtxEncoder not initalized');
            }

        }
        else if(mimeType === ImageMimeType.JPEG)
        {
            const quality = options.quality;
            const jpeg_data = jpeg.encode({ data: raw_data, width: width, height: height }, quality); // returns {data: Uint8Array (compressed data), width, height}
            progressCallback();
            const blob = new Blob([jpeg_data.data], { "type": mimeType });
            const objectURL = URL.createObjectURL(blob);
            this.compressedImage = await gltfImage.loadHTMLImage(objectURL).catch( () => {
                console.error("Could not load compressed jpeg image");
            });
            this.compressedImageTypedArrayBuffer = new Uint8Array(await blob.arrayBuffer());
            this.compressedFileSize = blob.size;
            this.compressedGpuSize = width * height * 4;
            this.compressedGpuSize = Math.floor(this.compressedGpuSize * 4 / 3 );
            this.compressedGpuFormat = "RGBA8888";
            this.compressedMimeType = ImageMimeType.JPEG;
            this.compressedTextureNeedUpdate = true;
            URL.revokeObjectURL(objectURL);
            return jpeg_data.data;
        }
        else if(mimeType === ImageMimeType.PNG)
        {
            const compressionLevel = options.quality;
            const png_data = png.encode({ data: raw_data, width: width, height: height }, {zlib:{level: compressionLevel}});
            progressCallback();
            const blob = new Blob([png_data], { "type": mimeType });
            const objectURL = URL.createObjectURL(blob);
            this.compressedImage = await gltfImage.loadHTMLImage(objectURL).catch( () => {
                console.error("Could not load compressed png image");
            });
            this.compressedImageTypedArrayBuffer = new Uint8Array(await blob.arrayBuffer());
            this.compressedFileSize = blob.size;
            this.compressedGpuSize = width * height * 4;
            this.compressedGpuSize = Math.floor(this.compressedGpuSize * 4 / 3 );
            this.compressedGpuFormat = "RGBA8888";
            this.compressedMimeType = ImageMimeType.PNG;
            this.compressedTextureNeedUpdate = true;
            URL.revokeObjectURL(objectURL);
            return png_data;
        }
        else if (mimeType === ImageMimeType.WEBP)
        {
            if (gltf.webpLibrary === undefined) {
                console.warn('Encoding of webp image failed: WebpLibrary not initalized');
                return false;
            }

            const quality = options.quality;
            const webp_promise = gltf.webpLibrary.encode(raw_data, width, height, 4, quality);
            progressCallback();
            const webp_data = await webp_promise;

            const blob = new Blob([webp_data], { "type": mimeType });
            const objectURL = URL.createObjectURL(blob);
            this.compressedImage = await gltfImage.loadHTMLImage(objectURL).catch( () => {
                console.error("Could not load compressed webp image");
            });
            this.compressedImageTypedArrayBuffer = new Uint8Array(await blob.arrayBuffer());
            this.compressedFileSize = blob.size;
            this.compressedGpuSize = width * height * 4;
            this.compressedGpuSize = Math.floor(this.compressedGpuSize * 4 / 3 );
            this.compressedGpuFormat = "RGBA8888";
            this.compressedMimeType = ImageMimeType.WEBP;
            this.compressedTextureNeedUpdate = true;
            URL.revokeObjectURL(objectURL);

            return webp_data;
            //ImageUtils.downloadBinaryFile("image.webp", webp_data);
        }
        else
        {
            console.error("Unsupported image type " + mimeType);
            return false;
        }
    }

}

export { gltfImage, ImageMimeType };

