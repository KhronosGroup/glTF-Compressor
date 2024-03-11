import { vec3, vec2, mat4, quat } from 'gl-matrix';
import { jsToGl } from './utils.js';
import { GltfObject } from './gltf_object.js';
import { gltfMesh } from './mesh.js';
import { ComponentDataType, isComponentDataTypeUnsigned, getComponentDataTypeDistinctIntegerNumbers } from '../geometry_compressor.js';

// contain:
// transform
// child indices (reference to scene array of nodes)

class gltfNode extends GltfObject
{
    constructor()
    {
        super();
        this.camera = undefined;
        this.children = [];
        this.matrix = undefined;
        this.rotation = jsToGl([0, 0, 0, 1]);
        this.scale = jsToGl([1, 1, 1]);
        this.translation = jsToGl([0, 0, 0]);
        this.name = undefined;
        this.mesh = undefined;
        this.skin = undefined;

        // non gltf
        this.worldTransform = mat4.create();
        this.inverseWorldTransform = mat4.create();
        this.normalMatrix = mat4.create();
        this.light = undefined;
        this.changed = true;

        this.animationRotation = undefined;
        this.animationTranslation = undefined;
        this.animationScale = undefined;

        // GLTF-Compressor
        this.compressedNode = undefined;
        this.isCompressedHelperNode = false;
        this.compressedMesh = undefined; // object
    }

    initGl()
    {
        if (this.matrix !== undefined)
        {
            this.applyMatrix(this.matrix);
        }
        else
        {
            if (this.scale !== undefined)
            {
                this.scale = jsToGl(this.scale);
            }

            if (this.rotation !== undefined)
            {
                this.rotation = jsToGl(this.rotation);
            }

            if (this.translation !== undefined)
            {
                this.translation = jsToGl(this.translation);
            }
        }
        this.changed = true;
    }

    applyMatrix(matrixData)
    {
        this.matrix = jsToGl(matrixData);

        mat4.getScaling(this.scale, this.matrix);

        // To extract a correct rotation, the scaling component must be eliminated.
        const mn = mat4.create();
        for(const col of [0, 1, 2])
        {
            mn[col] = this.matrix[col] / this.scale[0];
            mn[col + 4] = this.matrix[col + 4] / this.scale[1];
            mn[col + 8] = this.matrix[col + 8] / this.scale[2];
        }
        mat4.getRotation(this.rotation, mn);
        quat.normalize(this.rotation, this.rotation);

        mat4.getTranslation(this.translation, this.matrix);

        this.changed = true;
    }

    // vec3
    applyTranslationAnimation(translation)
    {
        this.animationTranslation = translation;
        this.changed = true;
    }

    // quat
    applyRotationAnimation(rotation)
    {
        this.animationRotation = rotation;
        this.changed = true;
    }

    // vec3
    applyScaleAnimation(scale)
    {
        this.animationScale = scale;
        this.changed = true;
    }

    resetTransform()
    {
        this.rotation = jsToGl([0, 0, 0, 1]);
        this.scale = jsToGl([1, 1, 1]);
        this.translation = jsToGl([0, 0, 0]);
        this.changed = true;
    }

    getLocalTransform()
    {
        if(this.transform === undefined || this.changed)
        {
            // if no animation is applied and the transform matrix is present use it directly
            if(this.animationTranslation === undefined && this.animationRotation === undefined && this.animationScale === undefined && this.matrix !== undefined) {
                this.transform = mat4.clone(this.matrix);
            } else {
                this.transform = mat4.create();
                const translation = this.animationTranslation !== undefined ? this.animationTranslation : this.translation;
                const rotation = this.animationRotation !== undefined ? this.animationRotation : this.rotation;
                const scale = this.animationScale !== undefined ? this.animationScale : this.scale;
                mat4.fromRotationTranslationScale(this.transform, rotation, translation, scale);
            }
            this.changed = false;
        }

        return mat4.clone(this.transform);
    }

