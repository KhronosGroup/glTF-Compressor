import { GltfState } from '../GltfState/gltf_state.js';
import { gltfRenderer } from '../Renderer/renderer.js';
import { GL } from '../Renderer/webgl.js';
import { ResourceLoader } from '../ResourceLoader/resource_loader.js';
import { ImageMimeType } from '../gltf/image_mime_type.js';
import { ImageType } from "../gltf/image_type.js";

/**
 * GltfView represents a view on a gltf, e.g. in a canvas
 */
class GltfView
{
    /**
     * GltfView representing one WebGl 2.0 context or in other words one
     * 3D rendering of the Gltf.
     * You can create multiple views for example when multiple canvases should
     * be shown on the same webpage.
     * @param {*} context WebGl 2.0 context. Get it from a canvas with `canvas.getContext("webgl2")`
     */
    constructor(context)
    {
        this.context = context;
        this.renderer = new gltfRenderer(this.context);
    }

    /**
     * createState constructs a new GltfState for the GltfView. The resources
     * referenced in a gltf state can directly be stored as resources on the WebGL
     * context of GltfView, therefore GltfStates cannot not be shared between
     * GltfViews.
     * @returns {GltfState} GltfState
     */
    createState()
    {
        return new GltfState(this);
    }

    /**
     * createResourceLoader creates a resource loader with which glTFs and
     * environments can be loaded for the view
     * @param {Object} [externalDracoLib] optional object of an external Draco library, e.g. from a CDN
     * @param {Object} [externalKtxLib] optional object of an external KTX library, e.g. from a CDN
     * @returns {ResourceLoader} ResourceLoader
     */
    createResourceLoader(externalDracoLib = undefined, externalKtxLib = undefined, externalWebPLib = undefined)
    {
        let resourceLoader = new ResourceLoader(this);
        resourceLoader.initKtxLib(externalKtxLib);
        resourceLoader.initDracoLib(externalDracoLib);
        resourceLoader.initWebPLib(externalWebPLib);
        //resourceLoader.initToKtxLib(externalDracoLib);
        return resourceLoader;
    }

    /**
     * renderFrame to the context's default frame buffer
     * Call this function in the javascript animation update loop for continuous rendering to a canvas
     * @param {*} state GltfState that is be used for rendering
     * @param {*} width of the viewport
     * @param {*} height of the viewport
     */
    renderFrame(state, width, height)
    {
        this.renderer.init(state);
        this._animate(state);

        this.renderer.resize(width, height);

        this.renderer.clearFrame(state.renderingParameters.clearColor);

        if(state.gltf === undefined)
        {
            return;
        }

        const scene = state.gltf.scenes[state.sceneIndex];

        if(scene === undefined)
        {
            return;
        }

        scene.applyTransformHierarchy(state.gltf);

        if(state.compressorParameters.previewMode === GltfState.CompressionComparison.PREVIEW_3D)
        {
            state.compressorParameters.previewCompressed = false;
            this.renderer.drawScene(state, scene);
            state.compressorParameters.previewCompressed = true;
            this.renderer.drawScene(state, scene);
        }
        else
        {
            state.compressorParameters.previewCompressed = false;
            this.renderer.drawPreviewImage(state, scene);
            state.compressorParameters.previewCompressed = true;
            this.renderer.drawPreviewImage(state, scene);

        }
    }

    /**
     * gatherStatistics collects information about the GltfState such as the number of
     * rendered meshes or triangles
     * @param {*} state GltfState about which the statistics should be collected
     * @returns {Object} an object containing statistics information
     */
    gatherStatistics(state)
    {
        if(state.gltf === undefined)
        {
            return;
        }

        // gather information from the active scene
        const scene = state.gltf.scenes[state.sceneIndex];
        if (scene === undefined)
        {
            return {
                meshCount: 0,
                faceCount: 0,
                opaqueMaterialsCount: 0,
                transparentMaterialsCount: 0,
            };
        }


        const nodes = scene.gatherNodes(state.gltf);
        const activeMeshes = nodes.filter(node => node.mesh !== undefined).map(node => state.gltf.meshes[node.mesh]);
        const activePrimitives = activeMeshes
            .reduce((acc, mesh) => acc.concat(mesh.primitives), [])
            .filter(primitive => primitive.material !== undefined);
        const activeMaterials = [... new Set(activePrimitives.map(primitive => state.gltf.materials[primitive.material]))];
        const opaqueMaterials = activeMaterials.filter(material => material.alphaMode !== "BLEND");
        const transparentMaterials = activeMaterials.filter(material => material.alphaMode === "BLEND");

        const faceCount = activePrimitives
            .map(primitive => {
                let verticesCount = 0;
                if(primitive.indices !== undefined)
                {
                    verticesCount = state.gltf.accessors[primitive.indices].count;
                }
                if (verticesCount === 0)
                {
                    return 0;
                }

                // convert vertex count to point, line or triangle count
                switch (primitive.mode) {
                case GL.POINTS:
                    return verticesCount;
                case GL.LINES:
                    return verticesCount / 2;
                case GL.LINE_LOOP:
                    return verticesCount;
                case GL.LINE_STRIP:
                    return verticesCount - 1;
                case GL.TRIANGLES:
                    return verticesCount / 3;
                case GL.TRIANGLE_STRIP:
                case GL.TRIANGLE_FAN:
                    return verticesCount - 2;
                }
            })
            .reduce((acc, faceCount) => acc += faceCount);

        // assemble statistics object
        return {
            meshCount: activeMeshes.length,
            faceCount: faceCount,
            opaqueMaterialsCount: opaqueMaterials.length,
            transparentMaterialsCount: transparentMaterials.length,
        };
    }

