import { gltfPrimitive } from './primitive.js';
import { objectsFromJsons } from './utils.js';
import { GltfObject } from './gltf_object.js';
import { gltfMaterial } from './material.js';
import { ComponentDataType } from './../geometry_compressor.js'

class gltfMesh extends GltfObject
{
    constructor()
    {
        super();
        this.primitives = [];
        this.name = undefined;
        this.weights = [];

        // non gltf
        this.weightsAnimated = undefined;

        // GLTF-Compressor
        this.isCompressed = false;
    }

    fromJson(jsonMesh)
    {
        super.fromJson(jsonMesh);

        if (jsonMesh.name !== undefined)
        {
            this.name = jsonMesh.name;
        }

        this.primitives = objectsFromJsons(jsonMesh.primitives, gltfPrimitive);

        if(jsonMesh.weights !== undefined)
        {
            this.weights = jsonMesh.weights;
        }
    }

    getWeightsAnimated()
    {
        return this.weightsAnimated !== undefined ? this.weightsAnimated : this.weights;
    }

    getAABB(gltf)
    {
        const bboxMin = new Float32Array([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]);
        const bboxMax = new Float32Array([-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE]);
        
        // compute the AABB of all primitives
        for(const primitive of this.primitives)
        {            
            const {minValue, maxValue} = primitive.getAABB(gltf);
            bboxMin[0] = Math.min(bboxMin[0], minValue[0]);
            bboxMin[1] = Math.min(bboxMin[1], minValue[1]);
            bboxMin[2] = Math.min(bboxMin[2], minValue[2]);

            bboxMax[0] = Math.max(bboxMax[0], maxValue[0]);
            bboxMax[1] = Math.max(bboxMax[1], maxValue[1]);
            bboxMax[2] = Math.max(bboxMax[2], maxValue[2]);
        }
        return {bboxMin, bboxMax};
    }

    getTexcoordsAABB(gltf, texcoord)
    {
        const bboxMin = new Float32Array([Number.MAX_VALUE, Number.MAX_VALUE]);
        const bboxMax = new Float32Array([-Number.MAX_VALUE, -Number.MAX_VALUE]);
        let meshHasTexcoord = false;
        
        // compute the AABB of all primitives
        for(const primitive of this.primitives)
        {            
            const {minValue, maxValue, hasTexcoord} = primitive.getTexcoordsAABB(gltf, texcoord);
            if(!hasTexcoord)
                continue;
            
            meshHasTexcoord = true;
            bboxMin[0] = Math.min(bboxMin[0], minValue[0]);
            bboxMin[1] = Math.min(bboxMin[1], minValue[1]);

            bboxMax[0] = Math.max(bboxMax[0], maxValue[0]);
            bboxMax[1] = Math.max(bboxMax[1], maxValue[1]);
        }
        return {bboxMin, bboxMax, hasTexcoord: meshHasTexcoord};
    }