    // gltf compressor
    compressGeometry(type, options, gltf)
    {
        //debugger;
        // if the node has a mesh that we can compress. If compressedMesh exists, then we are in a compressedHelperNode
        if(this.mesh != undefined && this.compressedMesh == undefined)
        {
            const currentMesh = gltf.meshes[this.mesh];
            // first check if we have not already compressed this mesh
            if(this.compressedNode === undefined)
            {
                // create a compression node
                const node = new gltfNode();
                this.compressedNode = node;
                node.isCompressedHelperNode = true;

                // add as a children
                this.children.push(gltf.nodes.length);
                // add to the global pool of nodes
                gltf.nodes.push(node);

                // create a new compressed mesh 
                node.compressedMesh = new gltfMesh();
                node.compressedMesh.copyFromMesh(currentMesh);
                node.compressedMesh.isCompressed = true;
                node.compressedMesh.mesh = gltf.meshes.length;
                node.compressedMesh.original_mesh = this.mesh;
                node.skin = this.skin;
                node.weights = this.weights;
                
                gltf.meshes.push(node.compressedMesh);
            }
            const node = this.compressedNode;
            node.compressedMesh.copyFromMesh(currentMesh);


            {
                const {bboxMin, bboxMax} = gltf.meshes[this.mesh].getAABB(gltf);
                const {bboxMin: texcoord0bboxMin, bboxMax: texcoord0bboxMax, hasTexcoord: texcoord0HasTexcoord} = gltf.meshes[this.mesh].getTexcoordsAABB(gltf, "TEXCOORD_0");
                const {bboxMin: texcoord1bboxMin, bboxMax: texcoord1bboxMax, hasTexcoord: texcoord1HasTexcoord} = gltf.meshes[this.mesh].getTexcoordsAABB(gltf, "TEXCOORD_1");

                if(options.texcoord0Compression !== 0 && options.texcoord0Compression !== ComponentDataType.FLOAT && texcoord0HasTexcoord)
                {
                    const maxComponentDataRange = options.texcoord0CompressionNormalized? 1 : getComponentDataTypeDistinctIntegerNumbers(options.texcoord0Compression);
                    const scaleMultiplier = isComponentDataTypeUnsigned(options.texcoord0Compression)? 1.0 : 0.5;
                    const center = vec2.fromValues(
                        0.5 * (texcoord0bboxMin[0] + texcoord0bboxMax[0]),
                        0.5 * (texcoord0bboxMin[1] + texcoord0bboxMax[1])
                    );
                    
                    options.texcoord0CompressionOffset = vec2.negate(vec3.create(), isComponentDataTypeUnsigned(options.texcoord0Compression)? texcoord0bboxMin : center);
                    // Scale uniformly similar to positions
                    options.texcoord0CompressionScale = maxComponentDataRange / Math.max(
                        scaleMultiplier * (texcoord0bboxMax[0] - texcoord0bboxMin[0]),
                        scaleMultiplier * (texcoord0bboxMax[1] - texcoord0bboxMin[1]),
                    );
                }
                if(options.texcoord1Compression !== 0 && options.texcoord1Compression !== ComponentDataType.FLOAT && texcoord1HasTexcoord)
                {
                    const maxComponentDataRange = options.texcoord1CompressionNormalized? 1 : getComponentDataTypeDistinctIntegerNumbers(options.texcoord1Compression);
                    const scaleMultiplier = isComponentDataTypeUnsigned(options.texcoord1Compression)? 1.0 : 0.5;
                    const center = vec2.fromValues(
                        0.5 * (texcoord1bboxMin[0] + texcoord1bboxMax[0]),
                        0.5 * (texcoord1bboxMin[1] + texcoord1bboxMax[1])
                    );
                    
                    options.texcoord1CompressionOffset = vec2.negate(vec3.create(), isComponentDataTypeUnsigned(options.texcoord1Compression)? texcoord1bboxMin : center);
                    options.texcoord1CompressionScale = maxComponentDataRange / Math.max(
                        scaleMultiplier * (texcoord1bboxMax[0] - texcoord1bboxMin[0]),
                        scaleMultiplier * (texcoord1bboxMax[1] - texcoord1bboxMin[1]),
                    );
                }

                if(options.positionCompressionNormalized && options.positionCompression !== 0)
                {
                    // rescale into [-1...1]
                    const center = vec3.fromValues(
                        0.5 * (bboxMin[0] + bboxMax[0]),
                        0.5 * (bboxMin[1] + bboxMax[1]),
                        0.5 * (bboxMin[2] + bboxMax[2])
                    );

                    const bboxMaxSide = Math.max(
                        bboxMax[0] - bboxMin[0],
                        bboxMax[1] - bboxMin[1],
                        bboxMax[2] - bboxMin[2]
                    );

                    let scaleToOriginal = 0.5*Math.max(
                        bboxMax[0] - bboxMin[0],
                        bboxMax[1] - bboxMin[1],
                        bboxMax[2] - bboxMin[2]
                    );

                    if(isComponentDataTypeUnsigned(options.positionCompression))
                    {
                        scaleToOriginal *= 2.0;
                    }

                    const origin = isComponentDataTypeUnsigned(options.positionCompression)? vec3.fromValues(bboxMin[0], bboxMin[1], bboxMin[2]) : center;

                    const scaleToUnitLength = 1.0 / scaleToOriginal; // S = 2 / (max-min)                                
                    const translationToUnitLength = vec3.negate(vec3.create(), origin);
                
                    // TRS matrix order
                    node.translation = vec3.negate(vec3.create(), translationToUnitLength);
                    node.scale = vec3.fromValues(scaleToOriginal, scaleToOriginal, scaleToOriginal);
                    node.changed = true;

                    node.compressedMesh.compressGeometry(type, {...options, offset: translationToUnitLength, scale: scaleToUnitLength}, gltf);

                    const {bboxMin: compressed_bboxMin, bboxMax: compressed_bboxMax} = node.compressedMesh.getAABB(gltf);
                    const {bboxMin: compressed_texcoord0bboxMin, bboxMax: compressed_texcoord0bboxMax, hasTexcoord: compressed_texcoord0HasTexcoord} = node.compressedMesh.getTexcoordsAABB(gltf, "TEXCOORD_0");
                    const {bboxMin: compressed_texcoord1bboxMin, bboxMax: compressed_texcoord1bboxMax, hasTexcoord: compressed_texcoord1HasTexcoord} = node.compressedMesh.getTexcoordsAABB(gltf, "TEXCOORD_1");

                    let scaled_compressed_bbox_min = vec3.multiply(vec3.create(), compressed_bboxMin, vec3.fromValues(scaleToOriginal,scaleToOriginal,scaleToOriginal));
                    scaled_compressed_bbox_min = vec3.add(vec3.create(), scaled_compressed_bbox_min, origin);
                    let scaled_compressed_bbox_max = vec3.multiply(vec3.create(), compressed_bboxMax, vec3.fromValues(scaleToOriginal,scaleToOriginal,scaleToOriginal));
                    scaled_compressed_bbox_max = vec3.add(vec3.create(), scaled_compressed_bbox_max, origin);

                    this.bboxDiffError = {
                        bboxMin: vec3.subtract(vec3.create(), bboxMin, scaled_compressed_bbox_min),
                        bboxMax: vec3.subtract(vec3.create(), bboxMax, scaled_compressed_bbox_max)
                    }       
                }
                else
                {                    
                    // TRS matrix order
                    node.translation = vec3.create();
                    node.scale = vec3.fromValues(1,1,1);
                    node.changed = true;

                    node.compressedMesh.compressGeometry(type, options, gltf);

                    const {bboxMin, bboxMax} = gltf.meshes[this.mesh].getAABB(gltf);
                    const {bboxMin: compressed_bboxMin, bboxMax: compressed_bboxMax} = node.compressedMesh.getAABB(gltf);

                    this.bboxDiffError = {
                        bboxMin: vec3.subtract(vec3.create(), bboxMin, compressed_bboxMin),
                        bboxMax: vec3.subtract(vec3.create(), bboxMax, compressed_bboxMax)
                    }
                }                
            }
        }

        for(const child of this.children)
        {
            gltf.nodes[child].compressGeometry(type, options, gltf);
        }
    }

    // select a node for highlighting
    selectNode(gltf, isSelected = true)
    {
        // if the node has a mesh. highlight it
        if(this.mesh != undefined)
        {
            gltf.meshes[this.mesh].setHighlight(isSelected);
        }

        for(const child of this.children)
        {
            gltf.nodes[child].selectNode(gltf, isSelected);
        }
    }
}

export { gltfNode };