    /**
     * gatherTextureStatistics collects information about the textures info of GltfState
     * @param {*} state GltfState about which the statistics should be collected
     * @returns {Object} an object containing statistics information
     */
    gatherTextureStatistics(state)
    {
        if(state.gltf === undefined)
        {
            return;
        }

        // gather information from the active scene
        const scene = state.gltf.scenes[state.sceneIndex];
        if (scene === undefined)
        {
            return {
                textures: [],
                texturesSize: 0,
                texturesGpuSize: 0
            };
        }

        const setImageType = (image, type, usage) => {
            if(image !== undefined)
            {
                const index = state.gltf.textures[image.index].source;

                state.gltf.images[index].imageType = type;
                state.gltf.images[index].imageUsage.add(usage);
            }
        };

        state.gltf.materials.forEach(material => {

            setImageType(material.normalTexture, ImageType.NORMAL, "normal");
            setImageType(material.occlusionTexture, ImageType.NONCOLOR, "occlusion");
            setImageType(material.emissiveTexture, ImageType.COLOR, "emissive");
            setImageType(material.baseColorTexture, ImageType.COLOR, "baseColor");
            setImageType(material.metallicRoughnessTexture, ImageType.NONCOLOR, "metallicRoughness");

            // KHR Extension: SpecularGlossiness
            setImageType(material.diffuseTexture, ImageType.COLOR, "diffuse");
            setImageType(material.specularGlossinessTexture, ImageType.COLOR, "specularGlossiness");

            // KHR Extension: Clearcoat
            setImageType(material.clearcoatTexture, ImageType.NONCOLOR, "clearcoat");
            setImageType(material.clearcoatRoughnessTexture, ImageType.NONCOLOR, "clearcoat roughness");
            setImageType(material.clearcoatNormalTexture, ImageType.NORMAL, "clearcoat normal");

            // KHR Extension: Sheen            
            setImageType(material.sheenRoughnessTexture, ImageType.NONCOLOR, "sheen roughness");
            setImageType(material.sheenColorTexture, ImageType.COLOR, "sheen color");

            // KHR Extension: Specular
            setImageType(material.specularTexture, ImageType.NONCOLOR, "specular");
            setImageType(material.specularColorTexture, ImageType.COLOR, "specular color");

            // KHR Extension: Transmission
            setImageType(material.transmissionTexture, ImageType.NONCOLOR, "transmission");

            // KHR Extension: Volume
            setImageType(material.thicknessTexture, ImageType.NONCOLOR, "volume thickness");

            // KHR Extension: Iridescence
            setImageType(material.iridescenceTexture, ImageType.NONCOLOR, "iridescence");
            setImageType(material.iridescenceThicknessTexture, ImageType.NONCOLOR, "iridescence thickness");
        });

        // Reset values
        for(let i=0; i<state.gltf.images.length; i++){
            if(document.getElementById('image-' + i))
                document.getElementById('image-' + i).checked = true;
            if(document.getElementById('container_img_' + i))
                document.getElementById('container_img_' + i).removeChild(document.getElementById('container_img_' + i).lastChild);
        }
        const toMb = (value) => { return value/1024/1024; };
        
        var texturesFileSize = 0;
        var texturesFileGpuSize = 0;
        const textures = [];
        const activeTextures = state.gltf.images;
        activeTextures.forEach(element => {
            
            let name = "";
            if(element.uri != undefined){
                let arr  = element.uri.split('/');  // Split the string into an array of substrings
                name = arr[arr.length - 1]; // Get the last element of the array
                name.split('.')[0];
            }

            let fileSize = toMb(element.fileSize);

            const texture = {
                img: element.thumbnail,
                name: name, 
                type: element.imageType,
                usage: Array.from(element.imageUsage).join(", "),
                format: element.mimeType.replace("image/", ""),
                gpuformat: element.gpuFormat, 
                resolution:  element.image.width + "x" + element.image.height, 
                diskSize: fileSize.toFixed(2) + "mb", 
                gpuSize: toMb(element.gpuSize).toFixed(2) + "mb", 
                formatCompressed: "", 
                gpuformatCompressed: "", 
                resolutionCompressed: "",
                diskSizeCompressed: "", 
                gpuSizeCompressed: "",
                isCompleted: false
            };

            if(element.mimeType !== ImageMimeType.GLTEXTURE)
                textures.push(texture);
            texturesFileSize += fileSize;
            texturesFileGpuSize += toMb(element.gpuSize);
        });

        // assemble statistics object
        return {
            textures: textures,
            texturesSize: texturesFileSize,
            texturesGpuSize: texturesFileGpuSize
        };
    }