    compressGeometry(type, options, gltf)
    {     
        for(const primitive of this.primitives)
        {
            const originalIndex = gltf.findPrimitive(primitive);
            const original = gltf.primitives[originalIndex];
            const compressed = gltf.compressedPrimitives[originalIndex];

            // if version is different, compress the primtive, else copy from the compressed one
            if(compressed.compress_revision != gltf.compressionVersion)
            {                
                primitive.compressGeometry(type, options, gltf);
                primitive.compress_revision = gltf.compressionVersion;
                gltf.compressedPrimitives[originalIndex] = primitive;
            }
            else
            {
                const originalMaterial = primitive.material;
                primitive.copyFromPrimitive(compressed);  
                primitive.material = originalMaterial;              
            } 
        }

        const hasTexcoord0 = this.primitives.some(e => e.attributes.TEXCOORD_0 !== undefined);
        const hasTexcoord1 = this.primitives.some(e => e.attributes.TEXCOORD_1 !== undefined);
        const hasVolume = this.primitives.some(e => gltf.materials[e.material].hasVolume);

        // update materials. // TODO: Also make it work for texcoord1
        if(hasVolume || (options.texcoord0Compression && hasTexcoord0) || (options.texcoord1Compression && hasTexcoord1))
        {
            const materialIDs = new Map(); //(old, new)
            for(const primitive of this.primitives)
            {
                // (key, value)
                if(primitive.originalMaterial === -1)
                {
                    materialIDs.set(primitive.material, -1);
                }
                else
                {
                    // TODO: Need rethinking for the case of recompression
                    materialIDs.set(primitive.originalMaterial, primitive.material);
                }
            }
            // (value, key)
            materialIDs.forEach((cid, id) => {
                // create a new material
                const material = gltfMaterial.createDefault();
                material.copyFromMaterial(gltf.materials[id]);
                if(material.hasVolume)
                {
                    let thicknessFactor = material.extensions.KHR_materials_volume.thicknessFactor ?? 0.0;
                    thicknessFactor = thicknessFactor * (options.scale? options.scale : 1.0);
                    material.extensions.KHR_materials_volume.thicknessFactor = thicknessFactor;
                    material.properties.set("u_ThicknessFactor", thicknessFactor);
                }
                const extension0 = options.texcoord0Compression && options.texcoord0Compression != ComponentDataType.FLOAT && {
                    extensions: {
                        KHR_texture_transform: {
                          offset: [-options.texcoord0CompressionOffset[0], -options.texcoord0CompressionOffset[1]],
                          scale: [1.0 / options.texcoord0CompressionScale, 1.0 / options.texcoord0CompressionScale]
                        }
                    }
                }
                const extension1 = options.texcoord1Compression && options.texcoord1Compression != ComponentDataType.FLOAT && {
                    extensions: {
                        KHR_texture_transform: {
                          offset: [-options.texcoord1CompressionOffset[0], -options.texcoord1CompressionOffset[1]],
                          scale: [1.0 / options.texcoord1CompressionScale, 1.0 / options.texcoord1CompressionScale]
                        }
                    }
                }
                // TODO: Need to merge with existing Transform Extension
                const mergeTextureTransform = (textureInfo, textureKey) => {
                    if(textureInfo)
                    {
                        // merge
                        if(textureInfo.extensions && textureInfo.extensions.KHR_texture_transform)
                        {
                            const originalTextureTransform = textureInfo.extensions.KHR_texture_transform;
                            const texCoord = textureInfo.texCoord?? 0;
                            const newTextureTransform = texCoord == 0? extension0.extensions.KHR_texture_transform : extension1.extensions.KHR_texture_transform;
                            const merged = {...originalTextureTransform, ...newTextureTransform};

                            const originalOffset = (originalTextureTransform.offset !== undefined)? originalTextureTransform.offset : [0,0];
                            const originalScale = (originalTextureTransform.scale !== undefined)? originalTextureTransform.scale : [1,1];
                            //const s = (originalTextureTransform.rotation !== undefined)? Math.sin(originalTextureTransform.rotation) : 0;
                            //const c = (originalTextureTransform.rotation !== undefined)? Math.cos(originalTextureTransform.rotation) : 1;

                            merged.offset = [
                                originalScale[0] * newTextureTransform.offset[0] + originalOffset[0],
                                originalScale[1] * newTextureTransform.offset[1] + originalOffset[1]
                            ]                          
                            
                            if(originalTextureTransform.rotation !== undefined)
                            {
                                const s =  Math.sin(originalTextureTransform.rotation);
                                const c =  Math.cos(originalTextureTransform.rotation);                              

                                merged.offset = [
                                    originalScale[0] * (c * newTextureTransform.offset[0] + s * newTextureTransform.offset[1]) + originalOffset[0],
                                    originalScale[1] * (-s * newTextureTransform.offset[0] + c * newTextureTransform.offset[1]) + originalOffset[1]
                                ]
                                /*merged.offset = [
                                    (c * originalScale[0] * newTextureTransform.offset[0] + s * originalScale[1] * newTextureTransform.offset[1]) + originalOffset[0],
                                    (-s * originalScale[0] * newTextureTransform.offset[0] + c * originalScale[1] * newTextureTransform.offset[1]) + originalOffset[1]
                                ]*/
                            }                            
                            merged.rotation = originalTextureTransform.rotation;
                            merged.scale = [
                                newTextureTransform.scale[0] * originalScale[0],
                                newTextureTransform.scale[1] * originalScale[1]
                            ]

                            textureInfo.extensions.KHR_texture_transform = merged;
                            material.parseTextureInfoExtensions(textureInfo, textureKey);
                        }
                        else
                        {
                            if(options.texcoord0Compression)
                                material.parseTextureInfoExtensions(extension0, textureKey);
                            else if(options.texcoord1Compression)
                                material.parseTextureInfoExtensions(extension1, textureKey);
                        }

                    }

                }
                mergeTextureTransform(material.baseColorTexture, "BaseColor");
                mergeTextureTransform(material.normalTexture, "Normal");
                mergeTextureTransform(material.occlusionTexture, "Occlusion");
                mergeTextureTransform(material.emissiveTexture, "Emissive");
                mergeTextureTransform(material.metallicRoughnessTexture, "MetallicRoughness");

                mergeTextureTransform(material.specularGlossinessTexture, "SpecularGlossiness");
                mergeTextureTransform(material.diffuseTexture, "Diffuse");
                mergeTextureTransform(material.specularTexture, "Specular");
                mergeTextureTransform(material.specularColorTexture, "SpecularColor");

                mergeTextureTransform(material.clearcoatTexture, "Clearcoat");
                mergeTextureTransform(material.clearcoatRoughnessTexture, "ClearcoatRoughness");
                mergeTextureTransform(material.clearcoatNormalTexture, "ClearcoatNormal");

                mergeTextureTransform(material.sheenRoughnessTexture, "SheenRoughness");
                mergeTextureTransform(material.sheenColorTexture, "SheenColor");

                mergeTextureTransform(material.transmissionTexture, "Transmission");

                mergeTextureTransform(material.thicknessTexture, "Thickness");

                mergeTextureTransform(material.iridescenceTexture, "Iridescence");
                mergeTextureTransform(material.iridescenceThicknessTexture, "IridescenceThickness");

                mergeTextureTransform(material.anisotropyTexture, "Anisotropy");

                if(cid == -1)
                {
                    cid = gltf.materials.length;
                    gltf.materials.push(material);
                }
                else
                {
                    gltf.materials[cid] = material;
                }
                materialIDs[id] = cid;
            })
            for(const primitive of this.primitives)
            {
                primitive.originalMaterial = primitive.material;
                primitive.material = materialIDs[primitive.material];                
            }
        }
    }

    copyFromMesh(originalMesh)
    {
        this.primitives = originalMesh.primitives.map(prim => { 
            const p = new gltfPrimitive();
            p.copyFromPrimitive(prim);
            return p;
        });
        this.name = "Compressed "+originalMesh.name;
        this.weights = originalMesh.weights;
        this.weightsAnimated = originalMesh.weightsAnimated;
        this.extensions = originalMesh.extensions;
        this.extras = originalMesh.extras;
    }

    setHighlight(isSelected = true)
    {     
        for(const primitive of this.primitives)
        {
            primitive.isHighlighted = isSelected;
        }
    }
}

export { gltfMesh };
