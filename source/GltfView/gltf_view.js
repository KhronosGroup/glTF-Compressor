import { GltfState } from '../GltfState/gltf_state.js';
import { gltfRenderer } from '../Renderer/renderer.js';
import { GL } from '../Renderer/webgl.js';
import { ResourceLoader } from '../ResourceLoader/resource_loader.js';
import { ImageMimeType } from '../gltf/image_mime_type.js';
import { ImageType } from "../gltf/image_type.js";
import { toMb } from '../gltf/math_utils.js';

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
    createResourceLoader(externalDracoLib = undefined, externalDracoEncodeLib = undefined, externalKtxLib = undefined, externalWebPLib = undefined)
    {
        let resourceLoader = new ResourceLoader(this);
        resourceLoader.initKtxLib(externalKtxLib);
        resourceLoader.initDracoLib(externalDracoLib);
        resourceLoader.initWebPLib(externalWebPLib);
        resourceLoader.initDracoEncodeLib(externalDracoEncodeLib);
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
                geometryData: [],
                geometrySize: 0,
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
                let vertexCount = 0;
                if (primitive.indices !== undefined) {
                    vertexCount = state.gltf.accessors[primitive.indices].count;
                }
                else {
                    vertexCount = state.gltf.accessors[primitive.attributes["POSITION"]].count;
                }
                if (vertexCount === 0) {
                    return 0;
                }

                // convert vertex count to point, line or triangle count
                switch (primitive.mode) {
                case GL.POINTS:
                    return vertexCount;
                case GL.LINES:
                    return vertexCount / 2;
                case GL.LINE_LOOP:
                    return vertexCount;
                case GL.LINE_STRIP:
                    return vertexCount - 1;
                case GL.TRIANGLES:
                    return vertexCount / 3;
                case GL.TRIANGLE_STRIP:
                case GL.TRIANGLE_FAN:
                    return vertexCount - 2;
                }
            })
            .reduce((acc, faceCount) => acc + faceCount);

        // gather data for geometry size
        let geometrySize = 0;
        activePrimitives.forEach(prim => geometrySize += prim.getSize(state.gltf));
        geometrySize = toMb(geometrySize);

        // Recursive add nodes
        function addNodeToTree (gltf, i, data) {
            const node = gltf.nodes[i];
            const nodeName = node.name !== undefined ? node.name : "Node_" + i;
            const meshName = node.mesh !== undefined && state.gltf.meshes[node.mesh].name !== undefined ? state.gltf.meshes[node.mesh].name : "Mesh_" + node.mesh;
            
            // Add to MeshNodeTree
            if(node.children.length > 0 || node.mesh !== undefined){
                data.children.push({
                    name: nodeName, 
                    mesh: node.mesh,
                    meshName: meshName,
                    meshInstances: node.meshInstances, 
                    primitivesLength: node.primitivesLength,
                    compressionFormatBefore: node.compressionFormatBefore,
                    gpuSizeBefore: node.gpuSizeBefore,
                    gpuSizeAfter: node.gpuSizeAfter,
                    diskSizeBefore: node.diskSizeBefore,
                    compressionFormatAfter: node.compressionFormatAfter,
                    diskSizeAfter: node.diskSizeAfter,
                    children: [],
                });

                // recurse into children
                for(const j of node.children)
                    addNodeToTree(gltf, j, data.children[data.children.length-1]);
            }
        }

        // Root node
        console.log(state.gltf);

        function isMeshOptCompressed(gltf){       
            for (const bufferView of gltf.bufferViews){
                if( bufferView !== undefined && 
                    bufferView.extensions !== undefined &&
                    bufferView.extensions.EXT_meshopt_compression !== undefined
                )
                    return true;
            }
            return false;
        }

        // Compute info for tree mesh nodes
        var isGeometryCompressed = false;
        for(const i of state.gltf.nodes){

            var primitives = i.mesh !== undefined ? state.gltf.meshes[i.mesh].primitives : [];

            // Computer file size per node
            if(i.mesh !== undefined){
                var nodeSize = 0;
                var nodeGPUSize = 0;
                for(const prim of primitives) {
                    nodeSize += prim.getSize(state.gltf);
                    nodeGPUSize += prim.getGPUSize(state.gltf);
                }
                nodeSize = toMb(nodeSize);
                nodeGPUSize = toMb(nodeGPUSize);
                state.gltf.meshes[i.mesh].gpuSizeBefore = nodeGPUSize;
                state.gltf.meshes[i.mesh].diskSizeBefore = nodeSize;
                i.diskSizeBefore = state.gltf.meshes[i.mesh].diskSizeBefore.toFixed(2) + " mb";
                i.gpuSizeBefore = state.gltf.meshes[i.mesh].gpuSizeBefore.toFixed(2) + " mb";
            }
            else {
                i.diskSizeBefore = "";
                i.gpuSizeBefore = "";
            }
            i.diskSizeAfter = "";
            i.gpuSizeAfter = "";
            
            // Check for mesh primitives count
            i.primitivesLength = primitives.length;

            // Check for compression formats
            var compressionUsedFormatsBefore = [false,false,false]; // "Draco", "MeshQuantization", "MeshOpt"
            for(const primitive of primitives){
                compressionUsedFormatsBefore[0] |= primitive.isDracoMeshCompressed();
                compressionUsedFormatsBefore[1] |= primitive.isMeshQuantized(state.gltf);
            }
            compressionUsedFormatsBefore[2] |= isMeshOptCompressed(state.gltf);

            if(i.mesh !== undefined){
                const compressionTextFormats = ["Draco", "MeshQuantization", "MeshOpt"];
                state.gltf.meshes[i.mesh].compressionFormatBefore = compressionTextFormats.filter((_, i) => compressionUsedFormatsBefore[i]).join(',') || 'None';
                i.compressionFormatBefore = state.gltf.meshes[i.mesh].compressionFormatBefore;

                if(i.compressionFormatBefore !== 'None')
                    isGeometryCompressed = true;
            } 
            else
                i.compressionFormatBefore = "";
            i.compressionFormatAfter  = "";

            // Find if mesh of this node is reused in other nodes    
            let meshInstances = [];
            const iName = i.name !== undefined ? i.name : "Node_" + i;
            for(const j of state.gltf.nodes){
                const jName = j.name !== undefined ? j.name : "Node_" + i;
                if(jName !== iName && j.mesh !== undefined && j.mesh === i.mesh)
                    meshInstances.push(jName);
            }
            
            i.meshInstances = meshInstances;
        }

        let geometryData = {
            name: scene.name !== undefined ? scene.name : "Root", 
            mesh: undefined,
            meshName: "",
            meshInstances: [],
            primitivesLength: 0,
            compressionFormatBefore: "",
            gpuSizeBefore: "",
            gpuSizeAfter: "",
            diskSizeBefore: "",
            compressionFormatAfter: "",
            diskSizeAfter: "",
            children: [],
        };
        // Add children nodes
        scene.nodes.forEach((node) => addNodeToTree(state.gltf, node, geometryData) );

        // assemble statistics object
        return {
            meshCount: activeMeshes.length,
            faceCount: faceCount,
            geometryData: geometryData,
            geometrySize: geometrySize,
            isGeometryCompressed: isGeometryCompressed,
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
                texturesSize: 0
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

            // KHR Extension: Anisotropy
            setImageType(material.anisotropyTexture, ImageType.NONCOLOR, "anisotropy");
        });

        // Reset values
        for(let i=0; i<state.gltf.images.length; i++){
            if(document.getElementById('image-' + i))
                document.getElementById('image-' + i).checked = false;
            if(document.getElementById('container_img_' + i))
                document.getElementById('container_img_' + i).removeChild(document.getElementById('container_img_' + i).lastChild);
        }
        
        var texturesFileSize = 0;
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
        });

        // assemble statistics object
        return {
            textures: textures,
            texturesSize: texturesFileSize
        };
    }

    /**
     * gatherTextureStatistics collects information about the textures info of GltfState
     * @param {*} state GltfState about which the statistics should be collected
     * @returns {Object} an object containing statistics information
     */
    gatherCompressionStatistics(state)
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
                meshes: [],
                geometrySize: 0,
                textures: [],
                texturesSize: 0
            };
        }

        var geometryFileSize = 0;
        const meshes = [];
        const activeNodes = state.gltf.nodes;
        const activeSelectedNodes = state.compressorParameters.processedMeshes.map(index => activeNodes[index]);

        activeNodes.forEach((element, index) => {
            const isIncluded = activeSelectedNodes.includes(element);

            if(isIncluded){
                var meshSize = 0;
                var meshGPUSize = 0;
                for(const prim of element.compressedNode.compressedMesh.primitives) {
                    meshSize += prim.getSize(state.gltf);
                    meshGPUSize += prim.getGPUSize(state.gltf);
                }
                meshSize = toMb(meshSize);
                meshGPUSize = toMb(meshGPUSize);
                state.gltf.meshes[element.mesh].diskSizeAfter = meshSize;
                state.gltf.meshes[element.mesh].gpuSizeAfter = meshGPUSize;
            }
                
            if(isIncluded){
                const bboxErrorMin = element.bboxDiffError && [
                    Math.ceil(1000 * element.bboxDiffError.bboxMin[0]) / 1000,
                    Math.ceil(1000 * element.bboxDiffError.bboxMin[1]) / 1000,
                    Math.ceil(1000 * element.bboxDiffError.bboxMin[2]) / 1000,
                ];
                const bboxErrorMax = element.bboxDiffError && [
                    Math.ceil(1000 * element.bboxDiffError.bboxMax[0]) / 1000,
                    Math.ceil(1000 * element.bboxDiffError.bboxMax[1]) / 1000,
                    Math.ceil(1000 * element.bboxDiffError.bboxMax[2]) / 1000,
                ];
                const mesh = {
                    index: element.mesh,
                    compressionFormatAfter: isIncluded ? state.gltf.meshes[element.mesh].compressionFormatAfter : "", 
                    diskSizeAfter: isIncluded ? state.gltf.meshes[element.mesh].diskSizeAfter.toFixed(2) + " mb" : "",  
                    gpuSizeAfter: isIncluded ? state.gltf.meshes[element.mesh].gpuSizeAfter.toFixed(2) + " mb" : "",  
                    bboxErrorMin: bboxErrorMin? `${bboxErrorMin[0].toFixed(3)} ${bboxErrorMin[1].toFixed(3)} ${bboxErrorMin[2].toFixed(3)}` : "",
                    bboxErrorMax: bboxErrorMax? `${bboxErrorMax[0].toFixed(3)} ${bboxErrorMax[1].toFixed(3)} ${bboxErrorMax[2].toFixed(3)}` : ""
                };
                meshes.push(mesh);
            }
            let fileSize = element.mesh !== undefined ? state.gltf.meshes[element.mesh].diskSizeBefore : 0;
            let fileSizeCompressed = element.mesh !== undefined ? state.gltf.meshes[element.mesh].diskSizeAfter : 0;
            geometryFileSize += isIncluded ? fileSizeCompressed : fileSize;
        });

        // Recursive add nodes
        function addNodeToTree (gltf, i, data) {
            const node = gltf.nodes[i];
            const nodeName = node.name !== undefined ? node.name : "Node_" + i;
            const meshName = node.mesh !== undefined && state.gltf.meshes[node.mesh].name !== undefined ? state.gltf.meshes[node.mesh].name : "Mesh_" + node.mesh;

            // Add to MeshNodeTree
            if(node.children.length > 0 || node.mesh !== undefined){
                data.children.push({
                    name: nodeName, 
                    mesh: node.mesh,
                    meshName: meshName,
                    meshInstances: node.meshInstances, 
                    primitivesLength: node.primitivesLength,
                    compressionFormatBefore: node.compressionFormatBefore,
                    gpuSizeBefore: node.gpuSizeBefore,
                    gpuSizeAfter: node.gpuSizeAfter,
                    diskSizeBefore: node.diskSizeBefore,
                    compressionFormatAfter: node.compressionFormatAfter,
                    diskSizeAfter: node.diskSizeAfter,
                    children: [],
                });

                // recurse into children
                for(const j of node.children)
                    addNodeToTree(gltf, j, data.children[data.children.length-1]);
            }
        }

        // Compute info for tree mesh nodes
        for(const i of state.gltf.nodes)
            if(i.mesh !== undefined)
            {
                i.compressionFormatAfter = state.gltf.meshes[i.mesh].compressionFormatAfter === undefined ? "" : state.gltf.meshes[i.mesh].compressionFormatAfter;
                i.diskSizeAfter = state.gltf.meshes[i.mesh].diskSizeAfter === undefined ? "" : state.gltf.meshes[i.mesh].diskSizeAfter.toFixed(2) + " mb";
            }

        let geometryData = {
            name: scene.name !== undefined ? scene.name : "Root", 
            mesh: undefined,
            meshName: "",
            meshInstances: [],
            primitivesLength: 0,
            compressionFormatBefore: "",
            gpuSizeBefore: "",
            gpuSizeAfter: "",
            diskSizeBefore: "",
            compressionFormatAfter: "",
            diskSizeAfter: "",
            children: [],
        };
        // Add children nodes
        scene.nodes.forEach((node) => addNodeToTree(state.gltf, node, geometryData) );

        var texturesFileSize = 0;
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
                texture.formatCompressed += " + " + state.compressorParameters.compressionTextureEncoding;
                if(state.compressorParameters.compressionTextureEncoding === "UASTC")
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
        });

        // assemble statistics object
        return {
            meshes: meshes,
            geometryData: geometryData,
            geometrySize: geometryFileSize,
            textures: textures,
            texturesSize: texturesFileSize
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
