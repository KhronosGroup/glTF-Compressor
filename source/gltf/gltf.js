import { gltfAccessor } from './accessor.js';
import { gltfBuffer } from './buffer.js';
import { gltfBufferView } from './buffer_view.js';
import { gltfCamera } from './camera.js';
import { gltfImage } from './image.js';
import { gltfLight } from './light.js';
import { ImageBasedLight } from './image_based_light.js';
import { gltfMaterial } from './material.js';
import { gltfMesh } from './mesh.js';
import { gltfNode } from './node.js';
import { gltfSampler } from './sampler.js';
import { gltfScene } from './scene.js';
import { gltfTexture } from './texture.js';
import { initGlForMembers, objectsFromJsons, objectFromJson } from './utils';
import { gltfAsset } from './asset.js';
import { GltfObject } from './gltf_object.js';
import { gltfAnimation } from './animation.js';
import { gltfSkin } from './skin.js';
import { gltfVariant } from './variant.js';

class glTF extends GltfObject
{
    constructor(file)
    {
        super();
        this.asset = undefined;
        this.accessors = [];
        this.nodes = [];
        this.scene = undefined; // the default scene to show.
        this.scenes = [];
        this.cameras = [];
        this.lights = [];
        this.imageBasedLights = [];
        this.textures = [];
        this.images = [];
        this.samplers = [];
        this.meshes = [];
        this.buffers = [];
        this.bufferViews = [];
        this.materials = [];
        this.animations = [];
        this.skins = [];
        this.path = file;

        // gltfCompressor
        this.originalJSON = undefined;
        this.compressionVersion = 0;
        this.primitives = [];
        this.compressedPrimitives = [];
    }

    initGl(webGlContext)
    {
        initGlForMembers(this, this, webGlContext);
    }

    fromJson(json)
    {
        super.fromJson(json);

        this.originalJSON = json;

        this.asset = objectFromJson(json.asset, gltfAsset);
        this.cameras = objectsFromJsons(json.cameras, gltfCamera);
        this.accessors = objectsFromJsons(json.accessors, gltfAccessor);
        this.meshes = objectsFromJsons(json.meshes, gltfMesh);
        this.samplers = objectsFromJsons(json.samplers, gltfSampler);
        this.materials = objectsFromJsons(json.materials, gltfMaterial);
        this.buffers = objectsFromJsons(json.buffers, gltfBuffer);
        this.bufferViews = objectsFromJsons(json.bufferViews, gltfBufferView);
        this.scenes = objectsFromJsons(json.scenes, gltfScene);
        this.textures = objectsFromJsons(json.textures, gltfTexture);
        this.nodes = objectsFromJsons(json.nodes, gltfNode);
        this.lights = objectsFromJsons(getJsonLightsFromExtensions(json.extensions), gltfLight);
        this.imageBasedLights = objectsFromJsons(getJsonIBLsFromExtensions(json.extensions), ImageBasedLight);
        this.images = objectsFromJsons(json.images, gltfImage);
        this.animations = objectsFromJsons(json.animations, gltfAnimation);
        this.skins = objectsFromJsons(json.skins, gltfSkin);
        this.variants = objectsFromJsons(getJsonVariantsFromExtension(json.extensions), gltfVariant);
        this.variants = enforceVariantsUniqueness(this.variants);

        this.materials.push(gltfMaterial.createDefault());
        this.samplers.push(gltfSampler.createDefault());

        if (json.scenes !== undefined)
        {
            if (json.scene === undefined && json.scenes.length > 0)
            {
                this.scene = 0;
            }
            else
            {
                this.scene = json.scene;
            }
        }

        this.computeDisjointAnimations();
    }

    // Computes indices of animations which are disjoint and can be played simultaneously.
    computeDisjointAnimations()
    {
        for (let i = 0; i < this.animations.length; i++)
        {
            this.animations[i].disjointAnimations = [];

            for (let k = 0; k < this.animations.length; k++)
            {
                if (i == k)
                {
                    continue;
                }

                let isDisjoint = true;

                for (const iChannel of this.animations[i].channels)
                {
                    for (const kChannel of this.animations[k].channels)
                    {
                        if (iChannel.target.node === kChannel.target.node
                            && iChannel.target.path === kChannel.target.path)
                        {
                            isDisjoint = false;
                            break;
                        }
                    }
                }

                if (isDisjoint)
                {
                    this.animations[i].disjointAnimations.push(k);
                }
            }
        }
    }

