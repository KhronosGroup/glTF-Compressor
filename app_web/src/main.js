
import { GltfView, GltfState } from 'gltf-viewer-source';

import { UIModel } from './logic/uimodel.js';
import { app } from './ui/ui.js';
import { Observable, Subject, from, merge } from 'rxjs';
import { mergeMap, filter, map, multicast } from 'rxjs/operators';
import { gltfModelPathProvider, fillEnvironmentWithPaths } from './model_path_provider.js';
import { ImageType } from "../../source/gltf/image_type.js";
import { ImageMimeType } from "../../source/gltf/image_mime_type.js";
import * as zip from "@zip.js/zip.js";
import path from 'path';
import {GlbSerializer} from "../../source/ResourceLoader/glb_serializer.js";
import {getIsGlb} from "../../source/gltf/utils.js";

async function main()
{
    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("webgl2", { alpha: false, antialias: true });
    const ui = document.getElementById("app");
    const view = new GltfView(context);
    const resourceLoader = view.createResourceLoader();
    const state = view.createState();
    state.renderingParameters.useDirectionalLightsWithDisabledIBL = true;

    const pathProvider = new gltfModelPathProvider('assets/models/2.0/model-index.json');
    await pathProvider.initialize();
    const environmentPaths = fillEnvironmentWithPaths({
        "footprint_court": "Footprint Court",
        "pisa": "Pisa",
        "doge2": "Doge's palace",
        "ennis": "Dining room",
        "field": "Field",
        "helipad": "Helipad Goldenhour",
        "papermill": "Papermill Ruins",
        "neutral": "Studio Neutral",
        "Cannon_Exterior": "Cannon Exterior",
        "Colorful_Studio": "Colorful Studio",
        "Wide_Street" : "Wide Street",
    }, "assets/environments/");

    const uiModel = new UIModel(app, pathProvider, environmentPaths);

    // whenever a new model is selected, load it and when complete pass the loaded gltf
    // into a stream back into the UI
    const gltfLoadedSubject = new Subject();
    const gltfLoadedMulticast = uiModel.model.pipe(
        mergeMap( (model) =>
        {
        	uiModel.goToLoadingState();

            // Workaround for errors in ktx lib after loading an asset with ktx2 files for the second time:
            resourceLoader.initKtxLib();

            return from(resourceLoader.loadGltf(model.mainFile, model.additionalFiles).then( (gltf) => {
                state.gltf = gltf;
                const defaultScene = state.gltf.scene;
                state.sceneIndex = defaultScene === undefined ? 0 : defaultScene;
                state.cameraIndex = undefined;
                if (state.gltf.scenes.length != 0)
                {
                    if(state.sceneIndex > state.gltf.scenes.length - 1)
                    {
                        state.sceneIndex = 0;
                    }
                    const scene = state.gltf.scenes[state.sceneIndex];
                    scene.applyTransformHierarchy(state.gltf);
                    state.userCamera.aspectRatio = canvas.width / canvas.height;
                    state.userCamera.fitViewToScene(state.gltf, state.sceneIndex);

                    // Try to start as many animations as possible without generating conficts.
                    state.animationIndices = [];
                    for (let i = 0; i < gltf.animations.length; i++)
                    {
                        if (!gltf.nonDisjointAnimations(state.animationIndices).includes(i))
                        {
                            state.animationIndices.push(i);
                        }
                    }
                    state.animationTimer.start();
                }

                uiModel.exitLoadingState();

                return state;
            })
            );
        }),
        // transform gltf loaded observable to multicast observable to avoid multiple execution with multiple subscriptions
        multicast(gltfLoadedSubject)
    );

    uiModel.disabledAnimations(uiModel.activeAnimations.pipe(map(animationIndices => {
        // Disable all animations which are not disjoint to the current selection of animations.
        return state.gltf.nonDisjointAnimations(animationIndices);
    })));

    const sceneChangedSubject = new Subject();
    const sceneChangedObservable = uiModel.scene.pipe(map( newSceneIndex => {
        state.sceneIndex = newSceneIndex;
        state.cameraIndex = undefined;
        const scene = state.gltf.scenes[state.sceneIndex];
        if (scene !== undefined)
        {
            scene.applyTransformHierarchy(state.gltf);
            state.userCamera.fitViewToScene(state.gltf, state.sceneIndex);
        }
    }),
    multicast(sceneChangedSubject)
    );

    const statisticsUpdateObservableTemp = merge(
        gltfLoadedMulticast,
        sceneChangedObservable
    );

    const statisticsUpdateObservable = statisticsUpdateObservableTemp.pipe(
        map( (_) => view.gatherStatistics(state) )
    );

    const texturestatisticsUpdateObservableTemp = merge(
        gltfLoadedMulticast,
        sceneChangedObservable
    );

    const texturestatisticsUpdateObservable = texturestatisticsUpdateObservableTemp.pipe(
        map( (_) => view.gatherTextureStatistics(state) )
    );

    const cameraExportChangedObservable = uiModel.cameraValuesExport.pipe( map(_ => {
        let camera = state.userCamera;
        if(state.cameraIndex !== undefined)
        {
            camera = state.gltf.cameras[state.cameraIndex];
        }
        const cameraDesc = camera.getDescription(state.gltf);
        return cameraDesc;
    }));

    const base64 = ( buffer ) => {
        if (typeof(buffer) === "string") return window.btoa( buffer );

        var binary = '';
        const bytes = new Uint8Array( buffer );
        const len = bytes.byteLength;
        for (var i = 0; i < len; i++) {
            binary += String.fromCharCode( bytes[ i ] );
        }
        
        return window.btoa( binary );
    };

    const downloadDataURL = (filename, dataURL) => {
        var element = document.createElement('a');
        element.setAttribute('href', dataURL);
        element.setAttribute('download', filename);

        element.style.display = 'none';
        document.body.appendChild(element);

        element.click();

        document.body.removeChild(element);
    };

    cameraExportChangedObservable.subscribe( cameraDesc => {
        const gltf = JSON.stringify(cameraDesc, undefined, 4);
        const dataURL = 'data:text/plain;charset=utf-8,' +  encodeURIComponent(gltf);
        downloadDataURL("camera.gltf", dataURL);
    });
    
    uiModel.captureCanvas.subscribe( () => {
        view.renderFrame(state, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL();
        downloadDataURL("capture.png", dataURL);
    });

    // Only redraw glTF view upon user inputs, or when an animation is playing.
    let redraw = false;
    const listenForRedraw = stream => stream.subscribe(() => redraw = true);
    
    uiModel.scene.pipe(filter(scene => scene === -1)).subscribe( () => {
        state.sceneIndex = undefined;
    });
    uiModel.scene.pipe(filter(scene => scene !== -1)).subscribe( scene => {
        state.sceneIndex = scene;
    });
    listenForRedraw(uiModel.scene);

    uiModel.camera.pipe(filter(camera => camera === -1)).subscribe( () => {
        state.cameraIndex = undefined;
    });
    uiModel.camera.pipe(filter(camera => camera !== -1)).subscribe( camera => {
        state.cameraIndex = camera;
    });
    listenForRedraw(uiModel.camera);

    uiModel.variant.subscribe( variant => {
        state.variant = variant;
    });
    listenForRedraw(uiModel.variant);

    uiModel.tonemap.subscribe( tonemap => {
        state.renderingParameters.toneMap = tonemap;
    });
    listenForRedraw(uiModel.tonemap);

    uiModel.debugchannel.subscribe( debugchannel => {
        state.renderingParameters.debugOutput = debugchannel;
    });
    listenForRedraw(uiModel.debugchannel);

    uiModel.skinningEnabled.subscribe( skinningEnabled => {
        state.renderingParameters.skinning = skinningEnabled;
    });
    listenForRedraw(uiModel.skinningEnabled);

    uiModel.exposure.subscribe( exposure => {
        state.renderingParameters.exposure = (1.0 / Math.pow(2.0, exposure));
    });
    listenForRedraw(uiModel.exposure);

    uiModel.morphingEnabled.subscribe( morphingEnabled => {
        state.renderingParameters.morphing = morphingEnabled;
    });
    listenForRedraw(uiModel.morphingEnabled);

    uiModel.clearcoatEnabled.subscribe( clearcoatEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_clearcoat = clearcoatEnabled;
    });
    uiModel.sheenEnabled.subscribe( sheenEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_sheen = sheenEnabled;
    });
    uiModel.transmissionEnabled.subscribe( transmissionEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_transmission = transmissionEnabled;
    });
    uiModel.volumeEnabled.subscribe( volumeEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_volume = volumeEnabled;
    });
    uiModel.iorEnabled.subscribe( iorEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_ior = iorEnabled;
    });
    uiModel.iridescenceEnabled.subscribe( iridescenceEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_iridescence = iridescenceEnabled;
    });
    uiModel.specularEnabled.subscribe( specularEnabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_specular = specularEnabled;
    });
    uiModel.emissiveStrengthEnabled.subscribe( enabled => {
        state.renderingParameters.enabledExtensions.KHR_materials_emissive_strength = enabled;
    });
    listenForRedraw(uiModel.clearcoatEnabled);
    listenForRedraw(uiModel.sheenEnabled);
    listenForRedraw(uiModel.transmissionEnabled);
    listenForRedraw(uiModel.volumeEnabled);
    listenForRedraw(uiModel.iorEnabled);
    listenForRedraw(uiModel.specularEnabled);
    listenForRedraw(uiModel.iridescenceEnabled);
    listenForRedraw(uiModel.emissiveStrengthEnabled);

    uiModel.iblEnabled.subscribe( iblEnabled => {
        state.renderingParameters.useIBL = iblEnabled;
    });
    listenForRedraw(uiModel.iblEnabled);

    uiModel.iblIntensity.subscribe( iblIntensity => {
        state.renderingParameters.iblIntensity = Math.pow(10, iblIntensity);
    });
    listenForRedraw(uiModel.iblIntensity);

    // GSV-KTX
    uiModel.texturesSelectionType.subscribe( texturesSelectionType => {
        for(let i=0; i<state.gltf.images.length; i++){
            const type = state.gltf.images[i].imageType;
            
            document.getElementById('image-' + i).checked = false;
            if((texturesSelectionType === "All") || 
               (texturesSelectionType === "Color"     && type === ImageType.COLOR)    ||
               (texturesSelectionType === "Non-color" && type === ImageType.NONCOLOR) ||
               (texturesSelectionType === "Normal"    && type === ImageType.NORMAL)
            )
                document.getElementById('image-' + i).checked = true;
        }
        uiModel.updateEncodingKTX(texturesSelectionType);
        state.compressorParameters.compressionEncoding = (texturesSelectionType === "Color") ? "ETC1S" : "UASTC";
    });

    uiModel.compressionSelectionType.subscribe( compressionSelectionType => {
        state.compressorParameters.compressionType = compressionSelectionType;
    });
    
    uiModel.compressionResolutionDownscale.subscribe( downscale => {
        state.compressorParameters.resolutionDownscale = downscale;
    });

    uiModel.compressionQualityJPEG.subscribe( compressionQualityJPEG => {
        state.compressorParameters.compressionQualityJPEG = compressionQualityJPEG;
    });
    uiModel.compressionQualityPNG.subscribe( compressionQualityPNG => {
        state.compressorParameters.compressionQualityPNG = compressionQualityPNG;
    });
    uiModel.compressionQualityWEBP.subscribe( compressionQualityWEBP => {
        state.compressorParameters.compressionQualityWEBP = compressionQualityWEBP;
    });

    uiModel.compressionEncoding.subscribe( compressionEncoding => {
        state.compressorParameters.compressionEncoding = compressionEncoding;
    });

    uiModel.compressionUASTC_Flags.subscribe( compressionUASTC_Flags => {
        state.compressorParameters.compressionUASTC_Flags = compressionUASTC_Flags;
    });

    uiModel.compressionUASTC_Rdo.subscribe( compressionUASTC_Rdo => {
        state.compressorParameters.compressionUASTC_Rdo = compressionUASTC_Rdo;
    });

    uiModel.compressionUASTC_Rdo_QualityScalar.subscribe( compressionUASTC_Rdo_QualityScalar => {
        state.compressorParameters.compressionUASTC_Rdo_QualityScalar = compressionUASTC_Rdo_QualityScalar;
    });

    uiModel.compressionUASTC_Rdo_DictionarySize.subscribe( compressionUASTC_Rdo_DictionarySize => {
        state.compressorParameters.compressionUASTC_Rdo_DictionarySize = compressionUASTC_Rdo_DictionarySize;
    });

    uiModel.compressionUASTC_Rdo_MaxSmoothBlockErrorScale.subscribe( compressionUASTC_Rdo_MaxSmoothBlockErrorScale => {
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockErrorScale = compressionUASTC_Rdo_MaxSmoothBlockErrorScale;
    });

    uiModel.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation.subscribe( compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation => {
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation = compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation;
    });

    uiModel.compressionUASTC_Rdo_DonotFavorSimplerModes.subscribe( compressionUASTC_Rdo_DonotFavorSimplerModes => {
        state.compressorParameters.compressionUASTC_Rdo_DonotFavorSimplerModes = compressionUASTC_Rdo_DonotFavorSimplerModes;
    });

    uiModel.compressionETC1S_CompressionLevel.subscribe( compressionETC1S_CompressionLevel => {
        state.compressorParameters.compressionETC1S_CompressionLevel = compressionETC1S_CompressionLevel;
    });

    uiModel.compressionETC1S_QualityLevel.subscribe( compressionETC1S_QualityLevel => {
        state.compressorParameters.compressionETC1S_QualityLevel = compressionETC1S_QualityLevel;
    });

    uiModel.compressionETC1S_MaxEndPoints.subscribe( compressionETC1S_MaxEndPoints => {
        state.compressorParameters.compressionETC1S_MaxEndPoints = compressionETC1S_MaxEndPoints;
    });

    uiModel.compressionETC1S_EndpointRdoThreshold.subscribe( compressionETC1S_EndpointRdoThreshold => {
        state.compressorParameters.compressionETC1S_EndpointRdoThreshold = compressionETC1S_EndpointRdoThreshold;
    });

    uiModel.compressionETC1S_MaxSelectors.subscribe( compressionETC1S_MaxSelectors => {
        state.compressorParameters.compressionETC1S_MaxSelectors = compressionETC1S_MaxSelectors;
    });

    uiModel.compressionETC1S_SelectorRdoThreshold.subscribe( compressionETC1S_SelectorRdoThreshold => {
        state.compressorParameters.compressionETC1S_SelectorRdoThreshold = compressionETC1S_SelectorRdoThreshold;
    });

    uiModel.compressionETC1S_NoEndpointRdo.subscribe( compressionETC1S_NoEndpointRdo => {
        state.compressorParameters.compressionETC1S_NoEndpointRdo = compressionETC1S_NoEndpointRdo;
    });

    uiModel.compressionETC1S_NoSelectorRdo.subscribe( compressionETC1S_NoSelectorRdo => {
        state.compressorParameters.compressionETC1S_NoSelectorRdo = compressionETC1S_NoSelectorRdo;
    });

    uiModel.comparisonViewMode.subscribe( index => {

        if(state.compressorParameters.previewTextureIndex === index)
        {
            state.compressorParameters.previewMode = GltfState.CompressionComparison.PREVIEW_3D;
            state.compressorParameters.previewTextureIndex = -1;
            state.compressorParameters.previewTextureZoom = {left: 0, right: 1, bottom: 0, top: 1};
        }
        else
        {
            state.compressorParameters.previewMode = GltfState.CompressionComparison.PREVIEW_2D;
            state.compressorParameters.previewTextureIndex = index;
            state.compressorParameters.previewTextureZoom = {left: 0, right: 1, bottom: 0, top: 1};
        }
    });
    listenForRedraw(uiModel.comparisonViewMode);

    // Preview Compressed
    uiModel.compressedPreviewMode.subscribe( compressedPreviewMode => {
        state.compressorParameters.sliderPosition = compressedPreviewMode? 0.0 : 1.0;
        uiModel.updateImageSlider(state.compressorParameters.sliderPosition);
    });
    listenForRedraw(uiModel.compressedPreviewMode);
    // preview slider
    uiModel.previewImageSlider.subscribe( previewImageSlider => {
        state.compressorParameters.sliderPosition = previewImageSlider;
    });
    listenForRedraw(uiModel.previewImageSlider);
    // Compress textures
    const compressTexturesSubject = new Subject();
    const compressTexturesChangedObservable = uiModel.compressTextures.pipe( mergeMap(async _ => {
        const libktx = state.gltf.ktxEncoder.libktx;
        // Images to be Compressed
        state.compressorParameters.selectedImages = [];
        for(let i=0; i<state.gltf.images.length; i++)
            if(document.getElementById('image-' + i).checked)
                state.compressorParameters.selectedImages.push(i);

        if(state.compressorParameters.selectedImages.length === 0)
            return false;

        // Set resolution downscale scale
        const scale  = parseInt(state.compressorParameters.resolutionDownscale.replace(/\D/g, ""));
        const compressed_images = [];
        let targetQuality;
        let targetMimeType;
      
        const options = {};
        if(state.compressorParameters.compressionType === "KTX2"){
            targetMimeType = ImageMimeType.KTX2;
            const targetKTX2_encoding = state.compressorParameters.compressionEncoding;
            const targetKTX2_UASTC_flags = state.compressorParameters.compressionUASTC_Flags;
            const targetKTX2_UASTC_RDO = state.compressorParameters.compressionUASTC_Rdo;
            const targetKTX2_UASTC_RDO_quality = state.compressorParameters.compressionUASTC_Rdo_QualityScalar;
            const targetKTX2_UASTC_RDO_dictionarySize = state.compressorParameters.compressionUASTC_Rdo_DictionarySize;
            const targetKTX2_UASTC_RDO_maxSmoothBlockErrorScale = state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockErrorScale;
            const targetKTX2_UASTC_RDO_maxSmoothBlockStandardDeviation = state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation;
            const targetKTX2_UASTC_RDO_donotFavorSimplerModes = state.compressorParameters.compressionUASTC_Rdo_DonotFavorSimplerModes;

            const targetKTX2_ETC1S_compressionLevel = state.compressorParameters.compressionETC1S_CompressionLevel;
            const targetKTX2_ETC1S_qualityLevel = state.compressorParameters.compressionETC1S_QualityLevel;
            const targetKTX2_ETC1S_maxEndPoints = state.compressorParameters.compressionETC1S_MaxEndPoints;
            const targetKTX2_ETC1S_endpointRdoThreshold = state.compressorParameters.compressionETC1S_EndpointRdoThreshold;
            const targetKTX2_ETC1S_maxSelectors = state.compressorParameters.compressionETC1S_MaxSelectors;
            const targetKTX2_ETC1S_SelectorRdoThreshold = state.compressorParameters.compressionETC1S_SelectorRdoThreshold;
            const targetKTX2_ETC1S_normalMap = false;
            const targetKTX2_ETC1S_noEndpointRdo = state.compressorParameters.compressionETC1S_NoEndpointRdo;
            const targetKTX2_ETC1S_noSelectorRdo = state.compressorParameters.compressionETC1S_NoSelectorRdo;
            
            const basisu_options = new libktx.ktxBasisParams();
            basisu_options.uastc = targetKTX2_encoding === 'UASTC';
            basisu_options.noSSE = true;
            basisu_options.verbose = false;
            basisu_options.compressionLevel = targetKTX2_ETC1S_compressionLevel;
            basisu_options.qualityLevel = targetKTX2_ETC1S_qualityLevel;
            basisu_options.maxEndpoints = targetKTX2_ETC1S_maxEndPoints;
            basisu_options.endpointRDOThreshold = targetKTX2_ETC1S_endpointRdoThreshold;
            basisu_options.maxSelectors = targetKTX2_ETC1S_maxSelectors;
            basisu_options.selectorRDOThreshold = targetKTX2_ETC1S_SelectorRdoThreshold;
            basisu_options.normalMap = targetKTX2_ETC1S_normalMap;
            basisu_options.preSwizzle = false;
            basisu_options.noEndpointRDO = targetKTX2_ETC1S_noEndpointRdo;
            basisu_options.noSelectorRDO = targetKTX2_ETC1S_noSelectorRdo;

            basisu_options.uastcFlags =  state.gltf.ktxEncoder.stringToUastcFlags(targetKTX2_UASTC_flags);
            basisu_options.uastcRDO = targetKTX2_UASTC_RDO;
            basisu_options.uastcRDOQualityScalar = targetKTX2_UASTC_RDO_quality;
            basisu_options.uastcRDODictSize = targetKTX2_UASTC_RDO_dictionarySize;
            basisu_options.uastcRDOMaxSmoothBlockErrorScale = targetKTX2_UASTC_RDO_maxSmoothBlockErrorScale;
            basisu_options.uastcRDOMaxSmoothBlockStdDev = targetKTX2_UASTC_RDO_maxSmoothBlockStandardDeviation;
            basisu_options.uastcRDODontFavorSimplerModes = targetKTX2_UASTC_RDO_donotFavorSimplerModes;
            
            options.basisu_options = basisu_options;
        }
        else if(state.compressorParameters.compressionType === "JPEG"){
            targetMimeType = ImageMimeType.JPEG;
            options.quality = state.compressorParameters.compressionQualityJPEG;
        }
        else if(state.compressorParameters.compressionType === "PNG"){
            targetMimeType = ImageMimeType.PNG;
            options.quality = state.compressorParameters.compressionQualityPNG;
        }
        else if(state.compressorParameters.compressionType === "WEBP"){
            targetMimeType = ImageMimeType.WEBP;
            options.quality = state.compressorParameters.compressionQualityWEBP;
        }

        uiModel.updateTextureCompressionButton(0, state.compressorParameters.selectedImages.length);
        
        // Free up the thread for 10ms in order to allow the UI to be updated
        const small_delay = new Promise((res) => setTimeout(() => res("small_delay"), 10));
        await small_delay;

        for(let index = 0; index < state.compressorParameters.selectedImages.length; index++)
        {
            const i = state.compressorParameters.selectedImages[index];
            const width = state.gltf.images[i].image.width;
            const height = state.gltf.images[i].image.height;
            
            const scaled_width  = scale > 1? Math.max(width/scale, 1) : width;
            const scaled_height = scale > 1? Math.max(height/scale, 1) : height;

            await state.gltf.images[i].compressImage(targetMimeType, scaled_width, scaled_height, options, state.gltf, () => uiModel.updateTextureCompressionButton(index+1, state.compressorParameters.selectedImages.length));
        }
        const done = true;
        
        state.compressorParameters.processedImages = state.compressorParameters.processedImages.concat(state.compressorParameters.selectedImages.filter((item) => state.compressorParameters.processedImages.indexOf(item) < 0))

        /*state.compressorParameters.processedImages = state.compressorParameters.selectedImages.map((i, index) => {
            const width = state.gltf.images[i].image.width;
            const height = state.gltf.images[i].image.height;
            
            const scaled_width  = scale > 1? width/scale : undefined;
            const scaled_height = scale > 1? height/scale : undefined;

            return state.gltf.images[i].compressImage(targetMimeType, width, height, {quality: targetQuality, scaled_width: scaled_width, scaled_height: scaled_height}, state.gltf, () => uiModel.updateTextureCompressionButton(index+1, state.compressorParameters.selectedImages.length));
        }
        );
        const done = Promise.allSettled(state.compressorParameters.processedImages);*/
        
        return done;
    }), multicast(compressTexturesSubject));

    compressTexturesChangedObservable.subscribe(async compressDesc => {
        await compressDesc;
        console.warn(state.compressorParameters.selectedImages.length > 0 ? "Compression Complete" : "Please select any texture in order to proceed");
        redraw = true;
    });
    //listenForRedraw(compressTexturesChangedObservable);

    const textureCompressionstatisticsUpdateObservableTemp = merge(
        compressTexturesChangedObservable,
    );

    const textureCompressionstatisticsUpdateObservable = textureCompressionstatisticsUpdateObservableTemp.pipe(
        map( (_) => view.gatherTextureCompressionStatistics(state) )
    );

    uiModel.updateTextureCompressionStatistics(textureCompressionstatisticsUpdateObservable);    

    const gltfExportChangedObservable = uiModel.gltfFilesExport.pipe( map(_ => {
        
        const gltf = state.gltf;
        const gltfJSON = {...gltf.originalJSON}; // no need for deeper cloning

        // clear uris from "./" paths ()
        gltfJSON.buffers = gltfJSON.buffers.map(buffer => {return {...buffer, uri: buffer.uri === undefined? undefined : buffer.uri.startsWith("./")? buffer.uri.slice(2): buffer.uri};});
        gltfJSON.images = gltfJSON.images.map(img => {return {...img, uri: img.uri === undefined? undefined : img.uri.startsWith("./")? img.uri.slice(2): img.uri};});

        // check if we have WEBP or KTX2 extensions used for the images
        const webpImagesExists = gltf.images.some(img => img.compressedMimeType === ImageMimeType.WEBP);
        const ktxImagesExists = gltf.images.some(img => img.compressedMimeType === ImageMimeType.KTX2);
        if(webpImagesExists || ktxImagesExists)
        {
            const imageExtensions = [];
            if(webpImagesExists)
                imageExtensions.push("EXT_texture_webp");
            if(ktxImagesExists)
                imageExtensions.push("KHR_texture_basisu");
            gltfJSON.extensionsUsed = (gltfJSON.extensionsUsed === undefined)? imageExtensions : [...gltfJSON.extensionsUsed, ...imageExtensions];
            gltfJSON.extensionsRequired = (gltfJSON.extensionsRequired === undefined)? imageExtensions : [...gltfJSON.extensionsRequired, ...imageExtensions];
        }

        // update image bufferViews with new image data. 
        gltf.images.forEach((img, index) => {
            if(img.bufferView === undefined || img.compressedImageTypedArrayBuffer === undefined)
                return;
            gltf.bufferViews[img.bufferView].blob = img.compressedImageTypedArrayBuffer;
            gltf.bufferViews[img.bufferView].byteLength = img.compressedImageTypedArrayBuffer.byteLength;
            gltfJSON.bufferViews[img.bufferView].byteLength = img.compressedImageTypedArrayBuffer.byteLength;
            gltfJSON.images[index].mimeType = img.compressedMimeType;
        });

        // Update textures with the appropriate extensions for WebP and KTX2
        gltfJSON.textures = gltfJSON.textures.map(texture => {
            // if an extension was used by the original model
            let imageSourceIndex = -1;
            if(texture.source === undefined)
            {
                if(texture.extensions)
                {
                    if(texture.extensions.EXT_texture_webp)
                    {
                        imageSourceIndex = texture.extensions.EXT_texture_webp.source;
                    }
                    else if(texture.extensions.KHR_texture_basisu)
                    {
                        imageSourceIndex = texture.extensions.KHR_texture_basisu.source;
                    }
                }
            }
            else
            {
                imageSourceIndex = texture.source;
            }
            if(imageSourceIndex === -1)
            {
                console.error("No image source found on texture: ", texture);
                return texture;
            }
            const imageSource = gltf.images[imageSourceIndex];
            // if we have a webp
            if(imageSource.compressedMimeType == ImageMimeType.WEBP)
            {
                const EXT_texture_webp = { source: imageSourceIndex };
                const extensions = texture.extensions? {...texture.extensions, EXT_texture_webp} : {EXT_texture_webp};
                return {
                    ...texture,
                    source: undefined, // remove the uncompressed source
                    extensions
                };
            }
            // if we have a ktx2
            else if(imageSource.compressedMimeType == ImageMimeType.KTX2)
            {
                const KHR_texture_basisu = { source: imageSourceIndex };
                const extensions = texture.extensions? {...texture.extensions, KHR_texture_basisu} : {KHR_texture_basisu};
                return {
                    ...texture,
                    source: undefined, // remove the uncompressed source
                    extensions
                };
            }
            else 
            {
                return {
                    ...texture,
                    source: imageSourceIndex // in the case that the original was defined by an extension
                };
            }
        });

        // update images mime (required only for buffer views)
        /*gltf.images.forEach((img, index) => {
            if(img.bufferView === undefined || img.compressedImageTypedArrayBuffer === undefined)
                return;
            gltfJSON.images[index].mimeType = img.compressedMimeType;
        });*/

        const align4Bytes = (num) => 4 * Math.floor((num - 1) / 4) + 4;

        // check if compressed images are stored in buffers, so we can update them
        const areBuffersAltered = !gltfJSON.images.some(img => img.bufferView === undefined);
        if(areBuffersAltered)
        {
            // create new buffers
            const buffers = gltf.buffers.map(buffer => {return {buffer: null, byteLength: 0};});
            gltf.bufferViews.forEach(view => {
                buffers[view.buffer].byteLength += align4Bytes(view.byteLength);
            });
            buffers.forEach(buffer => {
                buffer.buffer = new ArrayBuffer(buffer.byteLength);
                buffer.typedBuffer = new Uint8Array(buffer.buffer);
                buffer.byteOffset = 0;
            });
            // fill buffers
            gltfJSON.bufferViews = gltfJSON.bufferViews.map((view, index) => {
                const byteOffset = buffers[view.buffer].byteOffset;
                let byteLength = 0;
                const compressedImageBlob = gltf.bufferViews[index].blob;
                if(compressedImageBlob === undefined)
                {
                    const typedArray = new Uint8Array(gltf.buffers[view.buffer].buffer, view.byteOffset, view.byteLength);
                    buffers[view.buffer].typedBuffer.set(typedArray, byteOffset);
                    byteLength = view.byteLength;
                }
                else
                {
                    const blobArrayBuffer = new Uint8Array(compressedImageBlob);
                    buffers[view.buffer].typedBuffer.set(blobArrayBuffer, byteOffset);
                    byteLength = compressedImageBlob.byteLength;
                }
                buffers[view.buffer].byteOffset += align4Bytes(byteLength);
                return {
                    ...view,
                    byteOffset,
                    byteLength
                };
            });
            // merge buffers
            gltfJSON.buffers = gltfJSON.buffers.map((buffer, index) => {return {...buffer, buffer: buffers[index].buffer, byteLength: buffers[index].byteLength}; });
        }
        else
        {
            gltfJSON.buffers = gltfJSON.buffers.map((buffer, index) => {return {...buffer, buffer: gltf.buffers[index].buffer}; });
        }

        // uri means that buffer is external (or embeded)
        const externalBuffers = gltfJSON.buffers
        .filter(b => b.uri != undefined && !b.uri.startsWith("data:application/octet-stream;base64"))
        .map(b => { return {uri: b.uri, data: new Uint8Array(b.buffer) };});
        const internalBuffers = gltfJSON.buffers
        .filter(b => b.uri === undefined)
        .map(b => { return new Uint8Array(b.buffer); });
        // fix embeded buffers
        gltfJSON.buffers.forEach(b => {
            if(b.uri != undefined && b.uri.startsWith("data:application/octet-stream;base64,"))
            {
                // convert to base64 string
                let binary = '';
                const bytes = new Uint8Array( b.buffer );
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode( bytes[i] );
                }
                b.uri = "data:application/octet-stream;base64," + window.btoa( binary );
            }
        });
        
        const toExt = (type) => type == ImageMimeType.JPEG? ".jpg" : type == ImageMimeType.PNG? ".png" : type == ImageMimeType.WEBP? ".webp" : ".ktx2";
        // update gltf mime types and file types
        gltfJSON.images = gltfJSON.images.map((img, index) => {
            return {
                ...img,
                mimeType: gltf.images[index].compressedMimeType,
            };            
        })
        .map(img => {
            if(img.bufferView === undefined)
            {
                const currentExt = path.extname(img.uri);
                const newExt = toExt(img.mimeType);
                const uri = img.uri.replace(currentExt, newExt);
                return {...img, uri};
            }
            return img;
        });

        // find if we have external images
        const externalImages = gltfJSON.images
        .map((img, index) => {return {...gltf.images[index], ...img};})
        .filter(img => img.bufferView === undefined)
        .map(img => {
            return {uri: img.uri, data: img.compressedImageTypedArrayBuffer};
        });

        // remove {buffer: ... } property from buffers
        gltfJSON.buffers = gltfJSON.buffers.map(buffer => {delete buffer.buffer; return buffer; });

        return {gltfDesc: {uri: path.basename(gltf.path), data: gltfJSON}, externalFiles: [...externalBuffers, ...externalImages], internalBuffers};
    }));
    gltfExportChangedObservable.subscribe( async ({gltfDesc, externalFiles, internalBuffers}) => {
        const gltf = JSON.stringify(gltfDesc.data, undefined, 4);

        if(externalFiles.length > 0)
        {
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
            const json_file = zipWriter.add(gltfDesc.uri, new zip.TextReader(gltf));
            const external_files = externalFiles.map((file, index) => {
                //console.log("Zipping ", file);
                return zipWriter.add(file.uri, file.data instanceof Blob? new zip.BlobReader(file.data) : new zip.Uint8ArrayReader(file.data));
            });
            await Promise.all([ json_file, ...external_files ]);
            zipWriter.close();
            const zipFileBlob = await zipWriter.writer.blob;
            const zipFileArrayBuffer = await zipFileBlob.arrayBuffer();
            const dataURL = 'data:application/octet-stream;base64,' + base64(zipFileArrayBuffer);
            downloadDataURL("file.zip", dataURL);
        }
        else
        {
            if(getIsGlb(gltfDesc.uri))
            {
                const glbSerializer = new GlbSerializer();
                const glb = glbSerializer.serializeGLBData(gltf, internalBuffers);
                const dataURL = 'data:application/octet-stream;base64,' + base64(glb);
                downloadDataURL(gltfDesc.uri, dataURL);
            }
            else
            {
                const dataURL = 'data:text/plain;charset=utf-8,' +  encodeURIComponent(gltf);
                downloadDataURL(gltfDesc.uri, dataURL);
            }
        }
    });
    
    const ktxjsonExportObservable = uiModel.ktxjsonValuesExport.pipe( map(_ => {
        const gltf = state.gltf;
        const ktx = gltf.ktxDecoder;
        const images = state.compressorParameters.processedImages;
        const params = state.compressorParameters;
        const commands = [];
        const scale  = parseInt(state.compressorParameters.resolutionDownscale.replace(/\D/g, ""));
        
        images.forEach(function (index) {
            const image = gltf.images[index];
            const slash_index  = image.uri.lastIndexOf("/"); 
            const point_index  = image.uri.lastIndexOf("."); 
            const ext = (point_index < 0) ? "" : image.uri.substring(point_index + 1);
            const input = (slash_index < 0) ? image.uri : image.uri.substring(slash_index + 1);
            const output = ((slash_index < 0 || point_index < 0) ? image.uri : image.uri.substring(slash_index + 1, point_index)) + '.ktx2';
            let command = '';
            command += 'toktx';
            command += ' --t2';
            command += ' --2d';
            command += ' --encode ' + (params.compressionEncoding === 'UASTC' ? 'uastc' : 'etc1s');
            if (params.compressionEncoding === 'UASTC') {
                command += ' --uastc_quality ' + ktx.stringToUastcFlags(params.compressionUASTC_Flags);
                if (params.compressionUASTC_Rdo) {
                    command += ' --uastc_rdo_l ' + params.compressionUASTC_Rdo_QualityScalar;
                    command += ' --uastc_rdo_d ' + params.compressionUASTC_Rdo_DictionarySize;
                    command += ' --uastc_rdo_b ' + params.compressionUASTC_Rdo_MaxSmoothBlockErrorScale;
                    command += ' --uastc_rdo_s ' + params.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation;
                    if (params.compressionUASTC_Rdo_DonotFavorSimplerModes) command += ' --uastc_rdo_f';
                }
            } else {
                command += ' --clevel ' + params.compressionETC1S_CompressionLevel;
                command += ' --qlevel ' + params.compressionETC1S_QualityLevel;
                command += ' --max_endpoints ' + params.compressionETC1S_MaxEndPoints;
                command += ' --endpoint_rdo_threshold ' + params.compressionETC1S_EndpointRdoThreshold;
                command += ' --max_selectors ' + params.compressionETC1S_MaxSelectors;
                command += ' --selector_rdo_threshold ' + params.compressionETC1S_SelectorRdoThreshold;
                if (params.compressionETC1S_NoEndpointRdo) command += ' --no_endpoint_rdo';
                if (params.compressionETC1S_NoSelectorRdo) command += ' --no_selector_rdo';
            }
            if (scale > 1) command += ' --resize ' + image.compressedImage.width + 'x' + image.compressedImage.height;
            command += ' ' + output;
            command += ' ' + input;
            commands.push(command);
        });
        return {commands: commands};
    }));
    ktxjsonExportObservable.subscribe( async (commands) => {
        const json_commands = JSON.stringify(commands);
        const dataURL = 'data:text/plain;charset=utf-8,' +  encodeURIComponent(json_commands);
        downloadDataURL("toktx.json", dataURL);
    });

    // reset the previewing to 3D and preview texture index on model load
    gltfLoadedMulticast.subscribe(_ => {
        state.compressorParameters.previewCompressed = false;
        state.compressorParameters.sliderPosition = 0.5;

        state.compressorParameters.previewMode = GltfState.CompressionComparison.PREVIEW_3D;
        state.compressorParameters.previewTextureIndex = -1;
        state.compressorParameters.previewTextureZoom = {left: 0, right: 1, bottom: 0, top: 1};

        state.compressorParameters.resolutionDownscale= '1x',
        state.compressorParameters.compressionQualityJPEG = 80.0;
        state.compressorParameters.compressionQualityPNG = 8;
        state.compressorParameters.compressionQualityWEBP = 80.0;

        state.compressorParameters.compressionEncoding = "UASTC";

        state.compressorParameters.compressionUASTC_Flags = "DEFAULT";
        state.compressorParameters.compressionUASTC_Rdo = false;
        state.compressorParameters.compressionUASTC_Rdo_QualityScalar = 1.0;
        state.compressorParameters.compressionUASTC_Rdo_DictionarySize = 4096;
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockErrorScale = 10.0;
        state.compressorParameters.compressionUASTC_Rdo_MaxSmoothBlockStandardDeviation = 18.0;
        state.compressorParameters.compressionUASTC_Rdo_DonotFavorSimplerModes = false;

        state.compressorParameters.compressionETC1S_CompressionLevel = 2;
        state.compressorParameters.compressionETC1S_QualityLevel = 128;
        state.compressorParameters.compressionETC1S_MaxEndPoints = 0;
        state.compressorParameters.compressionETC1S_EndpointRdoThreshold = 1.25;
        state.compressorParameters.compressionETC1S_MaxSelectors = 0;
        state.compressorParameters.compressionETC1S_SelectorRdoThreshold = 1.25;
        state.compressorParameters.compressionETC1S_NoEndpointRdo = false;
        state.compressorParameters.compressionETC1S_NoSelectorRdo = false;

        state.compressorParameters.compressionType = "KTX2";
        state.compressorParameters.processedImages = [];
    });

    // End GSV-KTX

    uiModel.renderEnvEnabled.subscribe( renderEnvEnabled => {
        state.renderingParameters.renderEnvironmentMap = renderEnvEnabled;
    });
    uiModel.blurEnvEnabled.subscribe( blurEnvEnabled => {
        state.renderingParameters.blurEnvironmentMap = blurEnvEnabled;
    });
    listenForRedraw(uiModel.renderEnvEnabled);
    listenForRedraw(uiModel.blurEnvEnabled);

    uiModel.punctualLightsEnabled.subscribe( punctualLightsEnabled => {
        state.renderingParameters.usePunctual = punctualLightsEnabled;
    });
    listenForRedraw(uiModel.punctualLightsEnabled);

    uiModel.environmentRotation.subscribe( environmentRotation => {
        switch (environmentRotation)
        {
        case "+Z":
            state.renderingParameters.environmentRotation = 90.0;
            break;
        case "-X":
            state.renderingParameters.environmentRotation = 180.0;
            break;
        case "-Z":
            state.renderingParameters.environmentRotation = 270.0;
            break;
        case "+X":
            state.renderingParameters.environmentRotation = 0.0;
            break;
        }
    });
    listenForRedraw(uiModel.environmentRotation);


    uiModel.clearColor.subscribe( clearColor => {
        state.renderingParameters.clearColor = clearColor;
    });
    listenForRedraw(uiModel.clearColor);

    uiModel.animationPlay.subscribe( animationPlay => {
        if(animationPlay)
        {
            state.animationTimer.unpause();
        }
        else
        {
            state.animationTimer.pause();
        }
    });

    uiModel.activeAnimations.subscribe( animations => {
        state.animationIndices = animations;
    });
    listenForRedraw(uiModel.activeAnimations);

    uiModel.hdr.subscribe( hdrFile => {
        resourceLoader.loadEnvironment(hdrFile).then( (environment) => {
            state.environment = environment;
            //We neeed to wait until the environment is loaded to redraw
            redraw = true;
        });
    });

    uiModel.attachGltfLoaded(gltfLoadedMulticast);
    uiModel.updateStatistics(statisticsUpdateObservable);
    uiModel.updateTextureStatistics(texturestatisticsUpdateObservable);

    const sceneChangedStateObservable = uiModel.scene.pipe(map( newSceneIndex => state));
    uiModel.attachCameraChangeObservable(sceneChangedStateObservable);
    gltfLoadedMulticast.connect();
    compressTexturesChangedObservable.connect();

    uiModel.orbit.subscribe( orbit => {
        if (state.cameraIndex === undefined)
        {
            state.userCamera.orbit(orbit.deltaPhi, orbit.deltaTheta);
        }
    });
    listenForRedraw(uiModel.orbit);

    uiModel.pan.subscribe( pan => {

        if(state.compressorParameters.previewMode == GltfState.CompressionComparison.PREVIEW_2D)
        {
            const width = (state.compressorParameters.previewTextureZoom.right - state.compressorParameters.previewTextureZoom.left) * 1.0 / canvas.width;
            const height = (state.compressorParameters.previewTextureZoom.top - state.compressorParameters.previewTextureZoom.bottom) * 1.0 / canvas.height;

            const box = {
                left: state.compressorParameters.previewTextureZoom.left - width * pan.deltaX,
                right: state.compressorParameters.previewTextureZoom.right - width * pan.deltaX,
                bottom: state.compressorParameters.previewTextureZoom.bottom + height * pan.deltaY,
                top: state.compressorParameters.previewTextureZoom.top + height * pan.deltaY,
            };

            // clamp box
            if(box.left < 0 || box.right > 1)
            {
                box.left = state.compressorParameters.previewTextureZoom.left;
                box.right = state.compressorParameters.previewTextureZoom.right;
            }
            if(box.bottom < 0 || box.top > 1)
            {
                box.bottom = state.compressorParameters.previewTextureZoom.bottom;
                box.top = state.compressorParameters.previewTextureZoom.top;
            }
            state.compressorParameters.previewTextureZoom = box;
        }
        else
        {
            if (state.cameraIndex === undefined)
            {
                state.userCamera.pan(pan.deltaX, -pan.deltaY);
            }
        }
    });
    listenForRedraw(uiModel.pan);

    uiModel.zoom.subscribe( zoom => {

        if(state.compressorParameters.previewMode == GltfState.CompressionComparison.PREVIEW_2D)
        {
            const zoomLevel = zoom.deltaZoom > 0? /*zoom out*/ 1.2 : 1.0 / 1.2;

            const width = state.compressorParameters.previewTextureZoom.right - state.compressorParameters.previewTextureZoom.left;
            const height = state.compressorParameters.previewTextureZoom.top - state.compressorParameters.previewTextureZoom.bottom;
            const midX = 0.5 * (state.compressorParameters.previewTextureZoom.right + state.compressorParameters.previewTextureZoom.left);
            const midY = 0.5 * (state.compressorParameters.previewTextureZoom.top + state.compressorParameters.previewTextureZoom.bottom);

            // Clamp zoom level
            if(zoomLevel < 1.0 && (width < 0.002 || height < 0.002))
            {
                return;
            }

            state.compressorParameters.previewTextureZoom = {
                left: midX - zoomLevel * width * 0.5,
                right: midX + zoomLevel * width * 0.5,
                bottom: midY - zoomLevel * height * 0.5,
                top: midY + zoomLevel * height * 0.5,
            };
            // clamp zoom
            const clamp = (x, min, max) => Math.max(Math.min(x, max), min);
            state.compressorParameters.previewTextureZoom = {
                left: clamp(state.compressorParameters.previewTextureZoom.left, 0, 0.95),
                right: clamp(state.compressorParameters.previewTextureZoom.right, 0.05, 1),
                bottom: clamp(state.compressorParameters.previewTextureZoom.bottom, 0, 0.95),
                top: clamp(state.compressorParameters.previewTextureZoom.top, 0.05, 1),
            };
        }
        else
        {        
            if (state.cameraIndex === undefined)
            {
                state.userCamera.zoomBy(zoom.deltaZoom);
            }
        }
    });
    listenForRedraw(uiModel.zoom);

    // configure the animation loop
    const past = {};
    const update = () =>
    {
        const devicePixelRatio = window.devicePixelRatio || 1;

        // set the size of the drawingBuffer based on the size it's displayed.
        canvas.width = Math.floor(canvas.clientWidth * devicePixelRatio);
        canvas.height = Math.floor(canvas.clientHeight * devicePixelRatio);
        redraw |= !state.animationTimer.paused && state.animationIndices.length > 0;
        redraw |= past.width != canvas.width || past.height != canvas.height;
        past.width = canvas.width;
        past.height = canvas.height;
        
        if (redraw) {
            view.renderFrame(state, canvas.width, canvas.height);
            redraw = false;
        }

        window.requestAnimationFrame(update);
    };

    // After this start executing animation loop.
    window.requestAnimationFrame(update);
}

export { main };
