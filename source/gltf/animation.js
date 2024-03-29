import { GltfObject } from './gltf_object.js';
import { objectsFromJsons } from './utils.js';
import { gltfAnimationChannel, InterpolationPath } from './channel.js';
import { gltfAnimationSampler } from './animation_sampler.js';
import { gltfInterpolator } from './interpolator.js';

class gltfAnimation extends GltfObject
{
    constructor()
    {
        super();
        this.channels = [];
        this.samplers = [];
        this.name = '';

        // not gltf
        this.interpolators = [];
        this.maxTime = 0;
        this.disjointAnimations = [];
    }

    fromJson(jsonAnimation)
    {
        super.fromJson(jsonAnimation);

        this.channels = objectsFromJsons(jsonAnimation.channels, gltfAnimationChannel);
        this.samplers = objectsFromJsons(jsonAnimation.samplers, gltfAnimationSampler);
        this.name = jsonAnimation.name;

        if(this.channels === undefined)
        {
            console.error("No channel data found for skin");
            return;
        }

        for(let i = 0; i < this.channels.length; ++i)
        {
            this.interpolators.push(new gltfInterpolator());
        }
    }

    // advance the animation, if totalTime is undefined, the animation is deactivated
    advance(gltf, totalTime)
    {
        if(this.channels === undefined)
        {
            return;
        }

        if(this.maxTime == 0)
        {
            for(let i = 0; i < this.channels.length; ++i)
            {
                const channel = this.channels[i];
                const sampler = this.samplers[channel.sampler];
                const input = gltf.accessors[sampler.input].getDeinterlacedView(gltf);
                const max = input[input.length - 1];
                if(max > this.maxTime)
                {
                    this.maxTime = max;
                }
            }
        }

        for(let i = 0; i < this.interpolators.length; ++i)
        {
            const channel = this.channels[i];
            const sampler = this.samplers[channel.sampler];
            const interpolator = this.interpolators[i];

            const node = gltf.nodes[channel.target.node];

            switch(channel.target.path)
            {
            case InterpolationPath.TRANSLATION:
                const translate = interpolator.interpolate(gltf, channel, sampler, totalTime, 3, this.maxTime);
                node.applyTranslationAnimation(translate);
                if (!node.compressedNode) break;
                node.compressedNode.applyTranslationAnimation(translate);
                break;
            case InterpolationPath.ROTATION:
                const rotate = interpolator.interpolate(gltf, channel, sampler, totalTime, 4, this.maxTime);
                node.applyRotationAnimation(rotate);
                if (!node.compressedNode) break;
                node.compressedNode.applyRotationAnimation(rotate);
                break;
            case InterpolationPath.SCALE:
                const scale = interpolator.interpolate(gltf, channel, sampler, totalTime, 3, this.maxTime);
                node.applyScaleAnimation(scale);
                if (!node.compressedNode) break;
                node.compressedNode.applyScaleAnimation(scale);
                break;
            case InterpolationPath.WEIGHTS:
            {
                const mesh = gltf.meshes[node.mesh];
                mesh.weightsAnimated = interpolator.interpolate(gltf, channel, sampler, totalTime, mesh.weights.length, this.maxTime);
                if (!node.compressedNode) break;
                const c_mesh = node.compressedNode.compressedMesh;
                c_mesh.weightsAnimated = mesh.weightsAnimated && mesh.weightsAnimated.map((e, i) => e / node.compressedNode.scale[i % 3]);
                break;
            }
            }
        }
    }
}

export { gltfAnimation };
