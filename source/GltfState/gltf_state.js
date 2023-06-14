import { UserCamera } from '../gltf/user_camera.js';
import { AnimationTimer } from '../gltf/utils.js';

/**
 * GltfState containing a state for visualization in GltfView
 */
class GltfState
{
    /**
     * GltfState represents all state that can be visualized in a view. You could have
     * multiple GltfStates configured and switch between them on demand.
     * @param {*} view GltfView to which this state belongs
     */
    constructor(view)
    {
        /** loaded gltf data @see ResourceLoader.loadGltf */
        this.gltf = undefined;
        /** loaded environment data @see ResourceLoader.loadEnvironment */
        this.environment = undefined;
        /** user camera @see UserCamera, convenient camera controls */
        this.userCamera = new UserCamera();
        /** gltf scene that is visible in the view */
        this.sceneIndex = 0;
        /**
         * index of the camera that is used to render the view. a
         * value of 'undefined' enables the user camera
         */
        this.cameraIndex = undefined;
        /** indices of active animations */
        this.animationIndices = [];
        /** animation timer allows to control the animation time */
        this.animationTimer = new AnimationTimer();
        /** KHR_materials_variants */
        this.variant = undefined;

        /** parameters used to configure the rendering */
        this.renderingParameters = {
            /** morphing between vertices */
            morphing: true,
            /** skin / skeleton */
            skinning: true,

            enabledExtensions: {
                /** KHR_materials_clearcoat */
                KHR_materials_clearcoat: true,
                /** KHR_materials_sheen */
                KHR_materials_sheen: true,
                /** KHR_materials_transmission */
                KHR_materials_transmission: true,
                /** KHR_materials_volume */
                KHR_materials_volume: true,
                /** KHR_materials_ior makes the index of refraction configurable */
                KHR_materials_ior: true,
                /** KHR_materials_specular allows configuring specular color (f0 color) and amount of specular reflection */
                KHR_materials_specular: true,
                /** KHR_materials_iridescence adds a thin-film iridescence effect */
                KHR_materials_iridescence: true,
                KHR_materials_emissive_strength: true,
            },
            /** clear color expressed as list of ints in the range [0, 255] */
            clearColor: [58, 64, 74, 255],
            /** exposure factor */
            exposure: 1.0,
            /** KHR_lights_punctual */
            usePunctual: true,
            /** image based lighting */
            useIBL: true,
            /** image based lighting intensity */
            iblIntensity: 1.0,
            /** render the environment map in the background */
            renderEnvironmentMap: true,
            /** apply blur to the background environment map */
            blurEnvironmentMap: true,
            /** which tonemap to use, use ACES for a filmic effect */
            toneMap: GltfState.ToneMaps.LINEAR,
            /** render some debug output channes, such as for example the normals */
            debugOutput: GltfState.DebugOutput.NONE,
            /**
             * By default the front face of the environment is +Z (90)
             * Front faces:
             * +X = 0 
             * +Z = 90 
             * -X = 180 
             * -Z = 270
             */
            environmentRotation: 90.0,
            /** If this is set to true, directional lights will be generated if IBL is disabled */
            useDirectionalLightsWithDisabledIBL: false,
            /** MSAA used for cases which are not handled by the browser (e.g. Transmission)*/
            internalMSAA: 4
        };

        /** parameters used to configure the comparison of compressed and un-compressed textures (both 2D and 3D) */
        this.compressorParameters = {
            /** [Internal State] render the compressed or original textures */
            previewCompressed: false,
            /** position of the comparison slider [0...1] */
            sliderPosition: 0.5,
            /** Set the preview comparison mode */
            previewMode: GltfState.CompressionComparison.PREVIEW_3D,
            /** Set the preview texture Index */
            previewTextureIndex: -1,
            /** Set the preview texture zoom */
            previewTextureZoom: {left: 0, right: 1, bottom: 0, top: 1},

            /** Set the resolution downscale */
            resolutionDownscale: '1x',

            /** Set the compression quality JPEG */
            compressionQualityJPEG: 80.0,

            /** Set the compression quality PNG */
            compressionQualityPNG: 8,

            /** Set the compression quality WEBP */
            compressionQualityWEBP: 80.0,

            /** Set the compression encoding KTX2 */
            compressionEncoding: "UASTC",

            /** Set the compression quality KTX2 - UASTC */
            compressionUASTC_Flags: "DEFAULT",
            compressionUASTC_Rdo: false,
            compressionUASTC_Rdo_QualityScalar: 1.0,
            compressionUASTC_Rdo_DictionarySize: 4096,
            compressionUASTC_Rdo_MaxSmoothBlockErrorScale: 10.0,
            compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation: 18.0,
            compressionUASTC_Rdo_DonotFavorSimplerModes: false,

            /** Set the compression quality KTX2 - ETC1S */
            compressionETC1S_CompressionLevel: 2,
            compressionETC1S_QualityLevel: 128,
            compressionETC1S_MaxEndPoints: 0,
            compressionETC1S_EndpointRdoThreshold: 1.25,
            compressionETC1S_MaxSelectors: 0,
            compressionETC1S_SelectorRdoThreshold: 1.25,
            compressionETC1S_NoEndpointRdo: false,
            compressionETC1S_NoSelectorRdo: false,

            /** Set the compression type */
            compressionType: "KTX2",

            /** Set the selected images */
            selectedImages: [],

            /** Set the active processed images */
            processedImages: []
        };

        // retain a reference to the view with which the state was created, so that it can be validated
        this._view = view;
    }
}

