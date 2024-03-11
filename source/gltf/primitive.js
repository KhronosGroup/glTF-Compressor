import { initGlForMembers } from './utils.js';
import { GltfObject } from './gltf_object.js';
import { gltfBuffer } from './buffer.js';
import { gltfAccessor } from './accessor.js';
import { gltfImage } from './image.js';
import { ImageMimeType } from './image_mime_type.js';
import { gltfTexture } from './texture.js';
import { gltfTextureInfo } from './texture.js';
import { gltfSampler } from './sampler.js';
import { gltfBufferView } from './buffer_view.js';
import { DracoDecoder } from '../ResourceLoader/draco.js';
import { GL } from '../Renderer/webgl.js';
import { generateTangents } from '../libs/mikktspace.js';
import {GEOMETRY_COMPRESSION_TYPE, quantize, NumberOfComponentsMap, getComponentDataTypeSize, fillQuantizedBuffer, fillQuantizedBufferNormalized} from '../geometry_compressor.js';


class gltfPrimitive extends GltfObject
{
    constructor()
    {
        super();
        this.attributes = {};
        this.targets = [];
        this.indices = undefined;
        this.material = undefined;
        this.mode = GL.TRIANGLES;

        // non gltf
        this.glAttributes = [];
        this.morphTargetTextureInfo = undefined;
        this.defines = [];
        this.skip = true;
        this.hasWeights = false;
        this.hasJoints = false;
        this.hasNormals = false;
        this.hasTangents = false;
        this.hasTexcoord = false;
        this.hasColor = false;

        // The primitive centroid is used for depth sorting.
        this.centroid = undefined;

        // gltf-Compressor
        this.originalMaterial = -1; // index to the uncompressed material
        this.isHighlighted = false;
    }

    initGl(gltf, webGlContext)
    {
        // Use the default glTF material.
        if (this.material === undefined)
        {
            this.material = gltf.materials.length - 1;
        }

        initGlForMembers(this, gltf, webGlContext);

        const maxAttributes = webGlContext.getParameter(GL.MAX_VERTEX_ATTRIBS);

        // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#meshes
        console.log('this', this);
        if (this.extensions !== undefined)
        {
            // Decode Draco compressed mesh:
            if (this.extensions.KHR_draco_mesh_compression !== undefined)
            {
                const dracoDecoder = new DracoDecoder();
                if (dracoDecoder !== undefined && Object.isFrozen(dracoDecoder))
                {
                    let dracoGeometry = this.decodeDracoBufferToIntermediate(
                        this.extensions.KHR_draco_mesh_compression, gltf);
                    this.copyDataFromDecodedGeometry(gltf, dracoGeometry, this.attributes);
                }
                else
                {
                    console.warn('Failed to load draco compressed mesh: DracoDecoder not initialized');
                }
            }
        }

        /*if (this.attributes.TANGENT === undefined)
        {
            console.info("Generating tangents using the MikkTSpace algorithm.");
            console.time("Tangent generation");
            //this.unweld(gltf);
            //this.generateTangents(gltf);
            console.timeEnd("Tangent generation");
        }*/

        // VERTEX ATTRIBUTES
        for (const attribute of Object.keys(this.attributes))
        {
            if(this.glAttributes.length >= maxAttributes)
            {
                console.error("To many vertex attributes for this primitive, skipping " + attribute);
                break;
            }

            const idx = this.attributes[attribute];
            this.glAttributes.push({ attribute: attribute, name: "a_" + attribute.toLowerCase(), accessor: idx });

            this.defines.push(`HAS_${attribute}_${gltf.accessors[idx].type} 1`);
            switch (attribute)
            {
            case "POSITION":
                this.skip = false;
                break;
            case "NORMAL":
                this.hasNormals = true;
                break;
            case "TANGENT":
                this.hasTangents = true;
                break;
            case "TEXCOORD_0":
                this.hasTexcoord = true;
                break;
            case "TEXCOORD_1":
                this.hasTexcoord = true;
                break;
            case "COLOR_0":
                this.hasColor = true;
                break;
            case "JOINTS_0":
                this.hasJoints = true;
                break;
            case "WEIGHTS_0":
                this.hasWeights = true;
                break;
            case "JOINTS_1":
                this.hasJoints = true;
                break;
            case "WEIGHTS_1":
                this.hasWeights = true;
                break;
            default:
                console.log("Unknown attribute: " + attribute);
            }
        }

        // MORPH TARGETS
        if (this.targets !== undefined && this.targets.length > 0)
        {
            const max2DTextureSize = Math.pow(webGlContext.getParameter(GL.MAX_TEXTURE_SIZE), 2);
            const maxTextureArraySize = webGlContext.getParameter(GL.MAX_ARRAY_TEXTURE_LAYERS);
            // Check which attributes are affected by morph targets and 
            // define offsets for the attributes in the morph target texture.
            const attributeOffsets = {};
            let attributeOffset = 0;

            // Gather used attributes from all targets (some targets might
            // use more attributes than others)
            const attributes = Array.from(this.targets.reduce((acc, target) => {
                Object.keys(target).map(val => acc.add(val));
                return acc;
            }, new Set()));

            const vertexCount = gltf.accessors[this.attributes[attributes[0]]].count;
            this.defines.push(`NUM_VERTICIES ${vertexCount}`);
            let targetCount = this.targets.length;
            if (targetCount * attributes.length > maxTextureArraySize)
            {
                targetCount = Math.floor(maxTextureArraySize / attributes.length);
                console.warn(`Morph targets exceed texture size limit. Only ${targetCount} of ${this.targets.length} are used.`);
            }

            for (const attribute of attributes)
            {
                // Add morph target defines
                this.defines.push(`HAS_MORPH_TARGET_${attribute} 1`);
                this.defines.push(`MORPH_TARGET_${attribute}_OFFSET ${attributeOffset}`);
                // Store the attribute offset so that later the 
                // morph target texture can be assembled.
                attributeOffsets[attribute] = attributeOffset;
                attributeOffset += targetCount;
            }
            this.defines.push("HAS_MORPH_TARGETS 1");

            if (vertexCount <= max2DTextureSize) {
                // Allocate the texture buffer. Note that all target attributes must be vec3 types and
                // all must have the same vertex count as the primitives other attributes.
                const width = Math.ceil(Math.sqrt(vertexCount));
                const singleTextureSize = Math.pow(width, 2) * 4;
                const morphTargetTextureArray = new Float32Array(singleTextureSize * targetCount * attributes.length);

                // Now assemble the texture from the accessors.
                for (let i = 0; i < targetCount; ++i)
                {
                    let target = this.targets[i];
                    for (let [attributeName, offsetRef] of Object.entries(attributeOffsets)){
                        if (target[attributeName] != undefined) {
                            const accessor = gltf.accessors[target[attributeName]];
                            const offset = offsetRef * singleTextureSize;
                            if (accessor.componentType != GL.FLOAT && accessor.normalized == false){
                                console.warn("Unsupported component type for morph targets");
                                attributeOffsets[attributeName] = offsetRef + 1;
                                continue;
                            }
                            const data = accessor.getNormalizedDeinterlacedView(gltf);
                            switch(accessor.type)
                            {
                            case "VEC2":
                            case "VEC3":
                            {
                                // Add padding to fit vec2/vec3 into rgba
                                let paddingOffset = 0;
                                let accessorOffset = 0;
                                const componentCount = accessor.getComponentCount(accessor.type);
                                for (let j = 0; j < accessor.count; ++j) {
                                    morphTargetTextureArray.set(data.subarray(accessorOffset, accessorOffset + componentCount), offset + paddingOffset);
                                    paddingOffset += 4;
                                    accessorOffset += componentCount;
                                }
                                break;
                            }
                            case "VEC4":
                                morphTargetTextureArray.set(data, offset);
                                break;
                            default:
                                console.warn("Unsupported attribute type for morph targets");
                                break;
                            }
                        }
                        attributeOffsets[attributeName] = offsetRef + 1;
                    }
                }


                // Add the morph target texture.
                // We have to create a WebGL2 texture as the format of the
                // morph target texture has to be explicitly specified 
                // (gltf image would assume uint8).
                let texture = webGlContext.createTexture();
                webGlContext.bindTexture( webGlContext.TEXTURE_2D_ARRAY, texture);
                // Set texture format and upload data.
                let internalFormat = webGlContext.RGBA32F;
                let format = webGlContext.RGBA;
                let type = webGlContext.FLOAT;
                let data = morphTargetTextureArray;
                webGlContext.texImage3D(
                    webGlContext.TEXTURE_2D_ARRAY,
                    0, //level
                    internalFormat,
                    width,
                    width,
                    targetCount * attributes.length, //Layer count
                    0, //border
                    format,
                    type,
                    data);
                // Ensure mipmapping is disabled and the sampler is configured correctly.
                webGlContext.texParameteri( GL.TEXTURE_2D_ARRAY,  GL.TEXTURE_WRAP_S,  GL.CLAMP_TO_EDGE);
                webGlContext.texParameteri( GL.TEXTURE_2D_ARRAY,  GL.TEXTURE_WRAP_T,  GL.CLAMP_TO_EDGE);
                webGlContext.texParameteri( GL.TEXTURE_2D_ARRAY,  GL.TEXTURE_MIN_FILTER,  GL.NEAREST);
                webGlContext.texParameteri( GL.TEXTURE_2D_ARRAY,  GL.TEXTURE_MAG_FILTER,  GL.NEAREST);
                
                // Now we add the morph target texture as a gltf texture info resource, so that 
                // we can just call webGl.setTexture(..., gltfTextureInfo, ...) in the renderer.
                const morphTargetImage = new gltfImage(
                    undefined, // uri
                    GL.TEXTURE_2D_ARRAY, // type
                    0, // mip level
                    undefined, // buffer view
                    undefined, // name
                    ImageMimeType.GLTEXTURE, // mimeType
                    texture // image
                );
                gltf.images.push(morphTargetImage);

                gltf.samplers.push(new gltfSampler(GL.NEAREST, GL.NEAREST, GL.CLAMP_TO_EDGE, GL.CLAMP_TO_EDGE, undefined));

                const morphTargetTexture = new gltfTexture(
                    gltf.samplers.length - 1,
                    gltf.images.length - 1,
                    GL.TEXTURE_2D_ARRAY);
                // The webgl texture is already initialized -> this flag informs
                // webgl.setTexture about this.
                morphTargetTexture.initialized = true;

                gltf.textures.push(morphTargetTexture);

                this.morphTargetTextureInfo = new gltfTextureInfo(gltf.textures.length - 1, 0, true);
                this.morphTargetTextureInfo.samplerName = "u_MorphTargetsSampler";
                this.morphTargetTextureInfo.generateMips = false;
            } else {
                console.warn("Mesh of Morph targets too big. Cannot apply morphing.");
            }         
        }

        this.computeCentroid(gltf);
    }