    /**
     * gatherTextureStatistics collects information about the textures info of GltfState
     * @param {*} state GltfState about which the statistics should be collected
     * @returns {Object} an object containing statistics information
     */
    gatherTextureCompressionStatistics(state)
    {
        if(state.gltf === undefined)
        {
            return;
        }

        // gather information from the active scene
        const scene = state.gltf.scenes[state.sceneIndex];
        if (scene === undefined)
        {
            return {
                textures: [],
                texturesSize: 0,
                texturesGpuSize: 0
            };
        }

        const toMb = (value) => { return value/1024/1024; };

        var texturesFileSize = 0;
        var textureGPUSize = 0;
        const textures = [];
        const activeTextures = state.gltf.images;
        const activeSelectedTextures = state.compressorParameters.processedImages.map(index => activeTextures[index]);

        activeTextures.forEach(element => {

            const isIncluded = activeSelectedTextures.includes(element);

            let name = "";
            if(element.uri != undefined){
                let arr  = element.uri.split('/');  // Split the string into an array of substrings
                name = arr[arr.length - 1]; // Get the last element of the array
                name.split('.')[0];
            }

            let fileSize = toMb(element.fileSize);
            let fileSizeCompressed = toMb(element.compressedFileSize);

            const texture = {
                img: element.thumbnail,
                name: name, 
                type: element.imageType,
                usage: Array.from(element.imageUsage).join(", "),
                format: element.mimeType.replace("image/", ""), 
                gpuformat: element.gpuFormat, 
                resolution:  element.image.width + "x" + element.image.height, 
                diskSize: fileSize.toFixed(2) + "mb", 
                gpuSize: toMb(element.gpuSize).toFixed(2) + "mb", 
                formatCompressed: isIncluded ? element.compressedMimeType.replace("image/", "") : "", 
                gpuformatCompressed: isIncluded ?  element.compressedGpuFormat : "", 
                resolutionCompressed: isIncluded ? element.compressedImage.width + "x" + element.compressedImage.height : "",
                diskSizeCompressed: isIncluded ? fileSizeCompressed.toFixed(2) + "mb" : "",  
                gpuSizeCompressed: isIncluded ? toMb(element.compressedGpuSize).toFixed(2) + "mb" : "", 
                isCompleted: isIncluded
            };

            if(texture.formatCompressed === "ktx2")
            {
                texture.formatCompressed += " + " + state.compressorParameters.compressionEncoding;
                if(state.compressorParameters.compressionEncoding === "UASTC")
                {
                    if(state.compressorParameters.compressionUASTC_Rdo)
                        texture.formatCompressed += " + RDO";
                    texture.formatCompressed += " + " + state.compressorParameters.compressionUASTC_Rdo_Algorithm; 
                }
                else {
                    texture.formatCompressed += " + BasisLZ";
                }
            }

            if(element.mimeType !== ImageMimeType.GLTEXTURE)
                textures.push(texture);
            texturesFileSize += isIncluded ? fileSizeCompressed : fileSize;
            textureGPUSize += isIncluded ? toMb(element.compressedGpuSize) : toMb(element.gpuSize);
            
        });

        // assemble statistics object
        return {
            textures: textures,
            texturesSize: texturesFileSize,
            texturesGpuSize: textureGPUSize
        };
    }

    _animate(state)
    {
        if(state.gltf === undefined)
        {
            return;
        }

        if(state.gltf.animations !== undefined && state.animationIndices !== undefined)
        {
            const disabledAnimations = state.gltf.animations.filter( (anim, index) => {
                return false === state.animationIndices.includes(index);
            });

            for(const disabledAnimation of disabledAnimations)
            {
                disabledAnimation.advance(state.gltf, undefined);
            }

            const t = state.animationTimer.elapsedSec();

            const animations = state.animationIndices.map(index => {
                return state.gltf.animations[index];
            }).filter(animation => animation !== undefined);

            for(const animation of animations)
            {
                animation.advance(state.gltf, t);
            }
        }
    }
}

export { GltfView };