    nonDisjointAnimations(animationIndices)
    {
        const animations = this.animations;
        const nonDisjointAnimations = [];

        for (let i = 0; i < animations.length; i++)
        {
            let isDisjoint = true;
            for (const k of animationIndices)
            {
                if (i == k)
                {
                    continue;
                }

                if (!animations[k].disjointAnimations.includes(i))
                {
                    isDisjoint = false;
                }
            }

            if (!isDisjoint)
            {
                nonDisjointAnimations.push(i);
            }
        }

        return nonDisjointAnimations;
    }

    findPrimitive(prim)
    {
        return this.primitives.findIndex(e => {
            const sameMode = e.mode == prim.mode;
            const sameIndices = e.indices == prim.indices;
            const samePositions = e.attributes.POSITION == prim.attributes.POSITION;
            const sameNormals = e.attributes.NORMAL == prim.attributes.NORMAL;
            const sameTangents = e.attributes.TANGENT == prim.attributes.TANGENT;
            const sameTEXCOORD_0 = e.attributes.TEXCOORD_0 == prim.attributes.TEXCOORD_0;
            const sameTEXCOORD_1 = e.attributes.TEXCOORD_1 == prim.attributes.TEXCOORD_1;
            const sameCOLOR_0 = e.attributes.COLOR_0 == prim.attributes.COLOR_0;
            const sameJOINTS_0 = e.attributes.JOINTS_0 == prim.attributes.JOINTS_0;
            const sameWEIGHTS_0 = e.attributes.WEIGHTS_0 == prim.attributes.WEIGHTS_0;

            return sameMode && sameIndices && samePositions && sameNormals && sameTangents && sameTEXCOORD_0 && sameTEXCOORD_1 && sameCOLOR_0 && sameJOINTS_0 && sameWEIGHTS_0;
        });
    }

    fillPrimitiveList()
    {
        this.compressionVersion = 0;
        for(const mesh of this.meshes)
        {
            for(const primitive of mesh.primitives)
            {
                if(this.findPrimitive(primitive) == -1)
                {
                    primitive.compress_revision = -1;
                    this.primitives.push(primitive);
                    this.compressedPrimitives.push(primitive);
                }
            }
        }
    }
}

function getJsonLightsFromExtensions(extensions)
{
    if (extensions === undefined)
    {
        return [];
    }
    if (extensions.KHR_lights_punctual === undefined)
    {
        return [];
    }
    return extensions.KHR_lights_punctual.lights;
}

function getJsonIBLsFromExtensions(extensions)
{
    if (extensions === undefined)
    {
        return [];
    }
    if (extensions.KHR_lights_image_based === undefined)
    {
        return [];
    }
    return extensions.KHR_lights_image_based.imageBasedLights;
}

function getJsonVariantsFromExtension(extensions)
{
    if (extensions === undefined)
    {
        return [];
    }
    if (extensions.KHR_materials_variants === undefined)
    {
        return [];
    }
    return extensions.KHR_materials_variants.variants;
}

function enforceVariantsUniqueness(variants)
{
    for(let i=0;i<variants.length;i++)
    {
        const name = variants[i].name;
        for(let j=i+1;j<variants.length;j++)
        {
            if(variants[j].name == name)
            {
                variants[j].name += "0";  // Add random character to duplicates
            }
        }
    }


    return variants;
}

export {
    glTF,
    gltfAccessor,
    gltfBuffer,
    gltfCamera,
    gltfImage,
    gltfLight,
    gltfMaterial,
    gltfMesh,
    gltfNode,
    gltfSampler,
    gltfScene,
    gltfTexture,
    gltfAsset,
    GltfObject,
    gltfAnimation,
    gltfSkin,
    gltfVariant
};