    computeCentroid(gltf)
    {
        const positionsAccessor = gltf.accessors[this.attributes.POSITION];
        //const positions = positionsAccessor.getNormalizedTypedView(gltf);
        const positions = positionsAccessor.getNormalizedDeinterlacedView(gltf);
        console.log('this.indices', this.indices);
        if(this.indices !== undefined)
        {
            // Primitive has indices.

            const indicesAccessor = gltf.accessors[this.indices];
            console.log('indicesAccessor', indicesAccessor);
            const indices = indicesAccessor.getTypedView(gltf);

            const acc = new Float32Array(3);

            for(let i = 0; i < indices.length; i++) {
                const offset = 3 * indices[i];
                acc[0] += positions[offset];
                acc[1] += positions[offset + 1];
                acc[2] += positions[offset + 2];
            }

            const centroid = new Float32Array([
                acc[0] / indices.length,
                acc[1] / indices.length,
                acc[2] / indices.length,
            ]);

            this.centroid = centroid;
        }
        else
        {
            // Primitive does not have indices.

            const acc = new Float32Array(3);

            for(let i = 0; i < positions.length; i += 3) {
                acc[0] += positions[i];
                acc[1] += positions[i + 1];
                acc[2] += positions[i + 2];
            }

            const positionVectors = positions.length / 3;

            const centroid = new Float32Array([
                acc[0] / positionVectors,
                acc[1] / positionVectors,
                acc[2] / positionVectors,
            ]);

            this.centroid = centroid;
        }
    }

    getShaderIdentifier()
    {
        return "primitive.vert";
    }

    getDefines()
    {
        return this.defines;
    }

    fromJson(jsonPrimitive)
    {
        super.fromJson(jsonPrimitive);

        if(jsonPrimitive.extensions !== undefined)
        {
            this.fromJsonPrimitiveExtensions(jsonPrimitive.extensions);
        }
    }

    fromJsonPrimitiveExtensions(jsonExtensions)
    {
        if(jsonExtensions.KHR_materials_variants !== undefined)
        {
            this.fromJsonVariants(jsonExtensions.KHR_materials_variants);
        }
    }

    fromJsonVariants(jsonVariants)
    {
        if(jsonVariants.mappings !== undefined)
        {
            this.mappings = jsonVariants.mappings;
        }
    }

    copyDataFromDecodedGeometry(gltf, dracoGeometry, primitiveAttributes)
    {
        // indices
        let indexBuffer = dracoGeometry.index.array;
        if (this.indices !== undefined){
            this.loadBufferIntoGltf(indexBuffer, gltf, this.indices, 34963,
                "index buffer view");
        }

        // Position
        if(dracoGeometry.attributes.POSITION !== undefined)
        {
            let positionBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.POSITION.array,
                dracoGeometry.attributes.POSITION.componentType);
            this.loadBufferIntoGltf(positionBuffer, gltf, primitiveAttributes["POSITION"], 34962,
                "position buffer view");
        }