/** 
 * ToneMaps enum for the different tonemappings that are supported 
 * by gltf sample viewer
*/
GltfState.ToneMaps = {
    /** don't apply tone mapping */
    NONE: "None",
    /** ACES sRGB RRT+ODT implementation for 3D Commerce based on Stephen Hill's implementation with a exposure factor of 1.0 / 0.6 */
    ACES_HILL_EXPOSURE_BOOST: "ACES Filmic Tone Mapping (Hill - Exposure Boost)",
    /** fast implementation of the ACES sRGB RRT+ODT based on Krzysztof Narkowicz' implementation*/
    ACES_NARKOWICZ: "ACES Filmic Tone Mapping (Narkowicz)",
    /** more accurate implementation of the ACES sRGB RRT+ODT based on Stephen Hill's implementation*/
    ACES_HILL: "ACES Filmic Tone Mapping (Hill)",
};

/**
 * DebugOutput enum for selecting debug output channels
 * such as "NORMAL"
 */
GltfState.DebugOutput = {
    /** standard rendering - debug output is disabled */
    NONE: "None",

    /** generic debug outputs */
    generic: {
        /** output the texture coordinates 0 */
        UV_COORDS_0: "Texture Coordinates 0",
        /** output the texture coordinates 1 */
        UV_COORDS_1: "Texture Coordinates 1",
        /** output the world space normals (i.e. with TBN applied) */
        NORMAL: "Normal Texture",
        /** output the normal from the TBN*/
        GEOMETRYNORMAL: "Geometry Normal",
        /** output the tangent from the TBN*/
        TANGENT: "Geometry Tangent",
        /** output the bitangent from the TBN */
        BITANGENT: "Geometry Bitangent",
        /** output the world space normals (i.e. with TBN applied) */
        WORLDSPACENORMAL: "Shading Normal",
        /** output the alpha value */
        ALPHA: "Alpha",
        /** output the occlusion value */
        OCCLUSION: "Occlusion",
        /** output the emissive value */
        EMISSIVE: "Emissive",
    },

    /** output metallic roughness */
    mr: {
        /** output the combined metallic roughness */
        METALLIC_ROUGHNESS: "Metallic Roughness",
        /** output the base color value */
        BASECOLOR: "Base Color",
        /** output the metallic value from pbr metallic roughness */
        METALLIC: "Metallic",
        /** output the roughness value from pbr metallic roughness */
        ROUGHNESS: "Roughness",
    },

    /** output clearcoat lighting */
    clearcoat: {
        /** output the combined clear coat */
        CLEARCOAT: "ClearCoat",
        /** output the clear coat factor */
        CLEARCOAT_FACTOR: "ClearCoat Factor",
        /** output the clear coat roughness */
        CLEARCOAT_ROUGHNESS: "ClearCoat Roughness",
        /** output the clear coat normal */
        CLEARCOAT_NORMAL: "ClearCoat Normal",    
    },

    /** output sheen lighting */
    sheen: {
        /** output the combined sheen */
        SHEEN: "Sheen",
        /** output the sheen color*/
        SHEEN_COLOR: "Sheen Color",
        /** output the sheen roughness*/
        SHEEN_ROUGHNESS: "Sheen Roughness",
    },

    /** output specular lighting */
    specular: {
        /** output the combined specular */
        SPECULAR: "Specular",
        /** output the specular factor*/
        SPECULAR_FACTOR: "Specular Factor",
        /** output the specular color*/
        SPECULAR_COLOR: "Specular Color",
    },

    /** output tranmission lighting */
    transmission: {
        /** output the combined transmission/volume */
        TRANSMISSION_VOLUME: "Transmission/Volume",
        /** output the transmission factor*/
        TRANSMISSION_FACTOR: "Transmission Factor",
        /** output the volume thickness*/
        VOLUME_THICKNESS: "Volume Thickness",
    },

    /** output tranmission lighting */
    iridescence: {
        /** output the combined iridescence */
        IRIDESCENCE: "Iridescence",
        /** output the iridescence factor*/
        IRIDESCENCE_FACTOR: "Iridescence Factor",
        /** output the iridescence thickness*/
        IRIDESCENCE_THICKNESS: "Iridescence Thickness",
    },
};

/** 
 * Compression Comparison
*/
GltfState.CompressionComparison = {
    /** Preview 3D */
    PREVIEW_3D: "Preview 3D",
    /** Preview a 2D image texture */
    PREVIEW_2D: "Preview 2D Image",
};

export { GltfState };