        // Normal
        if(dracoGeometry.attributes.NORMAL !== undefined)
        {
            let normalBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.NORMAL.array,
                dracoGeometry.attributes.NORMAL.componentType);
            this.loadBufferIntoGltf(normalBuffer, gltf, primitiveAttributes["NORMAL"], 34962,
                "normal buffer view");
        }

        // TEXCOORD_0
        if(dracoGeometry.attributes.TEXCOORD_0 !== undefined)
        {
            let uvBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.TEXCOORD_0.array,
                dracoGeometry.attributes.TEXCOORD_0.componentType);
            this.loadBufferIntoGltf(uvBuffer, gltf, primitiveAttributes["TEXCOORD_0"], 34962,
                "TEXCOORD_0 buffer view");
        }

        // TEXCOORD_1
        if(dracoGeometry.attributes.TEXCOORD_1 !== undefined)
        {
            let uvBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.TEXCOORD_1.array,
                dracoGeometry.attributes.TEXCOORD_1.componentType);
            this.loadBufferIntoGltf(uvBuffer, gltf, primitiveAttributes["TEXCOORD_1"], 34962,
                "TEXCOORD_1 buffer view");
        }

        // Tangent
        if(dracoGeometry.attributes.TANGENT !== undefined)
        {
            let tangentBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.TANGENT.array,
                dracoGeometry.attributes.TANGENT.componentType);
            this.loadBufferIntoGltf(tangentBuffer, gltf, primitiveAttributes["TANGENT"], 34962,
                "Tangent buffer view");
        }

        // Color
        if(dracoGeometry.attributes.COLOR_0 !== undefined)
        {
            let colorBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.COLOR_0.array,
                dracoGeometry.attributes.COLOR_0.componentType);
            this.loadBufferIntoGltf(colorBuffer, gltf, primitiveAttributes["COLOR_0"], 34962,
                "color buffer view");
        }

        // JOINTS_0
        if(dracoGeometry.attributes.JOINTS_0 !== undefined)
        {
            let jointsBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.JOINTS_0.array,
                dracoGeometry.attributes.JOINTS_0.componentType);
            this.loadBufferIntoGltf(jointsBuffer, gltf, primitiveAttributes["JOINTS_0"], 34963,
                "JOINTS_0 buffer view");
        }

        // WEIGHTS_0
        if(dracoGeometry.attributes.WEIGHTS_0 !== undefined)
        {
            let weightsBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.WEIGHTS_0.array,
                dracoGeometry.attributes.WEIGHTS_0.componentType);
            this.loadBufferIntoGltf(weightsBuffer, gltf, primitiveAttributes["WEIGHTS_0"], 34963,
                "WEIGHTS_0 buffer view");
        }

        // JOINTS_1
        if(dracoGeometry.attributes.JOINTS_1 !== undefined)
        {
            let jointsBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.JOINTS_1.array,
                dracoGeometry.attributes.JOINTS_1.componentType);
            this.loadBufferIntoGltf(jointsBuffer, gltf, primitiveAttributes["JOINTS_1"], 34963,
                "JOINTS_1 buffer view");
        }

        // WEIGHTS_1
        if(dracoGeometry.attributes.WEIGHTS_1 !== undefined)
        {
            let weightsBuffer = this.loadArrayIntoArrayBuffer(dracoGeometry.attributes.WEIGHTS_1.array,
                dracoGeometry.attributes.WEIGHTS_1.componentType);
            this.loadBufferIntoGltf(weightsBuffer, gltf, primitiveAttributes["WEIGHTS_1"], 34963,
                "WEIGHTS_1 buffer view");
        }
    }

    loadBufferIntoGltf(buffer, gltf, gltfAccessorIndex, gltfBufferViewTarget, gltfBufferViewName)
    {
        const gltfBufferObj = new gltfBuffer();
        gltfBufferObj.byteLength = buffer.byteLength;
        gltfBufferObj.buffer = buffer;
        gltf.buffers.push(gltfBufferObj);

        const gltfBufferViewObj = new gltfBufferView();
        gltfBufferViewObj.buffer = gltf.buffers.length - 1;
        gltfBufferViewObj.byteLength = buffer.byteLength;
        if(gltfBufferViewName !== undefined)
        {
            gltfBufferViewObj.name = gltfBufferViewName;
        }
        gltfBufferViewObj.target = gltfBufferViewTarget;
        gltf.bufferViews.push(gltfBufferViewObj);

        gltf.accessors[gltfAccessorIndex].byteOffset = 0;
        gltf.accessors[gltfAccessorIndex].bufferView = gltf.bufferViews.length - 1;
    }

    loadArrayIntoArrayBuffer(arrayData, componentType)
    {
        let arrayBuffer;
        switch (componentType)
        {
        case "Int8Array":
            arrayBuffer = new ArrayBuffer(arrayData.length);
            let int8Array = new Int8Array(arrayBuffer);
            int8Array.set(arrayData);
            break;
        case "Uint8Array":
            arrayBuffer = new ArrayBuffer(arrayData.length);
            let uint8Array = new Uint8Array(arrayBuffer);
            uint8Array.set(arrayData);
            break;
        case "Int16Array":
            arrayBuffer = new ArrayBuffer(arrayData.length * 2);
            let int16Array = new Int16Array(arrayBuffer);
            int16Array.set(arrayData);
            break;
        case "Uint16Array":
            arrayBuffer = new ArrayBuffer(arrayData.length * 2);
            let uint16Array = new Uint16Array(arrayBuffer);
            uint16Array.set(arrayData);
            break;
        case "Int32Array":
            arrayBuffer = new ArrayBuffer(arrayData.length * 4);
            let int32Array = new Int32Array(arrayBuffer);
            int32Array.set(arrayData);
            break;
        case "Uint32Array":
            arrayBuffer = new ArrayBuffer(arrayData.length * 4);
            let uint32Array = new Uint32Array(arrayBuffer);
            uint32Array.set(arrayData);
            break;
        default:
        case "Float32Array":
            arrayBuffer = new ArrayBuffer(arrayData.length * 4);
            let floatArray = new Float32Array(arrayBuffer);
            floatArray.set(arrayData);
            break;
        }


        return arrayBuffer;
    }

    decodeDracoBufferToIntermediate(dracoExtension, gltf)
    {
        let dracoBufferViewIDX = dracoExtension.bufferView;

        const origGltfDrBufViewObj = gltf.bufferViews[dracoBufferViewIDX];
        const origGltfDracoBuffer = gltf.buffers[origGltfDrBufViewObj.buffer];

        const totalBuffer = new Int8Array( origGltfDracoBuffer.buffer );
        const actualBuffer = totalBuffer.slice(origGltfDrBufViewObj.byteOffset,
            origGltfDrBufViewObj.byteOffset + origGltfDrBufViewObj.byteLength);

        // decode draco buffer to geometry intermediate
        let dracoDecoder = new DracoDecoder();
        let draco = dracoDecoder.module;
        let decoder = new draco.Decoder();
        let decoderBuffer = new draco.DecoderBuffer();
        decoderBuffer.Init(actualBuffer, origGltfDrBufViewObj.byteLength);
        let geometry = this.decodeGeometry( draco, decoder, decoderBuffer, dracoExtension.attributes, gltf );

        draco.destroy( decoderBuffer );

        return geometry;
    }

    getDracoArrayTypeFromComponentType(componentType)
    {
        switch (componentType)
        {
        case GL.BYTE:
            return "Int8Array";
        case GL.UNSIGNED_BYTE:
            return "Uint8Array";
        case GL.SHORT:
            return "Int16Array";
        case GL.UNSIGNED_SHORT:
            return "Uint16Array";
        case GL.INT:
            return "Int32Array";
        case GL.UNSIGNED_INT:
            return "Uint32Array";
        case GL.FLOAT:
            return "Float32Array";
        default:
            return "Float32Array";
        }
    }

    decodeGeometry(draco, decoder, decoderBuffer, gltfDracoAttributes, gltf) {
        let dracoGeometry;
        let decodingStatus;

        // decode mesh in draco decoder
        let geometryType = decoder.GetEncodedGeometryType( decoderBuffer );
        if ( geometryType === draco.TRIANGULAR_MESH ) {
            dracoGeometry = new draco.Mesh();
            decodingStatus = decoder.DecodeBufferToMesh( decoderBuffer, dracoGeometry );
        }
        else
        {
            throw new Error( 'DRACOLoader: Unexpected geometry type.' );
        }

        if ( ! decodingStatus.ok() || dracoGeometry.ptr === 0 ) {
            throw new Error( 'DRACOLoader: Decoding failed: ' + decodingStatus.error_msg() );
        }

        let geometry = { index: null, attributes: {} };
        let vertexCount = dracoGeometry.num_points();

        // Gather all vertex attributes.
        for(let dracoAttr in gltfDracoAttributes)
        {
            let componentType = GL.BYTE;
            let accessotVertexCount;
            // find gltf accessor for this draco attribute
            for (const [key, value] of Object.entries(this.attributes))
            {
                if(key === dracoAttr)
                {
                    componentType = gltf.accessors[value].componentType;
                    accessotVertexCount = gltf.accessors[value].count;
                    break;
                }
            }

            // check if vertex count matches
            if(vertexCount !== accessotVertexCount)
            {
                throw new Error(`DRACOLoader: Accessor vertex count ${accessotVertexCount} does not match draco decoder vertex count  ${vertexCount}`);
            }
            componentType = this.getDracoArrayTypeFromComponentType(componentType);

            let dracoAttribute = decoder.GetAttributeByUniqueId( dracoGeometry, gltfDracoAttributes[dracoAttr]);
            var tmpObj = this.decodeAttribute( draco, decoder,
                dracoGeometry, dracoAttr, dracoAttribute, componentType);
            geometry.attributes[tmpObj.name] = tmpObj;
        }

        // Add index buffer
        if ( geometryType === draco.TRIANGULAR_MESH ) {

            // Generate mesh faces.
            let numFaces = dracoGeometry.num_faces();
            let numIndices = numFaces * 3;
            let dataSize = numIndices * 4;
            let ptr = draco._malloc( dataSize );
            decoder.GetTrianglesUInt32Array( dracoGeometry, dataSize, ptr );
            let index = new Uint32Array( draco.HEAPU32.buffer, ptr, numIndices ).slice();
            draco._free( ptr );

            geometry.index = { array: index, itemSize: 1 };

        }

        draco.destroy( dracoGeometry );
        return geometry;
    }

    decodeAttribute( draco, decoder, dracoGeometry, attributeName, attribute, attributeType) {
        let numComponents = attribute.num_components();
        let numPoints = dracoGeometry.num_points();
        let numValues = numPoints * numComponents;

        let ptr;
        let array;

        let dataSize;
        switch ( attributeType ) {
        case "Float32Array":
            dataSize = numValues * 4;
            ptr = draco._malloc( dataSize );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_FLOAT32, dataSize, ptr );
            array = new Float32Array( draco.HEAPF32.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        case "Int8Array":
            ptr = draco._malloc( numValues );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_INT8, numValues, ptr );
            array = new Int8Array( draco.HEAP8.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        case "Int16Array":
            dataSize = numValues * 2;
            ptr = draco._malloc( dataSize );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_INT16, dataSize, ptr );
            array = new Int16Array( draco.HEAP16.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        case "Int32Array":
            dataSize = numValues * 4;
            ptr = draco._malloc( dataSize );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_INT32, dataSize, ptr );
            array = new Int32Array( draco.HEAP32.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        case "Uint8Array":
            ptr = draco._malloc( numValues );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_UINT8, numValues, ptr );
            array = new Uint8Array( draco.HEAPU8.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        case "Uint16Array":
            dataSize = numValues * 2;
            ptr = draco._malloc( dataSize );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_UINT16, dataSize, ptr );
            array = new Uint16Array( draco.HEAPU16.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        case "Uint32Array":
            dataSize = numValues * 4;
            ptr = draco._malloc( dataSize );
            decoder.GetAttributeDataArrayForAllPoints( dracoGeometry, attribute, draco.DT_UINT32, dataSize, ptr );
            array = new Uint32Array( draco.HEAPU32.buffer, ptr, numValues ).slice();
            draco._free( ptr );
            break;

        default:
            throw new Error( 'DRACOLoader: Unexpected attribute type.' );
        }

        return {
            name: attributeName,
            array: array,
            itemSize: numComponents,
            componentType: attributeType
        };

    }

    /**
     * Unwelds this primitive, i.e. applies the index mapping.
     * This is required for generating tangents using the MikkTSpace algorithm,
     * because the same vertex might be mapped to different tangents.
     * @param {*} gltf The glTF document.
     */
    unweld(gltf) {
        // Unwelding is an idempotent operation.
        if (this.indices === undefined) {
            return;
        }
        
        const indices = gltf.accessors[this.indices].getTypedView(gltf);

        // Unweld attributes:
        for (const [attribute, accessorIndex] of Object.entries(this.attributes)) {
            this.attributes[attribute] = this.unweldAccessor(gltf, gltf.accessors[accessorIndex], indices);
        }

        // Unweld morph targets:
        for (const target of this.targets) {
            for (const [attribute, accessorIndex] of Object.entries(target)) {
                target[attribute] = this.unweldAccessor(gltf, gltf.accessors[accessorIndex], indices);
            }
        }

        // Dipose the indices:
        this.indices = undefined;
    }

    /**
     * Unwelds a single accessor. Used by {@link unweld}.
     * @param {*} gltf The glTF document.
     * @param {*} accessor The accessor to unweld.
     * @param {*} typedIndexView A typed view of the indices.
     * @returns A new accessor index containing the unwelded attribute.
     */
    unweldAccessor(gltf, accessor, typedIndexView) {
        const componentCount = accessor.getComponentCount(accessor.type);
        
        const weldedAttribute = accessor.getDeinterlacedView(gltf);
        // Create new array with same type as weldedAttribute
        const unweldedAttribute = new weldedAttribute.constructor(gltf.accessors[this.indices].count * componentCount);

        // Apply the index mapping.
        for (let i = 0; i < typedIndexView.length; i++) {
            for (let j = 0; j < componentCount; j++) {
                unweldedAttribute[i * componentCount + j] = weldedAttribute[typedIndexView[i] * componentCount + j];
            }
        }

        // Create a new buffer and buffer view for the unwelded attribute:
        const unweldedBuffer = new gltfBuffer();
        unweldedBuffer.byteLength = unweldedAttribute.byteLength;
        unweldedBuffer.buffer = unweldedAttribute.buffer;
        gltf.buffers.push(unweldedBuffer);

        const unweldedBufferView = new gltfBufferView();
        unweldedBufferView.buffer = gltf.buffers.length - 1;
        unweldedBufferView.byteLength = unweldedAttribute.byteLength;
        unweldedBufferView.target = GL.ARRAY_BUFFER;
        gltf.bufferViews.push(unweldedBufferView);

        // Create a new accessor for the unwelded attribute:
        const unweldedAccessor = new gltfAccessor();
        unweldedAccessor.bufferView = gltf.bufferViews.length - 1;
        unweldedAccessor.byteOffset = 0;
        unweldedAccessor.count = typedIndexView.length;
        unweldedAccessor.type = accessor.type;
        unweldedAccessor.componentType = accessor.componentType;
        unweldedAccessor.min = accessor.min;
        unweldedAccessor.max = accessor.max;
        unweldedAccessor.normalized = accessor.normalized;
        gltf.accessors.push(unweldedAccessor);

        // Update the primitive to use the unwelded attribute:
        return gltf.accessors.length - 1;
    }

    generateTangents(gltf) {
        if(this.attributes.NORMAL === undefined || this.attributes.TEXCOORD_0 === undefined)
        {
            return;
        }

        const positions = gltf.accessors[this.attributes.POSITION].getTypedView(gltf);
        const normals = gltf.accessors[this.attributes.NORMAL].getTypedView(gltf);
        const texcoords = gltf.accessors[this.attributes.TEXCOORD_0].getTypedView(gltf);

        const tangents = generateTangents(positions, normals, texcoords);

        // Create a new buffer and buffer view for the tangents:
        const tangentBuffer = new gltfBuffer();
        tangentBuffer.byteLength = tangents.byteLength;
        tangentBuffer.buffer = tangents.buffer;
        gltf.buffers.push(tangentBuffer);

        const tangentBufferView = new gltfBufferView();
        tangentBufferView.buffer = gltf.buffers.length - 1;
        tangentBufferView.byteLength = tangents.byteLength;
        tangentBufferView.target = GL.ARRAY_BUFFER;
        gltf.bufferViews.push(tangentBufferView);

        // Create a new accessor for the tangents:
        const tangentAccessor = new gltfAccessor();
        tangentAccessor.bufferView = gltf.bufferViews.length - 1;
        tangentAccessor.byteOffset = 0;
        tangentAccessor.count = tangents.length / 4;
        tangentAccessor.type = "VEC4";
        tangentAccessor.componentType = GL.FLOAT;

        // Update the primitive to use the tangents:
        this.attributes.TANGENT = gltf.accessors.length;
        gltf.accessors.push(tangentAccessor);

    }

    compressGeometryDRACO(options, gltf) {
        const encoderModule = gltf.dracoEncoder.module;
        const indices = (this.indices !== undefined) ? gltf.accessors[this.indices].getTypedView(gltf) : null;
        let attr_count = 0;
        const accessor = (this.indices !== undefined) ? gltf.accessors[this.indices] : undefined;
        const mesh_builder = new encoderModule.MeshBuilder();
        const mesh = new encoderModule.Mesh();
        const encoder = new encoderModule.ExpertEncoder(mesh);
        const draco_attributes = {};
        const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
        for (const glAttribute of this.glAttributes) {
            const accessor = gltf.accessors[glAttribute.accessor];
            const data = accessor.getTypedView(gltf);
            const compCount = accessor.getComponentCount(accessor.type);
            const compSize = accessor.getComponentSize(accessor.componentType);
            const byteStride = compSize * compCount;
            attr_count = data.byteLength / byteStride;
        }
        const face_count = (this.indices !== undefined) ? indices.length / 3 : attr_count / 3;

        const indices32 = (indices) ? new Uint32Array(indices.length) : new Uint32Array(face_count * 3);
        for(var i = 0; i < indices32.length; i++) {
            indices32[i] = (indices) ? indices[i] : i;
        }
        console.log('this.indices', this.indices);
        console.log('indices32', indices32);
        console.log('face_count', face_count);
        console.log('attr_count', attr_count);
        if (face_count > 0) mesh_builder.AddFacesToMesh(mesh, face_count, indices32);

        encoder.SetTrackEncodedProperties(true);
        for (const glAttribute of this.glAttributes) {
            const accessor = gltf.accessors[glAttribute.accessor];
            const attribute = glAttribute.attribute;
            const data = accessor.getTypedView(gltf);
            const compType = accessor.componentType;
            const compCount = accessor.getComponentCount(accessor.type);
            const compSize = accessor.getComponentSize(accessor.componentType);
            const bitCount = accessor.getComponentBitCount(accessor.componentType);
            const byteStride = compSize * compCount;
            const attr_count = data.byteLength / byteStride;
            const attribute_type = gltf.dracoEncoder.getAttributeType(attribute);

            const AddAttributeTable = {
                [GL.BYTE]: (mesh_builder, mesh, type, count, comps, data) => mesh_builder.AddInt8Attribute(mesh, type, count, comps, data),
                [GL.UNSIGNED_BYTE]: (mesh_builder, mesh, type, count, comps, data) => mesh_builder.AddUInt8Attribute(mesh, type, count, comps, data),
                [GL.SHORT]: (mesh_builder, mesh, type, count, comps, data) => mesh_builder.AddInt16Attribute(mesh, type, count, comps, data),
                [GL.UNSIGNED_SHORT]: (mesh_builder, mesh, type, count, comps, data) => mesh_builder.AddUInt16Attribute(mesh, type, count, comps, data),
                [GL.UNSIGNED_INT]: (mesh_builder, mesh, type, count, comps, data) => mesh_builder.AddInt32Attribute(mesh, type, count, comps, data),
                [GL.FLOAT]: (mesh_builder, mesh, type, count, comps, data) => mesh_builder.AddFloatAttributeToMesh(mesh, type, count, comps, data)
            };
            const attribute_id = AddAttributeTable[compType](mesh_builder, mesh, attribute_type, attr_count, compCount, data);
            draco_attributes[attribute] = attribute_id;

            if ("POSITION" === attribute)
                encoder.SetAttributeQuantization(attribute_id, options.positionCompressionQuantizationBits);
            else if ("NORMAL" === attribute)
                encoder.SetAttributeQuantization(attribute_id, options.normalCompressionQuantizationBits);
            else if ("COLOR" === attribute)
                encoder.SetAttributeQuantization(attribute_id, options.colorCompressionQuantizationBits);
            else if ("WEIGHTS_0" === attribute || "WEIGHTS_1" === attribute )
                encoder.SetAttributeQuantization(attribute_id, options.weightQuantizationBits);
            else if ("TEX_COORD_0" === attribute || "TEX_COORD_1" === attribute )
                encoder.SetAttributeQuantization(attribute_id, options.texcoordCompressionQuantizationBits);
            else if ("JOINTS_0" === attribute || "JOINTS_1" === attribute )
                encoder.SetAttributeQuantization(attribute_id, options.jointQuantizationBits);
            else
                encoder.SetAttributeQuantization(attribute_id, options.genericQuantizationBits);
        }
        encoder.SetEncodingMethod(options.encodingMethod === "EDGEBREAKER" ? encoderModule.MESH_EDGEBREAKER_ENCODING : encoderModule.MESH_SEQUENTIAL_ENCODING);            
        encoder.SetSpeedOptions(options.compressionSpeedDraco, options.decompressionSpeedDraco);            
        
        const draco_array = new encoderModule.DracoInt8Array();
        const draco_array_len = encoder.EncodeToDracoBuffer(false, draco_array);
        const compressed_buffer = new Uint8Array(draco_array_len);
        for (var i = 0; i < draco_array_len; i++) {
            compressed_buffer[i] = draco_array.GetValue(i);
        }
        
        const draco_attr_count = encoder.GetNumberOfEncodedPoints();
        const draco_face_count = encoder.GetNumberOfEncodedFaces();

        encoderModule.destroy(mesh);
        encoderModule.destroy(encoder);
        encoderModule.destroy(mesh_builder);

        const buffer = new gltfBuffer();
        buffer.byteLength = compressed_buffer.byteLength;
        buffer.buffer = compressed_buffer;
        gltf.buffers.push(buffer);

        // create a new bufferView
        const bufferView = new gltfBufferView();
        bufferView.buffer = gltf.buffers.length - 1;
        bufferView.byteOffset = 0;
        bufferView.byteLength = buffer.byteLength;
        bufferView.name = "DRACO Compressed Data";
        gltf.bufferViews.push(bufferView);
        console.log('draco buffer', buffer);
        console.log('draco bufferView', bufferView);
        console.log('draco_face_count', draco_face_count);
        console.log('draco_attr_count', draco_attr_count);
        console.log('accessor', accessor);
        // Create a new accessor for the indices:
        const accessor_compressed = new gltfAccessor();
        accessor_compressed.bufferView = gltf.bufferViews.length - 1;
        accessor_compressed.byteOffset = 0;
        accessor_compressed.count = draco_face_count * 3;
        accessor_compressed.type = "SCALAR";
        accessor_compressed.componentType = (accessor) ? accessor.componentType : GL.UNSIGNED_INT;
        gltf.accessors.push(accessor_compressed);
        
        this.indices = gltf.accessors.length - 1;
        this.extensions = { 
            KHR_draco_mesh_compression: {
                bufferView: gltf.bufferViews.length - 1,
                attributes: draco_attributes
            }
        };

        // Create new accessors for the draco attributes:
        for (const glAttribute of this.glAttributes) {
            const attribute = glAttribute.attribute;
            const accessor = gltf.accessors[glAttribute.accessor];
            const accessor_compressed = new gltfAccessor();
            accessor_compressed.bufferView = accessor.bufferView;
            accessor_compressed.byteOffset = accessor.byteOffset;
            accessor_compressed.count = draco_attr_count;
            accessor_compressed.type = accessor.type;
            accessor_compressed.componentType = accessor.componentType;
            gltf.accessors.push(accessor_compressed);

            glAttribute.accessor = gltf.accessors.length - 1;
            this.attributes[attribute] = glAttribute.accessor;
        }

        this.defines = [];
        this.glAttributes = [];
        this.initGl(gltf, gltf.view.context);
    }

    quantize(gltf, inputAccessor, componentType, normalized, remap, offset, scale) {
        const componentTypeByteSize = getComponentDataTypeSize(componentType);
        const numberOfComponents = NumberOfComponentsMap[`${inputAccessor.type}`];
        const reorder = (reordered_data, data, remap, compCount) => {
            for (let i = 0; i < (data.length / compCount); ++i)
                for (let j = 0; j < compCount; ++j)
                    reordered_data[compCount * remap[i] + j] = data[i * compCount + j];
        };

        // 4 byte aligned
        const byteStride = 4 * (Math.floor((componentTypeByteSize * numberOfComponents - 1) / 4) + 1);
    
        let inputFloatArrayView = new Float32Array(inputAccessor.getNormalizedDeinterlacedView(gltf));
        if(scale !== undefined)
        {
            inputFloatArrayView = inputFloatArrayView.map((v,i) => (v + offset[i % numberOfComponents]) * scale); // inverse of T*R*S
        }

        //console.log('inputAccessor', inputAccessor);
        //console.log('remap', remap);
        let inputArrayView = inputFloatArrayView;
        let reorderedInputArrayView = inputArrayView;
        if (remap.length > 0) {
            reorderedInputArrayView = new Float32Array(inputAccessor.count * numberOfComponents);
            reorder(reorderedInputArrayView, inputArrayView, remap, numberOfComponents);
        }

        //console.log('inputFloatArrayView', inputFloatArrayView);
        //console.log('inputArrayView', inputArrayView);
        //console.log('reorderedInputArrayView', reorderedInputArrayView);
        const quantized_data_length = inputAccessor.count * byteStride;
        const quantized_data = new ArrayBuffer(quantized_data_length);

        // convert to the requested quantization format
        if(normalized)
            fillQuantizedBufferNormalized(reorderedInputArrayView, quantized_data, componentType, numberOfComponents, inputAccessor.count, byteStride / componentTypeByteSize)
        else
            fillQuantizedBuffer(reorderedInputArrayView, quantized_data, componentType, numberOfComponents, inputAccessor.count, byteStride / componentTypeByteSize)

        return quantized_data;
    }

    compressGeometryMeshopt(options, gltf) {
        const align4Bytes = (num) => 4 * Math.floor((num - 1) / 4) + 4;
        const should_reorder = options.reorder;
        const moptDecoder = gltf.moptDecoder;
        const moptEncoder = gltf.moptEncoder;
        const moptFilters = {
            'NONE': (source, count, stride, bits, mode) => source,
            'OCTAHEDRAL': (source, count, stride, bits, mode) => moptEncoder.encodeFilterOct(source, count, stride, bits),
            'QUATERNION': (source, count, stride, bits, mode) => moptEncoder.encodeFilterQuat(source, count, stride, bits),
            'EXPONENTIAL': (source, count, stride, bits, mode) => moptEncoder.encodeFilterExp(source, count, stride, bits, mode)
        };
        const moptFilterMethods = {
            'NORMAL': (options) => options.normalFilter,
            'POSITION': (options) => options.positionFilter,
            'TANGENT': (options) => options.tangentFilter,
            'TEXCOORD_0': (options) => options.tex0Filter,
            'TEXCOORD_1': (options) => options.tex1Filter
        };
        const moptFilterModes = {
            'NORMAL': (options) => options.normalFilterMode,
            'POSITION': (options) => options.positionFilterMode,
            'TANGENT': (options) => options.tangentFilterMode,
            'TEXCOORD_0': (options) => options.tex0FilterMode,
            'TEXCOORD_1': (options) => options.tex1FilterMode
        };
        const moptFilterBits = {
            'NORMAL': (options) => options.normalFilterBits,
            'POSITION': (options) => options.positionFilterBits,
            'TANGENT': (options) => options.tangentFilterBits,
            'TEXCOORD_0': (options) => options.tex0FilterBits,
            'TEXCOORD_1': (options) => options.tex1FilterBits
        };
        const reorder = (reordered_data, data, remap, compCount) => {
            for (let i = 0; i < (data.length / compCount); ++i)
                for (let j = 0; j < compCount; ++j)
                    reordered_data[compCount * remap[i] + j] = data[i * compCount + j];
        };
        const bytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

        const indices = (this.indices !== undefined) ? gltf.accessors[this.indices].getTypedView(gltf) : null;
        const face_count = (this.indices !== undefined) ? indices.length / 3 : 0;
        let unique_ids = -1;
        let remap = [];
        if (indices) {
            const accessor = gltf.accessors[this.indices];
            const byteStride = indices.byteLength / indices.length;
            if (should_reorder) {
                const indices32 = new Uint32Array(indices);
                [remap, unique_ids] = (should_reorder) ? gltf.moptEncoder.reorderMesh(indices32, /* triangles= */ true, /* optsize= */ true) : null;
                for(var i = 0; i < indices32.length; i++) indices[i] = indices32[i];
            }
           
            const indices_encoded = moptEncoder.encodeGltfBuffer(indices, indices.length, byteStride, 'TRIANGLES');

            // create a new buffer
            const buffer = new gltfBuffer();
            buffer.byteLength = indices_encoded.byteLength;
            buffer.buffer = indices_encoded;
            gltf.buffers.push(buffer);

            // create a new bufferView
            const bufferView = new gltfBufferView();
            bufferView.buffer = undefined;
            bufferView.byteOffset = 0;
            bufferView.byteLength = buffer.byteLength;
            bufferView.byteStride = byteStride;
            bufferView.target = GL.ELEMENT_ARRAY_BUFFER;
            bufferView.name = "Compressed " + this.indices.toString();
            bufferView.extensions = { 
                EXT_meshopt_compression: {
                    buffer: gltf.buffers.length - 1,
                    byteOffset: 0,
                    byteLength: buffer.byteLength,
                    byteStride: byteStride,
                    mode: "TRIANGLES",
                    filter: undefined,
                    count: face_count * 3
                }
            };
            gltf.bufferViews.push(bufferView);

            // Create a new accessor for the tangents:
            const accessor_compressed = new gltfAccessor();
            accessor_compressed.bufferView = gltf.bufferViews.length - 1;
            accessor_compressed.byteOffset = 0;
            accessor_compressed.count = face_count * 3;
            accessor_compressed.type = "SCALAR";
            accessor_compressed.componentType = accessor.componentType;
            accessor_compressed.max = accessor.max;
            accessor_compressed.min = accessor.min;
            this.indices = gltf.accessors.length;
            gltf.accessors.push(accessor_compressed);
        }

        for (const glAttribute of this.glAttributes) {
            const attribute = glAttribute.attribute;
            const accessor = gltf.accessors[glAttribute.accessor];
            const compCount = accessor.getComponentCount(accessor.type);
            let compSize = accessor.getComponentSize(accessor.componentType);
            let compType = accessor.componentType;
            let byteStride = compSize * compCount;
            let data = accessor.getTypedView(gltf);
            let normalized = undefined;

            if(attribute == "NORMAL" && options.normalsCompression !== 0) {
                data = new Uint8Array(this.quantize(gltf, accessor, options.normalsCompression, options.normalsCompressionNormalized, remap));
                compType = options.normalsCompression;
                compSize = getComponentDataTypeSize(options.normalsCompression);
                byteStride = align4Bytes(compSize * compCount);
                normalized = options.normalsCompressionNormalized;
            } else if(attribute == "POSITION" && options.positionCompression !== 0) {
                data = new Uint8Array(this.quantize(gltf, accessor, options.positionCompression, options.positionCompressionNormalized, remap, options.offset, options.scale));
                compType = options.positionCompression;
                compSize = getComponentDataTypeSize(options.positionCompression);
                byteStride = align4Bytes(compSize * compCount);
                normalized = options.positionCompressionNormalized;
            } else if(attribute == "TEXCOORD_0" && options.texcoord0Compression !== 0) {
                data = new Uint8Array(this.quantize(gltf, accessor, options.texcoord0Compression, options.texcoord0CompressionNormalized, remap, options.texcoord0CompressionOffset, options.texcoord0CompressionScale));
                compType = options.texcoord0Compression;
                compSize = getComponentDataTypeSize(options.texcoord0Compression);
                byteStride = align4Bytes(compSize * compCount);
                normalized = options.texcoord0CompressionNormalized;
            } else if(attribute == "TEXCOORD_1" && options.texcoord1Compression !== 0) {
                data = new Uint8Array(this.quantize(gltf, accessor, options.texcoord1Compression, options.texcoord1CompressionNormalized, remap, options.texcoord1CompressionOffset, options.texcoord1CompressionScale));
                compType = options.texcoord1Compression;
                compSize = getComponentDataTypeSize(options.texcoord1Compression);
                byteStride = align4Bytes(compSize * compCount);
                normalized = options.texcoord1CompressionNormalized;
            } else if (attribute == "TANGENT" && options.tangentsCompression !== 0) {
                data = new Uint8Array(this.quantize(gltf, accessor, options.tangentsCompression, options.tangentsCompressionNormalized, remap));
                compType = options.tangentsCompression;
                compSize = getComponentDataTypeSize(options.tangentsCompression);
                byteStride = align4Bytes(compSize * compCount);
                normalized = options.tangentsCompressionNormalized;
            }
            
            const filterMethod = moptFilterMethods[attribute](options);
            const filterMode = moptFilterModes[attribute](options);
            const filterBits = moptFilterBits[attribute](options);

            const attr_count = (unique_ids >= 0) ? unique_ids : data.byteLength / byteStride;
            let data_encoded = null;
            let reordered_data = data;
            let decoded = null;
            switch (compType)
            {
            case GL.BYTE: break;
            case GL.UNSIGNED_BYTE: 
                if (remap.length > 0) {
                    reordered_data = new Uint8Array(attr_count * compCount);
                    reorder(reordered_data, data, remap, compCount);
                }
                break;
            case GL.SHORT: break;
            case GL.UNSIGNED_SHORT: break;
            case GL.UNSIGNED_INT: break;
            case GL.FLOAT:
                if (remap.length > 0) {
                    reordered_data = new Float32Array(attr_count * compCount);
                    reorder(reordered_data, data, remap, compCount);
                }
                break;
            }
            
            const reordered_filtered_data = moptFilters[filterMethod](reordered_data, attr_count, byteStride, filterBits, filterMode);
            data_encoded = moptEncoder.encodeGltfBuffer(reordered_filtered_data, attr_count, byteStride, 'ATTRIBUTES');
    
            console.log('filterMethod', filterMethod);
            console.log('filterMode', filterMode);
            console.log('filterBits', filterBits);
            console.log('byteStride', byteStride);
            console.log('data_encoded', data_encoded);
            
            // create a new buffer
            const buffer = new gltfBuffer();
            buffer.byteLength = data_encoded.byteLength;
            buffer.buffer = data_encoded;
            gltf.buffers.push(buffer);

            // create a new bufferView
            const bufferView = new gltfBufferView();
            bufferView.buffer = undefined;
            bufferView.byteOffset = 0;
            bufferView.byteLength = buffer.byteLength;
            bufferView.byteStride = byteStride;
            bufferView.target = GL.ARRAY_BUFFER;
            bufferView.name = "Meshopt Compressed " + glAttribute.accessor.toString();
            bufferView.extensions = {
                EXT_meshopt_compression: {
                    buffer: gltf.buffers.length - 1,
                    byteOffset: 0,
                    byteLength: buffer.byteLength,
                    byteStride: byteStride,
                    mode: "ATTRIBUTES",
                    filter: filterMethod,
                    count: attr_count
                }
            };
            gltf.bufferViews.push(bufferView);

            // Create a new accessor for the tangents:
            const accessor_compressed = new gltfAccessor();
            accessor_compressed.bufferView = gltf.bufferViews.length - 1;
            accessor_compressed.byteOffset = 0;
            accessor_compressed.count = attr_count;
            accessor_compressed.type = accessor.type;
            accessor_compressed.componentType = compType;
            accessor_compressed.normalized = normalized;
            accessor_compressed.min = accessor.min;
            accessor_compressed.max = accessor.max;
            gltf.accessors.push(accessor_compressed);
            
            glAttribute.accessor = gltf.accessors.length - 1;
            this.attributes[attribute] = glAttribute.accessor;
        }
    }

    compressGeometryQuantize(options, gltf){
        
        for (const glAttribute of this.glAttributes)
        {
            const attribute = glAttribute.attribute;
            const idx = this.attributes[attribute];
            let cidx = idx;
            // Compressor - Debug (Create fake buffers)
            if(attribute == "NORMAL" && options.normalsCompression !== 0)
            {
                cidx = quantize(gltf, gltf.accessors[idx], options.normalsCompression, options.normalsCompressionNormalized);
            }
            else if(attribute == "POSITION" && options.positionCompression !== 0)
            {
                cidx = quantize(gltf, gltf.accessors[idx], options.positionCompression, options.positionCompressionNormalized, options.offset, options.scale);
            }
            else if(attribute == "TEXCOORD_0" && options.texcoord0Compression !== 0)
            {
                cidx = quantize(gltf, gltf.accessors[idx], options.texcoord0Compression, options.texcoord0CompressionNormalized, options.texcoord0CompressionOffset, options.texcoord0CompressionScale);
            }
            else if(attribute == "TEXCOORD_1" && options.texcoord1Compression !== 0)
            {
                cidx = quantize(gltf, gltf.accessors[idx], options.texcoord1Compression, options.texcoord1CompressionNormalized, options.texcoord1CompressionOffset, options.texcoord1CompressionScale);
            }
            else if(attribute == "TANGENT" && options.tangentsCompression !== 0)
            {
                cidx = quantize(gltf, gltf.accessors[idx], options.tangentsCompression, options.tangentsCompressionNormalized);
            }
            glAttribute.accessor = cidx;
            this.attributes[attribute] = cidx;
        }
    }

    compressGeometry(type, options, gltf)
    {    
        if(type === GEOMETRY_COMPRESSION_TYPE.QUANTIZATION)
            this.compressGeometryQuantize(options, gltf);
        else if(type === GEOMETRY_COMPRESSION_TYPE.DRACO)
            this.compressGeometryDRACO(options, gltf);
        else
            this.compressGeometryMeshopt(options, gltf);

        this.computeCentroid(gltf);
    }

    getGPUSize(gltf) {
        let size = 0;
        for (const glAttribute of this.glAttributes)
        {
            const attribute = glAttribute.attribute;
            const idx = this.attributes[attribute];

            size += gltf.accessors[idx].getSize();
        }
        return size;
    }

    getSize(gltf)
    {
        let size = 0;
        if (this.extensions && this.extensions.KHR_draco_mesh_compression) {
            const bufferView = this.extensions.KHR_draco_mesh_compression.bufferView;
            return gltf.bufferViews[bufferView].byteLength;
        }
        for (const glAttribute of this.glAttributes)
        {
            const attribute = glAttribute.attribute;
            const idx = this.attributes[attribute];
            const accessor   = gltf.accessors[idx];
            const bufferView = gltf.bufferViews[accessor.bufferView];
            if (bufferView.extensions && bufferView.extensions.EXT_meshopt_compression) {
                size += bufferView.extensions.EXT_meshopt_compression.byteLength;
            } else {
                size += accessor.getSize();
            }
        }

        // AV: Compute Animation & Morph Target size ?
        // size += ...

        return size;
    }

    getAABB(gltf) 
    {
        const positionsAccessor = gltf.accessors[this.attributes.POSITION];
        //const positions = positionsAccessor.getNormalizedTypedView(gltf);
        const positions = positionsAccessor.getNormalizedDeinterlacedView(gltf);

        const minValue = new Float32Array([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]);
        const maxValue = new Float32Array([-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE]);

        if(this.indices !== undefined)
        {
            // Primitive has indices.
            const indicesAccessor = gltf.accessors[this.indices];
            const indices = indicesAccessor.getTypedView(gltf);

            for(let i = 0; i < indices.length; i++) {
                const offset = 3 * indices[i];
                minValue[0] = Math.min(minValue[0], positions[offset]);
                minValue[1] = Math.min(minValue[1], positions[offset + 1]);
                minValue[2] = Math.min(minValue[2], positions[offset + 2]);
                maxValue[0] = Math.max(maxValue[0], positions[offset]);
                maxValue[1] = Math.max(maxValue[1], positions[offset + 1]);
                maxValue[2] = Math.max(maxValue[2], positions[offset + 2]);
            }
        }
        else
        {
            // Primitive does not have indices.
            for(let i = 0; i < positions.length; i += 3) {
                minValue[0] = Math.min(minValue[0], positions[i]);
                minValue[1] = Math.min(minValue[1], positions[i + 1]);
                minValue[2] = Math.min(minValue[2], positions[i + 2]);
                maxValue[0] = Math.max(maxValue[0], positions[i]);
                maxValue[1] = Math.max(maxValue[1], positions[i + 1]);
                maxValue[2] = Math.max(maxValue[2], positions[i + 2]);
            }
        }
        return {minValue, maxValue};
    }

    // texcoord should be TEXCOORD_0 or TEXCOORD_1
    getTexcoordsAABB(gltf, texcoord) 
    {
        if(
            (texcoord === "TEXCOORD_0" && this.attributes.TEXCOORD_0 === undefined) ||
            (texcoord === "TEXCOORD_1" && this.attributes.TEXCOORD_1 === undefined)
        )
        {
            return {bboxMin: null, bboxMax: null, hasTexcoord: false};
        }

        const texcoordAccessor = texcoord === "TEXCOORD_0"? gltf.accessors[this.attributes.TEXCOORD_0] : gltf.accessors[this.attributes.TEXCOORD_1];
        //const texcoords = texcoordAccessor.getNormalizedTypedView(gltf);
        const texcoords = texcoordAccessor.getNormalizedDeinterlacedView(gltf);

        const minValue = new Float32Array([Number.MAX_VALUE, Number.MAX_VALUE]);
        const maxValue = new Float32Array([-Number.MAX_VALUE, -Number.MAX_VALUE]);

        if(this.indices !== undefined)
        {
            // Primitive has indices.
            const indicesAccessor = gltf.accessors[this.indices];
            const indices = indicesAccessor.getTypedView(gltf);

            for(let i = 0; i < indices.length; i++) {
                const offset = 2 * indices[i];
                minValue[0] = Math.min(minValue[0], texcoords[offset]);
                minValue[1] = Math.min(minValue[1], texcoords[offset + 1]);
                maxValue[0] = Math.max(maxValue[0], texcoords[offset]);
                maxValue[1] = Math.max(maxValue[1], texcoords[offset + 1]);
            }
        }
        else
        {
            // Primitive does not have indices.
            for(let i = 0; i < texcoords.length; i += 2) {
                minValue[0] = Math.min(minValue[0], texcoords[i]);
                minValue[1] = Math.min(minValue[1], texcoords[i + 1]);
                maxValue[0] = Math.max(maxValue[0], texcoords[i]);
                maxValue[1] = Math.max(maxValue[1], texcoords[i + 1]);
            }
        }
        return {minValue, maxValue, hasTexcoord: true};
    }

    copyFromPrimitive(originalPrimitive)
    {
        /*for (let k of Object.keys(originalPrimitive)) {
            this[k] = originalPrimitive[k];
        }*/
        this.attributes = {...originalPrimitive.attributes};
        this.targets = originalPrimitive.targets;
        this.indices = originalPrimitive.indices;
        this.material = originalPrimitive.material;
        this.mode = originalPrimitive.mode;

        // non gltf
        this.glAttributes = originalPrimitive.glAttributes.map(prim => {
            return {...prim};
        });
        this.morphTargetTextureInfo = originalPrimitive.morphTargetTextureInfo;
        this.defines = originalPrimitive.defines;
        this.skip = originalPrimitive.skip;
        this.hasWeights = originalPrimitive.hasWeights;
        this.hasJoints = originalPrimitive.hasJoints;
        this.hasNormals = originalPrimitive.hasNormals;
        this.hasTangents = originalPrimitive.hasTangents;
        this.hasTexcoord = originalPrimitive.hasTexcoord;
        this.hasColor = originalPrimitive.hasColor;

        // The primitive centroid is used for depth sorting.
        this.centroid = originalPrimitive.centroid;

        this.originalMaterial = originalPrimitive.originalMaterial;
        this.isHighlighted = originalPrimitive.isHighlighted;
    }

    isMeshQuantized(gltf){
        for (const attribute of this.glAttributes)
            if (attribute !== undefined){
                let isQuantized = (attribute.attribute === 'POSITION'   && gltf.accessors[attribute.accessor].componentType !== GL.FLOAT) ||
                                  (attribute.attribute === 'NORMAL'     && gltf.accessors[attribute.accessor].componentType !== GL.FLOAT) ||
                                  (attribute.attribute === 'TANGENT'    && gltf.accessors[attribute.accessor].componentType !== GL.FLOAT) || 
                                  ((attribute.attribute === 'TEXCOORD_0' || attribute.attribute === 'TEXCOORD_1')  && [GL.FLOAT, GL.UNSIGNED_BYTE, GL.UNSIGNED_SHORT].includes(gltf.accessors[attribute.accessor].componentType) === false);
                if(isQuantized)
                    return true;
            }
        return false;
    }

    isDracoMeshCompressed(){
        return (this.extensions !== undefined) ? this.extensions.KHR_draco_mesh_compression !== undefined : false;
    }

    isMeshOptCompressed(gltf){       
        for (const bufferView of gltf.bufferViews){
            if( bufferView !== undefined && 
                bufferView.extensions !== undefined &&
                bufferView.extensions.EXT_meshopt_compression !== undefined
            )
                return true;
        }
        return false;
    }
}

export { gltfPrimitive };

